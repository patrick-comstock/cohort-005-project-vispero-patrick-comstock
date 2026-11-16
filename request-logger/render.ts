/**
 * render.ts — turns a captured request/response into a readable Markdown doc.
 *
 * Design rules (locked):
 *  - Structural sections are delimited by XML tags, NOT Markdown headings,
 *    because the captured content (system prompts especially) is full of its
 *    own `#` headings that would otherwise collide with document structure.
 *  - Verbatim and complete: no truncation, no summarisation, no dedup. The one
 *    exception is base64 image data, which is binary (not "what's sent to the
 *    model as readable text") and is preserved untouched in the .request.txt.
 *  - Every wire format gets a real renderer; unexpected shapes fall back to
 *    pretty-printed JSON so information is never lost.
 *  - The body arrives as bytes, not as a string, because some agents compress
 *    it. Decoding happens here so that the proxy can forward the original bytes
 *    upstream untouched and still write a readable document.
 */

import zlib from "node:zlib";
import type { RendererId } from "./agents";

interface RenderInput {
  /** Human label for the capture, e.g. "Claude Code" or "Pi (ChatGPT)". */
  agent: string;
  renderer: RendererId;
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  /** The request body exactly as it arrived, still compressed if it was sent so. */
  requestBody: Buffer;
  /** The request's content-encoding header, if it had one. */
  requestEncoding?: string;
  responseRaw: string;
}

const REDACT = new Set([
  "authorization",
  "x-api-key",
  "api-key",
  "x-goog-api-key",
]);

/**
 * Turn the raw request bytes into text.
 *
 * Pi and Codex both compress their request body (zstd) when they talk to the
 * ChatGPT backend. Without this the readable document would be a page of
 * binary. The proxy still forwards, and still saves, the original bytes:
 * only the copy we read is decoded.
 *
 * A body that claims an encoding but won't decode is never silently shown as
 * if it were text — that just reproduces the original bug (a page of binary
 * in the "readable" document) with no clue why. Instead this returns a loud,
 * unmissable warning ahead of the raw bytes, so a student sees a reason
 * instead of gibberish.
 */
export function decodeRequestBody(body: Buffer, encoding?: string): string {
  const kind = (encoding ?? "").trim().toLowerCase();
  if (kind === "" || kind === "identity") return body.toString("utf8");

  if (kind === "zstd" && typeof zlib.zstdDecompressSync !== "function") {
    return decodeFailureWarning(
      body,
      `this body is zstd-compressed, but this proxy is running on Node ${process.version}, ` +
        "which has no zlib.zstdDecompressSync (that needs Node >=22.15.0 or >=23.8.0). " +
        "Upgrade Node and re-send the request to see the real body."
    );
  }

  try {
    if (kind === "zstd") return zlib.zstdDecompressSync(body).toString("utf8");
    if (kind === "gzip") return zlib.gunzipSync(body).toString("utf8");
    if (kind === "br") return zlib.brotliDecompressSync(body).toString("utf8");
    if (kind === "deflate") return zlib.inflateSync(body).toString("utf8");
  } catch (err) {
    return decodeFailureWarning(
      body,
      `this body claims content-encoding "${kind}" but did not decode as that: ${(err as Error).message}`
    );
  }

  return decodeFailureWarning(
    body,
    `content-encoding "${kind}" is not one this tool decodes`
  );
}

function decodeFailureWarning(body: Buffer, reason: string): string {
  return (
    `[request-logger] COULD NOT DECODE THIS BODY — ${reason}\n\n` +
    "The bytes below are still compressed. They are NOT what was actually sent as text:\n\n" +
    body.toString("utf8")
  );
}

export function renderMarkdown(input: RenderInput): string {
  const requestText = decodeRequestBody(
    input.requestBody,
    input.requestEncoding
  );

  let reqJson: unknown = null;
  try {
    reqJson = JSON.parse(requestText);
  } catch {
    // leave null; renderRequest falls back to raw
  }

  const model = findModel(reqJson, input.path);

  return (
    [
      renderMeta(input, model),
      renderHeaders(input.headers),
      "<request>\n\n" +
        renderRequest(input, reqJson, requestText) +
        "\n\n</request>",
      "<response>\n\n" + renderResponse(input, reqJson) + "\n\n</response>",
    ].join("\n\n") + "\n"
  );
}

