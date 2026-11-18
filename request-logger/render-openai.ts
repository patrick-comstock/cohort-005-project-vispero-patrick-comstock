/**
 * render-openai.ts — the OpenAI wire format, in both of its dialects:
 * /chat/completions and /responses. Covers the request body, and the response
 * reassembled from its SSE stream.
 */

import {
  blockText,
  fence,
  fenceJson,
  isNullish,
  renderMessages,
  renderParams,
  sseData,
  wire,
} from "./render-shared";

export function renderOpenAIRequest(rawJson: unknown): string {
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

export function renderOpenAIResponse(raw: string): string {
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
    const choice = wire(
      (isNullish(choices) ? undefined : wire(choices)[0]) ?? {}
    );
    const delta = wire(choice.delta ?? {});
    if (typeof delta.content === "string") text += delta.content;
    const toolCallDeltas = Array.isArray(delta.tool_calls)
      ? delta.tool_calls
      : [];
    for (const t of toolCallDeltas) {
      const tc = wire(t);
      // Same key the object would coerce the raw index to.
      const idx = String(tc.index ?? 0);
      toolCalls[idx] ??= { name: "", args: "", id: tc.id };
      if (tc.id) toolCalls[idx].id = tc.id;
      const fn = wire(tc.function ?? {});
      if (fn.name) toolCalls[idx].name += String(fn.name);
      if (fn.arguments) toolCalls[idx].args += String(fn.arguments);
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
