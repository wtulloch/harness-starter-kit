# Adopting the Harness

A quickstart for **consuming this generator** — scaffolding the harness shape into
your own repository. For what a harness is and how the pieces compose, see
[README.md](README.md); for the agent-facing contract, see [AGENTS.md](AGENTS.md).

## Prerequisites

- VS Code with an agent that reads `.github/` customization files and `AGENTS.md`.
- Node.js `>=18`, including npm/npx, and Git on `PATH` for direct package execution.
   The installed `standard` and `full` profiles use dependency-free Node scripts;
   a manually copied `doc-only` profile needs no runtime.
- Git access to `wtulloch/harness-starter-kit`. Public access needs no credentials.
   Private access uses the credentials Git already recognizes, such as an HTTPS
   credential helper, a personal access token, or an SSH key. npm registry login
   and npm tokens are not used.

## Package installer

Use the GitHub-hosted `starter-harness` package when you want the deterministic
fixed profile core without adding a dependency to the target repository. The
repository is not published to the npm registry.

> [!IMPORTANT]
> The remote channel has not yet passed acceptance. The stable examples below
> use an intentionally non-runnable target-SHA placeholder, and the mutable-main
> example documents intended syntax rather than verified remote behavior.

Always plan first. For repeatable adoption, replace the placeholder with the full
40-character target commit SHA recorded after acceptance:

```bash
npx --yes "github:wtulloch/harness-starter-kit#<TARGET-40-CHARACTER-COMMIT-SHA-AFTER-ACCEPTANCE>" plan --target . --profile standard
npx --yes "github:wtulloch/harness-starter-kit#<TARGET-40-CHARACTER-COMMIT-SHA-AFTER-ACCEPTANCE>" init --target . --profile standard --yes
```

The first `--yes`, before the GitHub package spec, belongs to npx and accepts its
remote-package installation prompt. The final `--yes`, after the installer
arguments, belongs to `starter-harness` and authorizes a mutating `init` or
`update`. Planning is read-only and needs no trailing installer approval.

The unpinned form follows the repository's mutable default branch (`main`). Use it
only when you intentionally want the latest available source rather than a
reproducible installation:

```bash
npx --yes github:wtulloch/harness-starter-kit plan --target . --profile standard
```

`standard` is the default; `doc-only` and `full` are also supported. The CLI reads
the canonical profile catalog directly, preflights every path and ownership
conflict, and writes nothing when planning or when any conflict exists. It records
source and installed hashes in `harness/installation.yml`. Use the same immutable
package spec for later inspection and maintenance:

```bash
npx --yes "github:wtulloch/harness-starter-kit#<TARGET-40-CHARACTER-COMMIT-SHA-AFTER-ACCEPTANCE>" status --target .
npx --yes "github:wtulloch/harness-starter-kit#<TARGET-40-CHARACTER-COMMIT-SHA-AFTER-ACCEPTANCE>" update --target . --yes
npx --yes "github:wtulloch/harness-starter-kit#<TARGET-40-CHARACTER-COMMIT-SHA-AFTER-ACCEPTANCE>" validate --target .
npx --yes "github:wtulloch/harness-starter-kit#<TARGET-40-CHARACTER-COMMIT-SHA-AFTER-ACCEPTANCE>" doctor --target .
```

Updates replace unchanged harness-managed scripts, refresh only the sentinel-owned
block in `AGENTS.md`, preserve seeded tracking files, and restore missing owned
shared-file lines. Cumulative upgrades are supported; profile downgrades and
force-overwrites are refused. Brownfield initialization migrates legacy Copilot
instructions verbatim before deleting the old file and runs baseline validation.
The `doc-only` profile validates installer ownership but intentionally skips the
unavailable executable validator and doctor.

The package installs only the catalog-defined fixed core. Use the generator flow
below when you also want project-specific instructions, skills, prompts, agents,
knowledge-base content, or phase-aware state.

### Package troubleshooting

If npx cannot infer the executable, select the package and binary explicitly:

```bash
npm exec --yes --package="github:wtulloch/harness-starter-kit#<TARGET-40-CHARACTER-COMMIT-SHA-AFTER-ACCEPTANCE>" -- starter-harness plan --target . --profile standard
```

