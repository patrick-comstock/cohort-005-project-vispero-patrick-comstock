import { run, claudeCode } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

await run({
  agent: claudeCode("claude-opus-5-5"),
  sandbox: docker(),
  prompt: "Hello, how are you?",
});
