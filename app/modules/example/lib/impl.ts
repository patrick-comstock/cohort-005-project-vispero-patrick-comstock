// Implementation: private to the example package. Nothing outside
// app/modules/example/ may import this file; go through ../index instead.

export function buildGreeting(name: string): string {
  const trimmed = name.trim();
  return `Hello, ${trimmed === "" ? "world" : trimmed}!`;
}