If npm's temporary Git clone fails, verify direct Git access and run the installer
from an inspected checkout. Keep the checkout pinned to the same accepted commit:

```bash
git clone https://github.com/wtulloch/harness-starter-kit.git
cd harness-starter-kit
git checkout <TARGET-40-CHARACTER-COMMIT-SHA-AFTER-ACCEPTANCE>
node installer/cli.mjs plan --target /path/to/target --profile standard
```

For a private repository, fix `git clone` authentication first. Clearing npm
registry credentials does not repair GitHub Git authentication. After a successful
plan, run `init` against the same checkout and target, adding the installer's
trailing `--yes` only when you are ready to write.

## Option A — Generate into your repo (recommended)

1. Copy this repo's `.github/prompts/build-harness.prompt.md`,
   `.github/agents/harness-builder.agent.md`, `.github/skills/`, and `templates/`
   into your target repo (or open your repo in a workspace alongside this one).
   The complete Git package mirror at
   [wtulloch/harness-starter-kit](https://github.com/wtulloch/harness-starter-kit)
   carries the same generator surface if you prefer an inspected clone.
2. Run the generator prompt:

   ```
   /build-harness project-slug=my-service
   ```

   Optional inputs: `stack=...` to tailor instructions, `overwrite=false`
   (default) to keep adoption non-destructive, and
   `profile={doc-only|standard|full}`. `standard` is the default.
3. Answer the short interview (purpose, stack, build/test commands, conventions,
   desired skills). The generator seeds answers from your README / package manifest.
4. Review the file plan at the **Phase 2 confirm gate** — nothing is written until
   you approve.
5. The generator scaffolds only missing files (create-missing-only), then validates
   and summarizes what it created and how to invoke each piece.

The flow is **resumable and idempotent**: re-running tops up genuinely missing
files without reverting your edits, unless you pass `overwrite=true`.

## Adoption profiles

The canonical fixed-artifact membership lives in
[adoption-profiles.json](.github/skills/scaffold-harness/references/adoption-profiles.json).
The generator reads that catalog directly:

- `doc-only` emits the fixed Layer 0 foundation with no executable artifacts.
- `standard` is the default and adds the complete executable group plus doctor
   and guard manifests.
- `full` adds the validation workflow, inert local pre-commit hook, and GitHub
   Copilot agent-hooks configuration.

Profiles are cumulative. Re-running with a larger profile tops up missing files
without replacing existing content unless `overwrite=true` was approved. The
executable group is atomic and is never partially emitted.

## Option B — Copy templates manually

If you'd rather not run the generator, emit the baseline by hand from `templates/`:

| Emit to | From template | Notes |
|---------|---------------|-------|
| `AGENTS.md` | `templates/AGENTS.md.template` | Fill `{{...}}` placeholders |
| `PROGRESS.md` | `templates/PROGRESS.md.template` | Read-first / write-last resume file |
| `features.yml` | `templates/features.yml.template` | Feature inventory + statuses |
| `harness/state/<slug>/state.md` | `templates/state.md.template` | **Opt-in** third tier — emit only for multi-session initiatives needing phase-aware resume; the two-tier default is `PROGRESS.md` + `features.yml` |
| `harness/incidents.jsonl` | `templates/incidents.jsonl.template` | Empty seed; strip the `{{! ... }}` header |
| `harness/doctor.yml` | `templates/doctor.yml.template` | Populated during the interview (git always seeded); default-emitted like the incidents log, not gated behind an opt-in |
| `harness/guards.yml` | `templates/guards.yml.template` | Default-emitted; declares the loop guards `guard.mjs` evaluates — without it the "re-run heal at most 3 times" rule in `AGENTS.md` has nothing enforcing it |

Strip each template's leading `{{! ... }}` generator-header lines on emit (they are
not valid content). Add a `.gitignore` (ignoring `.copilot-tracking/`) and a
`.gitattributes` with `* text=auto eol=lf` so committed files normalize to LF.

### Standard and full executable layer

The `standard` and `full` profiles include the deterministic gate (Node built-ins
only, no `npm install`). The files are repo-agnostic and copied verbatim from the
live source. Use the profile catalog for the authoritative path list.

