// Entry point of the example package: a copy-me template for a deep module.
// Callers import this file; the implementation stays hidden in lib/.
import { buildGreeting } from "./lib/impl";

/** Greets `name`, falling back to "world" when it is blank. */
export function greet(name: string): string {
  return buildGreeting(name);
}