/** Most APIs name the model in the body. Gemini names it in the URL. */
function findModel(reqJson: unknown, path: string): string {
  const model = wire(reqJson ?? {}).model;
  if (typeof model === "string") return model;
  const fromPath = path.match(/models\/([^:/?]+)/);
  if (fromPath) return fromPath[1];
  return "unknown";
}

function renderMeta(input: RenderInput, model: string): string {
  return [
    "<meta>",
    "",
    `- **timestamp**: ${input.timestamp}`,
    `- **agent**: ${input.agent}`,
    `- **wire format**: ${input.renderer}`,
    `- **model**: ${model}`,
    `- **endpoint**: ${input.method} ${input.path}`,
    `- **upstream status**: ${input.statusCode}`,
    "",
    "</meta>",
  ].join("\n");
}

function renderHeaders(headers: RenderInput["headers"]): string {
  const lines = Object.entries(headers).map(([key, value]) => {
    const shown = REDACT.has(key.toLowerCase())
      ? "[REDACTED]"
      : Array.isArray(value)
        ? value.join(", ")
        : (value ?? "");
    return `${key}: ${shown}`;
  });
  return ["<headers>", "", "```", ...lines, "```", "", "</headers>"].join("\n");
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** A parsed wire-format value whose fields have not been checked yet. */
type Wire = Record<string, unknown>;

/**
 * Read untrusted wire JSON field by field. Like `value.field`, this throws on
 * null or undefined, so a body of the wrong shape still lands in the
 * renderer's raw-JSON fallback; any other value reads as normal. Call it as
 * `wire(value ?? {})` where the original read was `value?.field`.
 */
function wire(value: unknown): Wire {
  if (value == null) {
    throw new TypeError(`Cannot read properties of ${value}`);
  }
  return value as Wire;
}

function fenceJson(value: unknown): string {
  return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}

function fence(text: string, lang = ""): string {
  return "```" + lang + "\n" + text + "\n```";
}

/** Collapse a content field that may be a string or an array of text-ish blocks
 * down to plain text, preserving everything (only image base64 is placeheld). */
function blockText(block: unknown): string {
  if (typeof block === "string") return block;
  const { type, text } = wire(block ?? {});
  if (type === "text" && typeof text === "string") return text;
  if (type === "input_text" && typeof text === "string") return text;
  if (type === "output_text" && typeof text === "string") return text;
  return "";
}

// ---------------------------------------------------------------------------
// Request rendering
// ---------------------------------------------------------------------------

function renderRequest(
  input: RenderInput,
  reqJson: unknown,
  requestText: string
): string {
  // Checked first and explicitly: without this, "raw" is not "anthropic" and
  // not "gemini", so it would silently fall into the OpenAI parser below —
  // the same implicit default every other unrecognised renderer id already
  // falls into. "raw" must never guess at a shape it was not told; it always
  // goes straight to the generic fallback instead.
  if (input.renderer === "raw") {
    return reqJson == null ? fence(requestText) : fenceJson(reqJson);
  }
  if (reqJson == null) {
    return fence(requestText);
  }
  try {
    if (input.renderer === "anthropic") return renderAnthropicRequest(reqJson);
    if (input.renderer === "gemini") return renderGeminiRequest(reqJson);
    return renderOpenAIRequest(reqJson);
  } catch (err) {
    return (
      `<!-- renderer error, showing raw JSON: ${(err as Error).message} -->\n\n` +
      fenceJson(reqJson)
    );
  }
}

function renderParams(reqJson: Wire, keys: string[]): string {
  const present = keys
    .filter((k) => reqJson[k] !== undefined)
    .map((k) => {
      const v = reqJson[k];
      const shown = typeof v === "object" ? JSON.stringify(v) : String(v);
      return `- **${k}**: ${shown}`;
    });
  if (present.length === 0) return "";
  return ["<params>", "", ...present, "", "</params>"].join("\n");
}

// ---- Anthropic --------------------------------------------------------------

function renderAnthropicRequest(rawJson: unknown): string {
  const j = wire(rawJson);
  const parts: string[] = [];

  const params = renderParams(j, [
    "max_tokens",
    "temperature",
    "top_p",
    "top_k",
    "stream",
    "stop_sequences",
    "tool_choice",
    "thinking",
    "metadata",
  ]);
  if (params) parts.push(params);

  if (j.system != null) {
    parts.push(
      [
        "<system-prompt>",
        "",
        renderAnthropicSystem(j.system),
        "",
        "</system-prompt>",
      ].join("\n")
    );
  }

  if (Array.isArray(j.tools) && j.tools.length > 0) {
    parts.push(renderAnthropicTools(j.tools));
  }

  parts.push(renderMessages(j.messages, renderAnthropicContent));

  return parts.join("\n\n");
}

function renderAnthropicSystem(system: unknown): string {
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system
      .map((block: unknown) => {
        const text = blockText(block);
        const marker = wire(block ?? {}).cache_control
          ? "\n\n<!-- cache_control breakpoint -->"
          : "";
        return text + marker;
      })
      .join("\n\n");
  }
  return fenceJson(system);
}

