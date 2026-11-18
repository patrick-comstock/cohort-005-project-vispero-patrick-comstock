/**
 * agent-setup-files.ts — the config files an agent must have written before
 * its command will point at this tool, for the agents that read their base
 * URL from a file rather than a variable or a flag.
 *
 * Each builder knows one agent's file format. The catalogue calls them with a
 * `{baseUrl}` placeholder; custom-target.ts calls piModels with a real base
 * URL and model when it builds Pi's custom target.
 */

import type { SetupFile } from "./agent-choice";

/**
 * Pi's provider override file. The key is `baseUrl`, in this exact spelling.
 * Pi accepts other spellings into the file and then refuses to start, so this
 * is worth getting right for the student.
 *
 * `modelId`, when given, is written as a one-entry `models` array under the
 * same provider. Pi replaces that provider's whole built-in model catalogue
 * with whatever `models` lists — see resolveCustomTarget's Pi branch, which
 * is the only caller that passes it. Omitted, as it is for every catalogue
 * entry, Pi keeps its built-in catalogue for that provider, which is
 * correct there because those routes really do talk to Anthropic or OpenAI.
 */
export function piModels(
  providerId: string,
  baseUrl: string,
  modelId?: string
): SetupFile {
  return {
    path: "~/.pi/agent/models.json",
    language: "json",
    body: [
      "{",
      '  "providers": {',
      `    "${providerId}": {`,
      `      "baseUrl": "${baseUrl}"${modelId ? "," : ""}`,
      ...(modelId ? [`      "models": [{ "id": "${modelId}" }]`] : []),
      "    }",
      "  }",
      "}",
    ].join("\n"),
  };
}

/**
 * OMP's provider override file, in YAML, under ~/.omp/agent/models.yml.
 *
 * OMP does not know, and this tool cannot know, which backend the student is
 * actually pointing at — Ollama, LM Studio, llama.cpp, LiteLLM, or something
 * else entirely — so the provider key below is a generic placeholder
 * ("custom") rather than a real backend name. OMP does not care what the key
 * is called, only that baseUrl is set correctly under it, so the placeholder
 * costs the student nothing; they may rename it if they prefer a name that
 * matches their backend.
 */
export function ompModels(baseUrl: string): SetupFile {
  return {
    path: "~/.omp/agent/models.yml",
    language: "yaml",
    body: ["providers:", "  custom:", `    baseUrl: "${baseUrl}"`].join("\n"),
  };
}

/**
 * Junie's custom-proxy override, in JSON, under ~/.junie/config.json (user
 * scope; see Junie's own configuration-files docs for how a project-scope
 * file layers on top). Unlike ompModels/piModels, this one genuinely differs
 * by wire format: Junie's proxy entry declares a `kind` — the protocol Junie
 * itself will speak on the wire — so a mismatched kind does not 404, it just
 * sends the wrong shape of request. That is why Junie gets two catalogue
 * providers (tagged by customTemplateFor) instead of OMP's one: the
 * kind, and the auth header format that goes with it, must track the
 * renderer the student actually picked.
 *
 * `authHeader` is a placeholder line, not a real credential — see JUNIE_NOTE
 * in agent-catalogue.ts.
 */
export function junieConfig(
  baseUrl: string,
  kind: "Anthropic" | "OpenAI",
  authHeader: string
): SetupFile {
  return {
    path: "~/.junie/config.json",
    language: "json",
    body: [
      "{",
      '  "proxies": [',
      "    {",
      '      "name": "request-logger",',
      `      "kind": "${kind}",`,
      `      "api-url": "${baseUrl}",`,
      `      "headers": ["${authHeader}"]`,
      "    }",
      "  ],",
      '  "provider": "request-logger"',
      "}",
    ].join("\n"),
  };
}
