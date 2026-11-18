/**
 * render-gemini.ts — the Gemini wire format: the request body, and the
 * response reassembled from its SSE stream.
 *
 * Gemini's shape differs from the other two everywhere it matters:
 *  - the system prompt sits beside the messages as `systemInstruction`, not as
 *    a field on the request and not as the first message;
 *  - roles are `user` and `model`. There is no `assistant`;
 *  - tools are nested twice, and the schema sits under a different key;
 *  - sampling settings live in a nested config object.
 *
 * Under the free Google account login the whole body is wrapped one level
 * deeper, and every response event is wrapped too. Both are unwrapped first, so
 * the two auth routes then share one code path.
 */

import {
  fenceJson,
  isNullish,
  renderMessages,
  renderParams,
  sseData,
  wire,
} from "./render-shared";

function unwrapGeminiRequest(j: unknown): unknown {
  if (!j) return j;
  const { request } = wire(j);
  return typeof request === "object" && request !== null ? request : j;
}

function unwrapGeminiResponse(j: unknown): unknown {
  if (!j) return j;
  const { response } = wire(j);
  return typeof response === "object" && response !== null ? response : j;
}

export function renderGeminiRequest(rawJson: unknown): string {
  const j = wire(unwrapGeminiRequest(rawJson));
  const parts: string[] = [];

  const params = renderParams(
    {
      ...wire(j.generationConfig ?? {}),
      toolConfig: j.toolConfig,
      safetySettings: j.safetySettings,
    },
    [
      "temperature",
      "topP",
      "topK",
      "maxOutputTokens",
      "candidateCount",
      "stopSequences",
      "responseMimeType",
      "thinkingConfig",
      "toolConfig",
      "safetySettings",
    ]
  );
  if (params) parts.push(params);

  if (!isNullish(j.systemInstruction)) {
    parts.push(
      [
        "<system-prompt>",
        "",
        renderGeminiParts(
          wire(j.systemInstruction).parts ?? j.systemInstruction
        ),
        "",
        "</system-prompt>",
      ].join("\n")
    );
  }

  if (Array.isArray(j.tools) && j.tools.length > 0) {
    parts.push(renderGeminiTools(j.tools));
  }

  parts.push(
    renderMessages(
      Array.isArray(j.contents) ? j.contents : [],
      renderGeminiContent
    )
  );

  return parts.join("\n\n");
}

function renderGeminiTools(tools: unknown[]): string {
  const rendered: string[] = [];
  for (const t of tools) {
    const tool = wire(t ?? {});
    if (Array.isArray(tool.functionDeclarations)) {
      for (const f of tool.functionDeclarations) {
        rendered.push(renderGeminiFunctionDeclaration(f));
      }
      continue;
    }
    // Built-in tools arrive as bare keys, e.g. { googleSearch: {} }
    for (const key of Object.keys(tool ?? {})) {
      rendered.push([`### ${key}`, "", fenceJson(tool[key])].join("\n"));
    }
  }
  return ["<tools>", "", rendered.join("\n\n"), "", "</tools>"].join("\n");
}

function renderGeminiFunctionDeclaration(declaration: unknown): string {
  const fn = wire(declaration);
  const lines = [`### ${fn.name ?? "(unnamed tool)"}`, ""];
  if (fn.description) lines.push(String(fn.description), "");
  const schema = fn.parametersJsonSchema ?? fn.parameters;
  if (schema) lines.push(fenceJson(schema));
  return lines.join("\n");
}

function renderGeminiContent(msg: unknown): string {
  return renderGeminiParts(wire(msg ?? {}).parts);
}

function renderGeminiParts(parts: unknown): string {
  if (typeof parts === "string") return parts;
  if (!Array.isArray(parts)) return fenceJson(parts);
  return parts
    .map((p: unknown) => {
      const part = wire(p ?? {});
      if (typeof part.text === "string") {
        return part.thought
          ? ["<thinking>", "", part.text, "", "</thinking>"].join("\n")
          : part.text;
      }
      if (part.functionCall) {
        const call = wire(part.functionCall);
        return [
          `<tool-use name="${call.name ?? ""}" id="${call.id ?? ""}">`,
          "",
          fenceJson(call.args ?? {}),
          "",
          "</tool-use>",
        ].join("\n");
      }
      if (part.functionResponse) {
        const result = wire(part.functionResponse);
        return [
          `<tool-result name="${result.name ?? ""}" id="${result.id ?? ""}">`,
          "",
          typeof result.response === "string"
            ? result.response
            : fenceJson(result.response),
          "",
          "</tool-result>",
        ].join("\n");
      }
      if (part.inlineData) {
        const data = wire(part.inlineData);
        const bytes = typeof data.data === "string" ? data.data.length : 0;
        return `\`[inline data: ${data.mimeType ?? "unknown"}, ${bytes} base64 chars — full data in .request.txt]\``;
      }
      return fenceJson(p);
    })
    .join("\n\n");
}

export function renderGeminiResponse(raw: string): string {
  const events = sseData(raw).map(unwrapGeminiResponse);

  let text = "";
  let thinking = "";
  const toolCalls: Array<{ name: string; args: unknown }> = [];
  let finish: unknown;
  let usage: unknown;

  for (const e of events) {
    const ev = wire(e ?? {});
    const candidates = ev.candidates;
    const candidate = wire(
      (isNullish(candidates) ? undefined : wire(candidates)[0]) ?? {}
    );
    const parts = wire(candidate.content ?? {}).parts;
    for (const p of Array.isArray(parts) ? parts : []) {
      const part = wire(p ?? {});
      if (typeof part.text === "string" && part.thought) {
        thinking += part.text;
      } else if (typeof part.text === "string") {
        text += part.text;
      } else if (part.functionCall) {
        const call = wire(part.functionCall);
        toolCalls.push({
          name: String(call.name ?? ""),
          args: call.args ?? {},
        });
      }
    }
    if (candidate.finishReason) finish = candidate.finishReason;
    if (ev.usageMetadata) usage = ev.usageMetadata;
  }

  const out: string[] = [];
  if (finish) out.push(`- **finish reason**: ${finish}`);
  if (usage) out.push(`- **usage**: ${JSON.stringify(usage)}`);
  if (out.length) out.push("");
  if (thinking)
    out.push(["<thinking>", "", thinking, "", "</thinking>"].join("\n"));
  if (text)
    out.push(
      ["<assistant-text>", "", text, "", "</assistant-text>"].join("\n")
    );
  for (const call of toolCalls) {
    out.push(
      [
        `<tool-use name="${call.name}" id="">`,
        "",
        fenceJson(call.args),
        "",
        "</tool-use>",
      ].join("\n")
    );
  }
  return out.length ? out.join("\n\n") : "_(no content decoded)_";
}