function renderAnthropicTools(tools: unknown[]): string {
  const rendered = tools.map((t) => {
    const tool = wire(t);
    const lines = [`### ${tool.name ?? "(unnamed tool)"}`, ""];
    if (tool.description) lines.push(String(tool.description), "");
    if (tool.input_schema) lines.push(fenceJson(tool.input_schema));
    return lines.join("\n");
  });
  return ["<tools>", "", rendered.join("\n\n"), "", "</tools>"].join("\n");
}

function renderAnthropicContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return fenceJson(content);
  return content
    .map((b: unknown) => {
      const block = wire(b ?? {});
      switch (block.type) {
        case "text":
          return block.text ?? "";
        case "tool_use":
          return [
            `<tool-use name="${block.name}" id="${block.id ?? ""}">`,
            "",
            fenceJson(block.input ?? {}),
            "",
            "</tool-use>",
          ].join("\n");
        case "tool_result": {
          const inner = renderToolResultContent(block.content);
          return [
            `<tool-result tool-use-id="${block.tool_use_id ?? ""}" is-error="${!!block.is_error}">`,
            "",
            inner,
            "",
            "</tool-result>",
          ].join("\n");
        }
        case "image":
          return imagePlaceholder(block);
        case "thinking":
          return [
            "<thinking>",
            "",
            block.thinking ?? "",
            "",
            "</thinking>",
          ].join("\n");
        default:
          return fenceJson(b);
      }
    })
    .join("\n\n");
}

function renderToolResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b: unknown) =>
        wire(b ?? {}).type === "image"
          ? imagePlaceholder(b)
          : blockText(b) || fenceJson(b)
      )
      .join("\n\n");
  }
  return fenceJson(content);
}

function imagePlaceholder(block: unknown): string {
  const src = wire(wire(block).source ?? {});
  const bytes = typeof src.data === "string" ? src.data.length : 0;
  return `\`[image: ${src.media_type ?? src.type ?? "unknown"}, ${bytes} base64 chars — full data in .request.txt]\``;
}

// ---- OpenAI -----------------------------------------------------------------

function renderOpenAIRequest(rawJson: unknown): string {
  const j = wire(rawJson);
  const parts: string[] = [];

  const params = renderParams(j, [
    "max_tokens",
    "max_output_tokens",
    "temperature",
    "top_p",
    "stream",
    "stop",
    "tool_choice",
    "reasoning",
    "metadata",
  ]);
  if (params) parts.push(params);

  // /responses uses `instructions` as the system prompt.
  if (typeof j.instructions === "string" && j.instructions.length > 0) {
    parts.push(
      ["<system-prompt>", "", j.instructions, "", "</system-prompt>"].join("\n")
    );
  }

  if (Array.isArray(j.tools) && j.tools.length > 0) {
    parts.push(renderOpenAITools(j.tools));
  }

  // /chat/completions => messages ; /responses => input (string or items)
  if (Array.isArray(j.messages)) {
    parts.push(renderMessages(j.messages, renderOpenAIChatContent));
  } else if (typeof j.input === "string") {
    parts.push(
      [
        "<messages>",
        "",
        '<message role="user">',
        "",
        j.input,
        "",
        "</message>",
        "",
        "</messages>",
      ].join("\n")
    );
  } else if (Array.isArray(j.input)) {
    parts.push(renderMessages(j.input, renderOpenAIResponsesContent));
  }

  return parts.join("\n\n");
}

function renderOpenAITools(tools: unknown[]): string {
  const rendered = tools.map((t) => {
    // chat: { type: "function", function: { name, description, parameters } }
    // responses: { type: "function", name, description, parameters }
    const tool = wire(t);
    const fn = wire(tool.function ?? tool);
    const lines = [`### ${fn.name ?? tool.type ?? "(unnamed tool)"}`, ""];
    if (fn.description) lines.push(String(fn.description), "");
    if (fn.parameters) lines.push(fenceJson(fn.parameters));
    return lines.join("\n");
  });
  return ["<tools>", "", rendered.join("\n\n"), "", "</tools>"].join("\n");
}

