/**
 * render-shared.ts — the building blocks every wire-format renderer uses:
 * reading untrusted wire JSON, fencing, the shared `<params>` and `<messages>`
 * sections, and pulling events out of an SSE stream.
 */

/** A parsed wire-format value whose fields have not been checked yet. */
export type Wire = Record<string, unknown>;

/**
 * Read untrusted wire JSON field by field. Like `value.field`, this throws on
 * null or undefined, so a body of the wrong shape still lands in the
 * renderer's raw-JSON fallback; any other value reads as normal. Call it as
 * `wire(value ?? {})` where the original read was `value?.field`.
 */
export function wire(value: unknown): Wire {
  if (isNullish(value)) {
    throw new TypeError(`Cannot read properties of ${value}`);
  }
  return value as Wire;
}

export function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

export function fenceJson(value: unknown): string {
  return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}

export function fence(text: string, lang = ""): string {
  return "```" + lang + "\n" + text + "\n```";
}

/** Collapse a content field that may be a string or an array of text-ish blocks
 * down to plain text, preserving everything (only image base64 is placeheld). */
export function blockText(block: unknown): string {
  if (typeof block === "string") return block;
  const { type, text } = wire(block ?? {});
  if (type === "text" && typeof text === "string") return text;
  if (type === "input_text" && typeof text === "string") return text;
  if (type === "output_text" && typeof text === "string") return text;
  return "";
}

export function renderParams(reqJson: Wire, keys: string[]): string {
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

/**
 * The `<messages>` section. `renderContent` is handed each whole message and
 * renders its body; the role and index are rendered here.
 */
export function renderMessages(
  messages: unknown,
  renderContent: (msg: unknown) => string
): string {
  if (!Array.isArray(messages)) return "<messages></messages>";
  const rendered = messages.map((m: unknown, i) => {
    const msg = wire(m);
    const role = msg.role ?? msg.type ?? "unknown";
    return [
      `<message index="${i + 1}" role="${role}">`,
      "",
      renderContent(m),
      "",
      "</message>",
    ].join("\n");
  });
  return ["<messages>", "", rendered.join("\n\n"), "", "</messages>"].join(
    "\n"
  );
}

/** Pull the JSON payloads out of `data: {...}` SSE lines. */
export function sseData(raw: string): unknown[] {
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