| Emit to | Copy from (live source) |
|---------|-------------------------|
| `harness-scripts/signature.mjs` | `harness-scripts/signature.mjs` |
| `harness-scripts/validate-harness.mjs` | `harness-scripts/validate-harness.mjs` |
| `harness-scripts/heal-harness.mjs` | `harness-scripts/heal-harness.mjs` |
| `harness-scripts/session-start.mjs` | `harness-scripts/session-start.mjs` |
| `harness-scripts/session-end.mjs` | `harness-scripts/session-end.mjs` |
| `harness-scripts/backpressure-stats.mjs` | `harness-scripts/backpressure-stats.mjs` |
| `harness-scripts/guard.mjs` | `harness-scripts/guard.mjs` |
| `harness-scripts/harness.mjs` | `harness-scripts/harness.mjs` |
| `harness-scripts/doctor.mjs` | `harness-scripts/doctor.mjs` |

Copy the whole table or none of it. `signature.mjs` is an unconditional `import`
of `session-start`, `session-end`, and `backpressure-stats`, and `harness.mjs`
dispatches a verb to every other script — so a partial copy gives you a target
that crashes on invocation rather than one that fails open.

`harness-scripts/harness.mjs` is a command-verb dispatcher — `node harness-scripts/harness.mjs
validate` is an alias for `node harness-scripts/validate-harness.mjs` (raw calls stay the
fail-open baseline).

### Full-profile automation

The `full` profile adds shared CI/git infrastructure and GitHub Copilot agent
hooks. The local hook file is emitted but never activated automatically:

| Emit to | Copy from (live source) |
|---------|-------------------------|
| `.github/workflows/validate.yml` | `.github/workflows/validate.yml` |
| `.githooks/pre-commit` | `.githooks/pre-commit` |

To enable the emitted pre-commit gate, opt in with
`git config core.hooksPath .githooks`; emitting the file does not activate it.

### GitHub Copilot agent-hooks config

`.github/hooks/hooks.json` wires GitHub Copilot's agent-hooks feature
(`sessionStart` → `session-start.mjs`, `agentStop` → `session-end.mjs`) so the
read-only banner/checklist scripts run automatically at session boundaries
instead of relying on the agent remembering to invoke them. It is part of the
`full` profile:

| Emit to | Copy from (live source) |
|---------|-------------------------|
| `.github/hooks/hooks.json` | `.github/hooks/hooks.json` |

**Honest limitation**: the scripts print plain-text banners, not the single-line
JSON (`{"additionalContext": "..."}`) the hook runtime requires to inject output
back into the agent's context — so this automates the *trigger* (the scripts run
without the agent remembering to), not automatic context injection, and it never
replaces the agent actually reading `PROGRESS.md` per the committed session
protocols. Detecting which backpressure is worth capturing remains agent/human
judgment (see decisions-log D-15) — the hook cannot make that call for you.

## Brownfield adoption (a repo that already has files)

The generator adopts into a **pre-existing** repo non-destructively: it never
clobbers project-owned content, appends rather than overwrites shared files, and
makes the first validate run advisory so pre-existing noise cannot block you. The
`scaffold-harness` skill and the `harness-builder` agent both follow this flow;
`/build-harness` runs it automatically once Phase 0 detects existing files.

### 1. Detect — the four-state policy matrix

Phase 0 inventory classifies the always-on layer into one of four states and picks
a reconciliation action:

| Pre-existing files | Action |
|--------------------|--------|
| Neither `AGENTS.md` nor `.github/copilot-instructions.md` | Emit `AGENTS.md` fresh from the template (greenfield within a brownfield tree) |
| `AGENTS.md` only | Inject the harness **managed block**; leave project-owned sections untouched |
| `.github/copilot-instructions.md` only | Migrate its content into a new `AGENTS.md`, add the managed block, then delete `copilot-instructions.md` |
| Both | Inject the managed block into `AGENTS.md`, migrate `copilot-instructions.md` content into it, then delete `copilot-instructions.md` |

### 2. Reconcile `AGENTS.md` — managed-block injection

Harness-owned sections (the session start/end protocols, repository conventions,
and the knowledge-base pointers) are written between two idempotent sentinels:

```text
<!-- HARNESS:BEGIN (managed by scaffold-harness — edits inside are overwritten) -->
...harness-owned sections...
<!-- HARNESS:END -->
```