function renderOpenAIChatContent(message: unknown): string {
  // In chat/completions each element IS the message {role, content, tool_calls}.
  const msg = wire(message);
  const out: string[] = [];
  const content = msg.content;
  if (typeof content === "string") {
    out.push(content);
  } else if (Array.isArray(content)) {
    out.push(
      content
        .map((b: unknown) =>
          wire(b ?? {}).type === "image_url"
            ? "`[image_url]`"
            : blockText(b) || fenceJson(b)
        )
        .join("\n\n")
    );
  }
  if (Array.isArray(msg.tool_calls)) {
    for (const c of msg.tool_calls) {
      const call = wire(c);
      const fn = wire(call.function ?? {});
      out.push(
        [
          `<tool-use name="${fn.name}" id="${call.id ?? ""}">`,
          "",
          fence(String(fn.arguments ?? ""), "json"),
          "",
          "</tool-use>",
        ].join("\n")
      );
    }
  }
  if (msg.role === "tool") {
    out.push(
      [
        `<tool-result tool-call-id="${msg.tool_call_id ?? ""}">`,
        "",
        typeof content === "string" ? content : fenceJson(content),
        "",
        "</tool-result>",
      ].join("\n")
    );
  }
  return out.join("\n\n");
}

function renderOpenAIResponsesContent(raw: unknown): string {
  // /responses input items: message, function_call, function_call_output, ...
  switch (wire(raw ?? {}).type) {
    case "message":
    case undefined: {
      const content = wire(raw).content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content
          .map((b: unknown) => blockText(b) || fenceJson(b))
          .join("\n\n");
      }
      return fenceJson(raw);
    }
    case "function_call": {
      const item = wire(raw);
      return [
        `<tool-use name="${item.name}" id="${item.call_id ?? item.id ?? ""}">`,
        "",
        fence(String(item.arguments ?? ""), "json"),
        "",
        "</tool-use>",
      ].join("\n");
    }
    case "function_call_output": {
      const item = wire(raw);
      return [
        `<tool-result call-id="${item.call_id ?? ""}">`,
        "",
        typeof item.output === "string" ? item.output : fenceJson(item.output),
        "",
        "</tool-result>",
      ].join("\n");
    }
    default:
      return fenceJson(raw);
  }
}

// ---- Gemini -----------------------------------------------------------------
//
// Gemini's shape differs from the other two everywhere it matters:
//  - the system prompt sits beside the messages as `systemInstruction`, not as
//    a field on the request and not as the first message;
//  - roles are `user` and `model`. There is no `assistant`;
//  - tools are nested twice, and the schema sits under a different key;
//  - sampling settings live in a nested config object.
//
// Under the free Google account login the whole body is wrapped one level
// deeper, and every response event is wrapped too. Both are unwrapped first, so
// the two auth routes then share one code path.

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

