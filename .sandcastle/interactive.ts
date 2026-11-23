import { claudeCode, interactive } from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";

await interactive({
  agent: claudeCode("claude-opus-5-5"),
  sandbox: noSandbox(),
  promptFile: "./.sandcastle/prompt.md",
});