Re-running **replaces only the body between the sentinels** and leaves everything
outside them — your project overview, setup, build/test commands, and security
notes — exactly as you wrote it. When the block is absent it is appended to the
end of the file; when present it is updated in place. Validator Check 17
(`managed-block`) asserts the four harness-owned headings are present between the
sentinels, so `local == CI` proves the merge actually landed — Check 5 only proves
the file exists.

**Migrate-and-delete** is the one intentional, announced removal: any
`.github/copilot-instructions.md` content is migrated into the `AGENTS.md` project
sections *first*, the removal is announced, and only then is the file deleted —
there is no silent data loss. This keeps the single-always-on rule satisfied and
Check 5 green (never two co-shipped always-on files).

### 3. Populate `harness/doctor.yml` — manifest scan

Adoption scans your repo's manifests (`package.json`, `pyproject.toml`, `go.mod`,
`Cargo.toml`, `pom.xml` / `build.gradle`, `*.csproj`) and appends matching
pre-flight tool checks, following the mapping in
[.github/skills/scaffold-harness/references/toolchain-detection.md](.github/skills/scaffold-harness/references/toolchain-detection.md).
The merge is **append-if-`name`-missing**: existing entries win, so re-running
never duplicates or overwrites a tool you already tuned. `doctor.mjs` is unchanged
— every appended entry uses the same spawn-presence model as the seeded `git`
check.

### 4. Append shared files — `.gitignore` / `.gitattributes`

These line-oriented files are **create-then-append-if-line-missing**: when absent
they are created with the harness lines; when present only the missing lines are
appended and your existing entries are preserved. Adoption always lands
`.copilot-tracking/`, `.env`, `.env.*`, and `!.env.example` in `.gitignore`, and
`* text=auto eol=lf` in `.gitattributes`.

### 5. Baseline-validate — advisory first run

Run the validator once in **baseline** mode so pre-existing content the harness did
not author does not block adoption:

```bash
node harness-scripts/validate-harness.mjs --baseline
```

`--baseline` downgrades the whole-tree / pre-existing checks (`frontmatter`,
`skill-name`, `applyTo`, `always-on`, `link`, `agents-budget`, `secret-scan`) to
non-gating `WARN:` advisories and exits 0 unless a non-advisory check fails. Treat
the advisories as a punch list, fix them at your pace, then drop `--baseline` for
the normal gating run (`local == CI`).

## Verify the adoption

- Doc-only: open the scaffolded files and confirm frontmatter, links, and the
  session protocols in `AGENTS.md` make sense for your repo.
- With Node: run `node harness-scripts/validate-harness.mjs` (silent pass / loud fail) —
  or the verb form `node harness-scripts/harness.mjs validate` — and, if present,
  `node harness-scripts/session-start.mjs` for the read-only state banner. On a failing
  validator, `node harness-scripts/harness.mjs heal` re-emits each failure as a structured
  repair directive (exit 2) so you know exactly what to fix. Before stopping,
  `node harness-scripts/harness.mjs session-end` prints the wrap-up checklist and, when a
  recurring incident signature hits the promote threshold, tells you to run the
  review-session skill.
- The validator also enforces a deterministic **AGENTS.md line budget** (200
  lines by default — tune the `AGENTS_LINE_BUDGET` constant for your repo), a
  conservative **secret-scan** (AWS keys, GitHub/Slack tokens, PEM headers,
   generic `api_key=`/`secret=` assignments), and, under the `full` profile, that
   `.github/hooks/hooks.json` is well-formed JSON whose
  referenced scripts exist, across every committed file — all fail loud, same as
  every other check.

## Next steps

1. Populate `knowledge-base/` with your repo's real architecture, conventions, and
   glossary — link from `AGENTS.md`, don't inline.
2. Add repo-specific `.github/instructions/*.instructions.md` with tight `applyTo`
   globs.
3. Start each session by reading `PROGRESS.md`; end by updating it plus
   `features.yml` (and the active `state.md` if the initiative opted into the
   phase-aware third tier).
4. When a session hits repeated errors or thrash, run the `review-session` skill to
   capture the struggle and escalate to a deterministic fix.
