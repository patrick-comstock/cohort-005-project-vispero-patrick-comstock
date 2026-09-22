## Domain language

Read `GLOSSARY.md` before naming anything (code, UI copy, routes, DB schema). When a term is settled, add or update it there.

## Modules

Modules under `app/modules/` are deep modules: read [app/modules/README.md](./app/modules/README.md) before adding one or importing from one.

## Verification checks

Run `npm run check` before you report a change to `app/` as complete.

Then run `npm run test:mutation`. It mutates only the lines your change touches below `app/lib/`, `app/modules/` and `request-logger/` (pass paths to grade whole files instead), and writes `reports/mutation/mutation.json`. The `mutation-testing` skill reads that report.

The pre-commit hook formats and lints staged files, so a commit never needs `--no-verify`.

### About agent-browser

agent-browser lets you drive a real browser through the app from the
terminal: open a page, click, and read the DOM back. Use it to check a change
that `typecheck` and `test` cannot see, and to answer a question about the
page yourself rather than asking the person you are working for. See
`docs/agents/agent-browser.md`.

## When something breaks

| Symptom                                         | Cause                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 401 "Select a user from the DevUI panel"        | No user in the session — switch users and country in the floating panel (`app/components/dev-ui.tsx`). |
| `tsc` reports every `./+types/*` import missing | Typegen has not run. Use `npm run typecheck`, which runs `react-router typegen` first.                 |

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues on your own copy of this repo (the `origin` remote), never on `ai-hero-dev/cohort-005-project`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.
