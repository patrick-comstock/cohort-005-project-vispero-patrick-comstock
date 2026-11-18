/**
 * render-anthropic.ts — the Anthropic Messages wire format: the request body,
 * and the response reassembled from its SSE stream.
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

export function renderAnthropicRequest(rawJson: unknown): string {
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

  if (!isNullish(j.system)) {
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

  // Anthropic: content lives on msg.content ; renderAnthropicContent handles the shape.
  parts.push(
    renderMessages(j.messages, (m) => renderAnthropicContent(wire(m).content))
  );

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

export function renderAnthropicResponse(raw: string): string {
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