function renderGeminiRequest(rawJson: unknown): string {
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

  if (j.systemInstruction != null) {
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
        const fn = wire(f);
        const lines = [`### ${fn.name ?? "(unnamed tool)"}`, ""];
        if (fn.description) lines.push(String(fn.description), "");
        const schema = fn.parametersJsonSchema ?? fn.parameters;
        if (schema) lines.push(fenceJson(schema));
        rendered.push(lines.join("\n"));
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

function renderGeminiResponse(raw: string): string {
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
      (candidates == null ? undefined : wire(candidates)[0]) ?? {}
    );
    const parts = wire(candidate.content ?? {}).parts;
    if (Array.isArray(parts)) {
      for (const p of parts) {
        const part = wire(p ?? {});
        if (typeof part.text === "string") {
          if (part.thought) thinking += part.text;
          else text += part.text;
        } else if (part.functionCall) {
          const call = wire(part.functionCall);
          toolCalls.push({
            name: String(call.name ?? ""),
            args: call.args ?? {},
          });
        }
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

// ---- shared message list ----------------------------------------------------

function renderMessages(
  messages: unknown,
  renderContent: (msg: unknown) => string
): string {
  if (!Array.isArray(messages)) return "<messages></messages>";
  const rendered = messages.map((m: unknown, i) => {
    const msg = wire(m);
    const role = msg.role ?? msg.type ?? "unknown";
    // Anthropic: content lives on msg.content ; renderContent handles the shape.
    const inner =
      renderContent === renderAnthropicContent
        ? renderAnthropicContent(msg.content)
        : renderContent(m);
    return [
      `<message index="${i + 1}" role="${role}">`,
      "",
      inner,
      "",
      "</message>",
    ].join("\n");
  });
  return ["<messages>", "", rendered.join("\n\n"), "", "</messages>"].join(
    "\n"
  );
}

// ---------------------------------------------------------------------------
// Response rendering (reassembled from the streamed SSE)
// ---------------------------------------------------------------------------

function renderResponse(input: RenderInput, reqJson: unknown): string {
  const raw = input.responseRaw;
  if (raw.trim().length === 0) return "_(empty response)_";

  const looksSSE = /(^|\n)\s*(event:|data:)/.test(raw);

  // Checked first and explicitly, for the same reason as renderRequest
  // above: "raw" must never fall through into the OpenAI stream parser.
  // Ollama's own response shape — newline-delimited bare JSON, no `data:`
  // prefix — is not reconstructed here; that is a separate fast-follow. This
  // path still shows something rather than nothing: an SSE-ish stream is
  // dumped one parsed event per JSON block, and anything else (including
  // Ollama's NDJSON) falls back to the untouched raw text.
  if (input.renderer === "raw") {
    try {
      if (!looksSSE) return fenceJson(JSON.parse(raw));
      const events = sseData(raw);
      return events.length > 0
        ? events.map((event) => fenceJson(event)).join("\n\n")
        : fence(raw);
    } catch {
      return fence(raw);
    }
  }

  try {
    if (!looksSSE) {
      // Non-streaming JSON body.
      const parsed = JSON.parse(raw);
      return fenceJson(parsed);
    }
    if (input.renderer === "anthropic") return renderAnthropicResponse(raw);
    if (input.renderer === "gemini") return renderGeminiResponse(raw);
    return renderOpenAIResponse(raw, reqJson);
  } catch (err) {
    return (
      `<!-- response renderer error, showing raw stream: ${(err as Error).message} -->\n\n` +
      fence(raw)
    );
  }
}

/** Pull the JSON payloads out of `data: {...}` SSE lines. */
function sseData(raw: string): unknown[] {
  const out: unknown[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^data:\s?(.*)$/);
    if (!m) continue;
    const payload = m[1];
    if (payload === "[DONE]" || payload.trim() === "") continue;
    try {
      out.push(JSON.parse(payload));
    } catch {
      // skip un-parseable data lines
    }
  }
  return out;
}

function renderAnthropicResponse(raw: string): string {
  const events = sseData(raw);
  const blocks: Record<
    string,
    { type: unknown; text: string; name?: unknown; id?: unknown }
  > = {};
  let stopReason: unknown;
  let usage: unknown;

  for (const e of events) {
    const ev = wire(e);
    // Same key the object would coerce the raw index to.
    const index = String(ev.index);
    switch (ev.type) {
      case "content_block_start": {
        const block = wire(ev.content_block ?? {});
        blocks[index] = {
          type: block.type ?? "text",
          text: "",
          name: block.name,
          id: block.id,
        };
        break;
      }
      case "content_block_delta":
        if (blocks[index]) {
          const d = wire(ev.delta ?? {});
          blocks[index].text += String(
            d.text ?? d.partial_json ?? d.thinking ?? ""
          );
        }
        break;
      case "message_delta": {
        const stop = wire(ev.delta ?? {}).stop_reason;
        if (stop) stopReason = stop;
        if (ev.usage) usage = ev.usage;
        break;
      }
      case "message_start": {
        const messageUsage = wire(ev.message ?? {}).usage;
        if (messageUsage)
          usage = { ...wire(messageUsage), ...wire(usage ?? {}) };
        break;
      }
    }
  }

  const parts: string[] = [];
  if (stopReason) parts.push(`- **stop reason**: ${stopReason}`);
  if (usage) parts.push(`- **usage**: ${JSON.stringify(usage)}`);
  if (parts.length) parts.push("");

  const ordered = Object.keys(blocks)
    .map(Number)
    .sort((a, b) => a - b);
  for (const i of ordered) {
    const b = blocks[i];
    if (b.type === "text") {
      parts.push(
        ["<assistant-text>", "", b.text, "", "</assistant-text>"].join("\n")
      );
    } else if (b.type === "thinking") {
      parts.push(["<thinking>", "", b.text, "", "</thinking>"].join("\n"));
    } else if (b.type === "tool_use") {
      parts.push(
        [
          `<tool-use name="${b.name}" id="${b.id ?? ""}">`,
          "",
          fence(b.text || "{}", "json"),
          "",
          "</tool-use>",
        ].join("\n")
      );
    }
  }
  if (ordered.length === 0 && parts.length === 0) return fence(raw);
  return parts.join("\n\n");
}

function renderOpenAIResponse(raw: string, reqJson: unknown): string {
  const events = sseData(raw);
  const isResponses = events.some((e) => {
    const type = wire(e).type;
    return typeof type === "string" && type.startsWith("response.");
  });

  if (isResponses) return renderOpenAIResponsesStream(events);
  return renderOpenAIChatStream(events);
}

function renderOpenAIChatStream(events: unknown[]): string {
  let text = "";
  const toolCalls: Record<
    string,
    { name: string; args: string; id?: unknown }
  > = {};
  let finish: unknown;
  let usage: unknown;

  for (const e of events) {
    const ev = wire(e);
    const choices = ev.choices;
    const choice = wire((choices == null ? undefined : wire(choices)[0]) ?? {});
    const delta = wire(choice.delta ?? {});
    if (typeof delta.content === "string") text += delta.content;
    if (Array.isArray(delta.tool_calls)) {
      for (const t of delta.tool_calls) {
        const tc = wire(t);
        // Same key the object would coerce the raw index to.
        const idx = String(tc.index ?? 0);
        toolCalls[idx] ??= { name: "", args: "", id: tc.id };
        if (tc.id) toolCalls[idx].id = tc.id;
        const fn = wire(tc.function ?? {});
        if (fn.name) toolCalls[idx].name += String(fn.name);
        if (fn.arguments) toolCalls[idx].args += String(fn.arguments);
      }
    }
    if (choice.finish_reason) finish = choice.finish_reason;
    if (ev.usage) usage = ev.usage;
  }

  const parts: string[] = [];
  if (finish) parts.push(`- **finish reason**: ${finish}`);
  if (usage) parts.push(`- **usage**: ${JSON.stringify(usage)}`);
  if (parts.length) parts.push("");
  if (text)
    parts.push(
      ["<assistant-text>", "", text, "", "</assistant-text>"].join("\n")
    );
  for (const idx of Object.keys(toolCalls)
    .map(Number)
    .sort((a, b) => a - b)) {
    const tc = toolCalls[idx];
    parts.push(
      [
        `<tool-use name="${tc.name}" id="${tc.id ?? ""}">`,
        "",
        fence(tc.args || "{}", "json"),
        "",
        "</tool-use>",
      ].join("\n")
    );
  }
  return parts.length ? parts.join("\n\n") : "_(no content decoded)_";
}

function renderOpenAIResponsesStream(events: unknown[]): string {
  let text = "";
  const toolCalls: Record<string, { name: unknown; args: string }> = {};
  let usage: unknown;
  let status: unknown;

  for (const e of events) {
    const ev = wire(e);
    switch (ev.type) {
      case "response.output_text.delta":
        text += String(ev.delta ?? "");
        break;
      case "response.function_call_arguments.delta": {
        // Same key the object would coerce the raw id to.
        const key = String(ev.item_id ?? "0");
        toolCalls[key] ??= { name: "", args: "" };
        toolCalls[key].args += String(ev.delta ?? "");
        break;
      }
      case "response.output_item.added": {
        const item = wire(ev.item ?? {});
        if (item.type === "function_call") {
          const key = String(item.id ?? "0");
          toolCalls[key] ??= { name: "", args: "" };
          toolCalls[key].name = item.name ?? toolCalls[key].name;
        }
        break;
      }
      case "response.completed": {
        const response = wire(ev.response ?? {});
        status = response.status;
        usage = response.usage ?? usage;
        break;
      }
    }
  }

  const parts: string[] = [];
  if (status) parts.push(`- **status**: ${status}`);
  if (usage) parts.push(`- **usage**: ${JSON.stringify(usage)}`);
  if (parts.length) parts.push("");
  if (text)
    parts.push(
      ["<assistant-text>", "", text, "", "</assistant-text>"].join("\n")
    );
  for (const key of Object.keys(toolCalls)) {
    const tc = toolCalls[key];
    parts.push(
      [
        `<tool-use name="${tc.name}" id="${key}">`,
        "",
        fence(tc.args || "{}", "json"),
        "",
        "</tool-use>",
      ].join("\n")
    );
  }
  return parts.length ? parts.join("\n\n") : "_(no content decoded)_";
}
