const LEADING_ATX_HEADING = /^\s*#{1,6}[ \t]+(.*?)[ \t#]*(?:\r?\n|$)/;

function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

export function stripRepeatedTitleHeading(
  markdown: string,
  title: string
): string {
  const match = LEADING_ATX_HEADING.exec(markdown);
  if (!match) return markdown;
  if (normalizeTitle(match[1]) !== normalizeTitle(title)) return markdown;
  return markdown.slice(match[0].length);
}
