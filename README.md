# Starter Engineering Harness

A starter **AI-agent engineering harness** — a ready-to-adopt baseline that both
hosts its own harness and can emit the same shape into any target repository.
(The repo directory and tracking slug remain `meta-harness`.)

## What is a harness?

A harness is the durable, version-controlled context and capability layer around a
repository — an [AGENTS.md](AGENTS.md) brief, custom instructions, skills, a
knowledge base, reusable prompts, and session/progress tracking — that lets AI
coding agents work reliably, repeatably, and with minimal re-explanation each
session. It is **not** a hardware harness or a software *test* harness; here the
"device under test" is the agent's plan → act → verify loop.

## Two roles

1. **Self-hosting** — this repo uses its own harness (see `AGENTS.md`,
   `.github/`, `knowledge-base/`, `harness/state/`) to build and maintain itself.
2. **Generator** — the `build-harness` generator prompt scaffolds this same shape
   into other repos.

## Directory map

| Path | Purpose |
|------|---------|
| `AGENTS.md` | Single always-on agent brief (agent-facing contract) |
| `ADOPTING.md` | Adoption quickstart for consuming this generator |
| `PROGRESS.md` | Read-first / write-last resume file |
| `features.yml` | Committed feature inventory + statuses |
| `LICENSE` | MIT license |
| `.github/instructions/` | Path-scoped + on-demand rules |
| `.github/prompts/` | Reusable prompts (the `build-harness` generator prompt) |
| `.github/skills/` | On-demand workflows (`maintain-harness`, `scaffold-harness`, `review-session`) |
| `.github/agents/` | Personas (the `harness-builder` scaffolder) |
| `knowledge-base/` | Curated reference docs |
| `templates/` | Files the generator prompt emits into target repos |
| `harness-scripts/` | Optional executable layer (Node built-ins, fail-open): `validate`, `heal`, `doctor`, `guard`, session banners, `harness.mjs` verb dispatcher |
| `harness/` | Committed harness data: `doctor.yml` / `guards.yml` manifests, `incidents.jsonl`, and per-initiative `state/<slug>/state.md` (opt-in phase-aware tier; two-tier default is `PROGRESS.md` + `features.yml`) |
| `tests/` | Automated `node:test` suites plus their acceptance-procedure docs |
| `project-notes/` | Durable decision log, work summaries, and assessments |
| `.copilot-tracking/` | Ephemeral RPI scratch (research, plans); gitignored |

## How to use it

- **Adopt the harness into your repo**: see [ADOPTING.md](ADOPTING.md) — a
  quickstart for consuming this generator (run the prompt, or copy templates by
  hand) with a verification checklist and next steps.
- **Scaffold a harness into a repo**: run the `/build-harness` prompt (binds to the
  `harness-builder` agent). It walks a resumable, idempotent 6-phase flow
  (detect & resume → gather → confirm → scaffold → validate → summarize) and only
  creates missing files unless you opt in to overwrite.
- **Maintain an existing harness**: invoke the `maintain-harness` skill to audit
  for bloat, prune `AGENTS.md`, verify `applyTo` globs, refresh knowledge-base
  links, and archive completed tracking artifacts.
- **Validate the scaffold flow**: run `node --test` for the automated suites, or
  follow [tests/scaffold-new-project.test.md](tests/scaffold-new-project.test.md),
  an end-to-end acceptance procedure that scaffolds this harness into a throwaway
  target repo and asserts the doc harness, optional executable layer, deterministic
  validator, and non-destructive re-run all behave.

## For agents

Humans start here. **Agents should read [AGENTS.md](AGENTS.md) first**, then follow
its session start protocol.

## License

MIT — see [LICENSE](LICENSE). Copy the harness into your own repositories freely.
