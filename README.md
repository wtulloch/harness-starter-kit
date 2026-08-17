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
  `.github/skills/scaffold-harness/references/starter-harness/`, and
  `harness/state/`) to build and maintain itself.
2. **Generator** — the canonical `build-harness` Agent Skill scaffolds this same
  shape into other repos from VS Code Chat or GitHub Copilot CLI.
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
| `.github/prompts/` | Thin VS Code-specific prompt adapters, when needed |
| `.github/skills/` | Canonical shared workflows (`build-harness`, `maintain-harness`, `scaffold-harness`, `review-session`) |
| `.github/agents/` | Optional personas (the `harness-builder` scaffolder) |
| `.github/skills/scaffold-harness/references/starter-harness/` | Starter-owned architecture, conventions, glossary, and index |
| `knowledge-base/` | Project-owned generator output; absent in this source repo |
| `.github/skills/scaffold-harness/assets/templates/` | Source templates the scaffold skill emits into target repos |
| `installer/` | Package CLI, catalog planner, ownership manifest, and transactional executor |
| `package.json` | Private Git package and `starter-harness` executable contract |
| `harness-scripts/` | Optional executable layer (Node built-ins, fail-open): `validate`, `heal`, `doctor`, `guard`, session banners, `harness.mjs` verb dispatcher |
| `harness/` | Committed harness data: `doctor.yml` / `guards.yml` manifests, `incidents.jsonl`, and per-initiative `state/<slug>/state.md` (opt-in phase-aware tier; two-tier default is `PROGRESS.md` + `features.yml`) |
| `tests/` | Automated `node:test` suites plus their acceptance-procedure docs |
| `project-notes/` | Durable decision log, work summaries, and assessments |
| `.harness-local/` | Ignored, non-authoritative executable runtime state |

## How to use it

- **Install the fixed harness core**: use Node.js `>=22` and Git on `PATH`, then
  plan first with the canonical semantic-version package spec:
  `npx --yes github:wtulloch/harness-starter-kit#v0.7.1 plan --target .`.
  The immutable release tag is published from `package.json`; acceptance also
  records its resolved target SHA for byte-exact provenance. After reviewing the
  plan, initialize with the same package spec and append the installer's `--yes`.
  The leading `npx --yes` accepts npm's
  remote-package prompt; a trailing `--yes` after `init` or `update` authorizes
  the installer mutation. Brownfield migration of
  `.github/copilot-instructions.md` is separate consent: add
  `--migrate-instructions` to both `plan` and `init`, for example
  `plan --target . --migrate-instructions`, then
  `init --target . --migrate-instructions --yes`.
- **Install the generator without copying files**: use the same pinned package
  with `init --target . --profile full --yes`. Open the disposable target in VS
  Code Chat or start GitHub Copilot CLI there, then invoke the canonical Agent
  Skill with `/build-harness project-slug=<slug> profile=full overwrite=false`.
  The optional `harness-builder` agent may refine the experience, but it does not
  own the workflow. `.github/prompts` is a VS Code-specific adapter surface and
  is not a Copilot CLI workflow surface.
- **Try mutable main**: after remote acceptance, the convenience form
  `npx --yes github:wtulloch/harness-starter-kit plan --target .`
  follows mutable `main` and is not reproducible. Public repositories need no Git
  credentials; private access uses your Git HTTPS credential helper, personal
  access token, or SSH key, not npm registry authentication. The remote channel
  remains provisional until its target commit passes Phase 4 acceptance.
- **Adopt the harness into your repo**: see [ADOPTING.md](ADOPTING.md) — a
  quickstart for the full GitHub package workflow, authentication, pinning, and
  clone or explicit `npm exec --package` troubleshooting fallbacks.
- **Scaffold a harness into a repo**: after a full-profile installation, run the
  `/build-harness` Agent Skill in VS Code Chat or GitHub Copilot CLI. It walks a
  resumable, idempotent 6-phase flow
  (detect & resume → gather → confirm → scaffold → validate → summarize) and only
  creates missing files unless you opt in to overwrite.
- **Maintain an existing harness**: invoke the `maintain-harness` skill to audit
  for bloat, prune `AGENTS.md`, verify `applyTo` globs, audit any project-owned
  knowledge-base links, and archive completed tracking artifacts.
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
