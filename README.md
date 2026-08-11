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

## Three roles

1. **Self-hosting** — this repo uses its own harness (see `AGENTS.md`,
   `.github/`, `knowledge-base/`, `harness/state/`) to build and maintain itself.
2. **Generator** — the `build-harness` generator prompt scaffolds this same shape
   into other repos.
3. **Installer** — the dependency-free `starter-harness` CLI installs and updates
  the catalog-defined fixed core from the GitHub starter-kit package without
  adding a dependency to the target repository or publishing to npm.

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
| `installer/` | Package CLI, catalog planner, ownership manifest, and transactional executor |
| `package.json` | Private Git package and `starter-harness` executable contract |
| `harness-scripts/` | Optional executable layer (Node built-ins, fail-open): `validate`, `heal`, `doctor`, `guard`, session banners, `harness.mjs` verb dispatcher |
| `harness/` | Committed harness data: `doctor.yml` / `guards.yml` manifests, `incidents.jsonl`, and per-initiative `state/<slug>/state.md` (opt-in phase-aware tier; two-tier default is `PROGRESS.md` + `features.yml`) |
| `tests/` | Automated `node:test` suites plus their acceptance-procedure docs |
| `project-notes/` | Durable decision log, work summaries, and assessments |
| `.copilot-tracking/` | Ephemeral RPI scratch (research, plans); gitignored |

## How to use it

- **Install the fixed harness core**: after remote acceptance, use Node.js `>=18`
  and Git on `PATH`, then plan first with the canonical immutable package spec:
  `npx --yes github:wtulloch/harness-starter-kit#<TARGET-40-CHARACTER-COMMIT-SHA-AFTER-ACCEPTANCE> plan --target . --profile standard`.
  The placeholder is intentionally non-runnable until Phase 4 acceptance records
  the target SHA. After reviewing the plan, initialize with the same package spec
  and append the installer's `--yes`. The leading `npx --yes` accepts npm's
  remote-package prompt; a trailing `--yes` after `init` or `update` authorizes
  the installer mutation.
- **Install the generator without copying files**: use the same pinned package
  with `init --target . --profile full --yes`, then reload the target workspace
  in VS Code and run `/build-harness project-slug=<slug> profile=full
  overwrite=false`. The `full` profile installs the prompt, bound agent, skills,
  instructions, knowledge base, and templates needed by the generator.
- **Try mutable main**: after remote acceptance, the convenience form
  `npx --yes github:wtulloch/harness-starter-kit plan --target . --profile standard`
  follows mutable `main` and is not reproducible. Public repositories need no Git
  credentials; private access uses your Git HTTPS credential helper, personal
  access token, or SSH key, not npm registry authentication. The remote channel
  remains provisional until its target commit passes Phase 4 acceptance.
- **Adopt the harness into your repo**: see [ADOPTING.md](ADOPTING.md) — a
  quickstart for the full GitHub package workflow, authentication, pinning, and
  clone or explicit `npm exec --package` troubleshooting fallbacks.
- **Scaffold a harness into a repo**: after a full-profile installation, run the
  `/build-harness` prompt (binds to the `harness-builder` agent). It walks a
  resumable, idempotent 6-phase flow
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
