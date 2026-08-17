<!-- markdownlint-disable-file -->
# Test: Scaffold the Starter Harness into a New Project (End-to-End)

Manual acceptance test that validates using this starter harness to bootstrap a
**brand-new project** through the canonical `/build-harness` Agent Skill and the
`scaffold-harness` skill. Run the pinned host matrix first, then use the shared
stages for post-confirmation behavior.

- **Type**: end-to-end / smoke (manual, agent-driven with deterministic checks)
- **Under test**: the generator flow, template emission, non-destructive re-run,
  and the optional executable layer in a *target* repo — not this repo itself.
- **Duration**: one session.
- **Pass condition**: every step below reports **PASS**.

---

## Pinned two-host acceptance matrix

Run each host against a separate disposable target installed from the same
immutable package commit. Record the full 40-character `PACKAGE_SHA`, exact host
build, target path, optional agent availability, hook payload bytes, and result.
Do not substitute mutable `main`.

| Host | Disposable target | Required discovery route | Optional agent | Hook events to capture |
|------|-------------------|--------------------------|----------------|------------------------|
| VS Code Chat | `harness-vscode-acceptance` | One unambiguous route: `/build-harness` resolves the Agent Skill directly | Record whether `harness-builder` appears; absence is not a workflow failure | `SessionStart`, `Stop` |
| GitHub Copilot CLI | `harness-cli-acceptance` | `/env`, `/skills info build-harness`, then `/build-harness` | Record `/agent` or equivalent selection availability; absence is not a workflow failure | `sessionStart`, `agentStop`, `sessionEnd` |

For each target, initialize Git, make a seed commit, and install `full` from the
immutable package commit. Record the accepted source SHA from
`harness/installation.yml` and verify it equals `PACKAGE_SHA`. Then record a
baseline snapshot before invoking the host. The snapshot enumerates hidden,
untracked, and ignored entries and excludes only Git's internal `.git` directory:

```powershell
$PACKAGE_SHA = '<ACCEPTED-40-CHARACTER-COMMIT-SHA>'
$PACKAGE = "github:wtulloch/harness-starter-kit#$PACKAGE_SHA"
npx --yes $PACKAGE plan --target . --profile full
npx --yes $PACKAGE init --target . --profile full --yes
git add -A
git commit -qm "install pinned harness"
function Get-WorktreeSnapshot {
   Get-ChildItem -Force -Recurse | Where-Object {
      $_.FullName -notmatch '[\\/]\.git(?:[\\/]|$)'
   } | ForEach-Object {
      $RelativePath = [IO.Path]::GetRelativePath((Get-Location).Path, $_.FullName)
      if ($_.PSIsContainer) {
         [pscustomobject]@{ Path = $RelativePath; Type = 'directory'; Hash = $null }
      } else {
         [pscustomobject]@{ Path = $RelativePath; Type = 'file'; Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash }
      }
   } | Sort-Object Path | ConvertTo-Json -Depth 3
}
$BeforeSnapshot = Get-WorktreeSnapshot
```

The package installation is the planned setup mutation. The host invocation must
then reach the skill's confirmation-before-write gate with no target mutation.
Capture `$AfterSnapshot = Get-WorktreeSnapshot`, run
`Compare-Object ($BeforeSnapshot | ConvertFrom-Json) ($AfterSnapshot |
ConvertFrom-Json) -Property Path,Type,Hash`, and require no output. Do not approve
the plan until that comparison is captured. Fail if either host writes a tracked,
untracked, or ignored entry before explicit confirmation.

Record unavailable prerequisites as an explicit skip instead of a pass:

```text
SKIP: <host> - <missing binary | authentication | license | feature flag> - <exact observed reason>
```

Do not use `SKIP:` for discovery ambiguity, early mutation, the wrong package
SHA, or a malformed hook payload. Those are failures.

## VS Code Chat acceptance

Before starting VS Code, configure a temporary capture hook and an evidence path
outside the disposable target. The capture wrapper records exact stdin and the
exact JSON bytes it returns to the host:

```powershell
$EvidenceRoot = Join-Path (Split-Path (Get-Location)) 'harness-vscode-hook-evidence'
$CaptureScript = Join-Path $EvidenceRoot 'capture-hook.mjs'
New-Item -ItemType Directory -Force $EvidenceRoot, .github/hooks | Out-Null
@'
import { appendFileSync } from 'node:fs';
const [event, evidencePath] = process.argv.slice(2);
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const stdin = Buffer.concat(chunks);
const stdout = Buffer.from('{}\n');
appendFileSync(evidencePath, `${JSON.stringify({ event, stdinBase64: stdin.toString('base64'), stdoutBase64: stdout.toString('base64'), exitCode: 0 })}\n`);
process.stdout.write(stdout);
'@ | Set-Content -NoNewline $CaptureScript
$CaptureCommand = "node `"$CaptureScript`""
@{ version = 1; hooks = @{
   SessionStart = @(@{ type = 'command'; command = "$CaptureCommand SessionStart `"$EvidenceRoot/SessionStart.jsonl`"" })
   Stop = @(@{ type = 'command'; command = "$CaptureCommand Stop `"$EvidenceRoot/Stop.jsonl`"" })
} } | ConvertTo-Json -Depth 6 | Set-Content .github/hooks/acceptance-capture.json
```

Create this capture setup before assigning `$BeforeSnapshot`. Launch the pinned
VS Code build from the same shell so it inherits the command environment.

1. Create and open only the disposable `harness-vscode-acceptance` target in the
   pinned VS Code build. Confirm Agent Skills are enabled.
2. Verify `.github/skills/build-harness/SKILL.md` is discovered. Invoke one
   unambiguous route: `/build-harness project-slug=vscode-acceptance profile=full
   overwrite=false`. Do not invoke a prompt-file alias.
3. Record whether the optional `harness-builder` agent is selectable. Continue
   with the skill when it is absent.
4. Stop at the confirmation gate. Run the filesystem snapshot comparison; it
   must have no output.
5. Verify `$EvidenceRoot/SessionStart.jsonl` and `$EvidenceRoot/Stop.jsonl` contain
   base64 stdin and stdout records. Keep the installed shared `hooks.json` inert.
6. Approve only after the no-mutation evidence is recorded, then run the shared
   scaffold stages below.
7. After recording evidence, run
   `Remove-Item .github/hooks/acceptance-capture.json -Force` and
   `Remove-Item $EvidenceRoot -Recurse -Force`.

## GitHub Copilot CLI acceptance

Create the same external `capture-hook.mjs` wrapper before assigning
`$BeforeSnapshot`, but write the CLI event manifest with this command:

```powershell
@{ version = 1; hooks = @{
   sessionStart = @(@{ type = 'command'; command = "$CaptureCommand sessionStart `"$EvidenceRoot/sessionStart.jsonl`"" })
   agentStop = @(@{ type = 'command'; command = "$CaptureCommand agentStop `"$EvidenceRoot/agentStop.jsonl`"" })
   sessionEnd = @(@{ type = 'command'; command = "$CaptureCommand sessionEnd `"$EvidenceRoot/sessionEnd.jsonl`"" })
} } | ConvertTo-Json -Depth 6 | Set-Content .github/hooks/acceptance-capture.json
```

1. Create and enter only the disposable `harness-cli-acceptance` target. Start
   the pinned authenticated Copilot CLI build with Agent Skills enabled.
2. Run `/env` and record the CLI version, authentication state, repository root,
   and feature state. Run `/skills info build-harness` and verify it resolves
   `.github/skills/build-harness/SKILL.md` from the target.
3. Invoke `/build-harness project-slug=cli-acceptance profile=full
   overwrite=false`. Do not claim or test `.github/prompts` as a CLI command
   surface.
4. Record whether the optional `harness-builder` agent can be selected through
   `/agent` or the pinned build's documented equivalent. Continue with the skill
   when it is absent.
5. Stop at the confirmation gate. Run the filesystem snapshot comparison and
   require no output.
6. Verify the three event JSONL files preserve event name, base64 stdin, base64
   stdout, and exit code. Keep the installed shared `hooks.json` inert.
7. Approve only after the no-mutation evidence is recorded, then run the shared
   scaffold stages below.
8. Exit the CLI, then remove `.github/hooks/acceptance-capture.json` and
   `$EvidenceRoot` with the same teardown commands used for VS Code.

## Acceptance record

| Evidence | VS Code Chat | GitHub Copilot CLI |
|----------|--------------|--------------------|
| Host build |  |  |
| Disposable target |  |  |
| Immutable package commit |  |  |
| Skill discovery |  |  |
| Invocation route |  |  |
| Optional agent availability |  |  |
| Confirmation-before-write reached |  |  |
| Status/tree unchanged |  |  |
| Hook payload bytes captured |  |  |
| PASS / FAIL / explicit `SKIP:` |  |  |

---

## Preconditions

| # | Requirement | Check |
|---|-------------|-------|
| P1 | `node` on PATH (for the optional executable layer) | `node --version` prints a version |
| P2 | `git` on PATH (for tracking + session banner) | `git --version` prints a version |
| P3 | The pinned full-profile target contains the generator bootstrap | `.github/skills/build-harness/SKILL.md` and the scaffold templates exist |
| P4 | A writable scratch location outside this repo | PowerShell: `C:\sandbox\harness-test-target`; Bash: `/c/sandbox/harness-test-target` (Git Bash) or `/mnt/c/sandbox/harness-test-target` (WSL) |

> If Node is absent, P1 fails — run the **doc-only variant** (skip Stages 4–5 and
> assert the executable layer is *not* emitted in Stage 3).

---

## Test variables

| Variable | Example value |
|----------|---------------|
| `TARGET` | PowerShell: `C:\sandbox\harness-test-target`; Bash (Git Bash): `/c/sandbox/harness-test-target` |
| `SLUG`   | `demo-service` |
| `STACK`  | `typescript, node` |

Choose either PowerShell or Bash for the command blocks and use that shell
consistently. The examples below use Git Bash paths; in WSL, replace `/c/` with
`/mnt/c/`.

---

## Stage 0 — Set up a clean target repo

**Action** (choose one shell):

PowerShell:

```powershell
$TARGET = "C:\sandbox\harness-test-target"
Remove-Item -Recurse -Force $TARGET -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $TARGET | Out-Null
Set-Location $TARGET
git init -q
"# Demo Service`n`nThrowaway target for harness scaffold testing." | Set-Content README.md
git add -A; git commit -qm "seed target"
```

Bash:

```bash
TARGET="/c/sandbox/harness-test-target"
rm -rf "$TARGET"
mkdir -p "$TARGET"
cd "$TARGET"
git init -q
printf '# Demo Service\n\nThrowaway target for harness scaffold testing.\n' > README.md
git add -A && git commit -qm "seed target"
```

**Expected**: `$TARGET` exists, is an empty git repo with only `README.md`, and has
**no** `AGENTS.md`, `.github/`, `knowledge-base/`, `harness/`, or `harness-scripts/`.

- **Result**: ☐ PASS ☐ FAIL

---

## Stage 1 — Run the generator (Phases 0–2: detect → gather → confirm)

**Action**: With `$TARGET` open in the host under acceptance, invoke the canonical
Agent Skill:

```
/build-harness project-slug=demo-service stack="typescript, node"
```

**Expected**:
1. **Phase 0** reports an inventory with **all** harness files ❌ missing (clean repo).
2. **Phase 1** asks ≤7 focused scope questions, seeding answers from `README.md`.
3. **Phase 2** shows a compact spec + an explicit file plan and **waits** for
   confirmation. Nothing is written before you approve.

- **Result**: ☐ PASS ☐ FAIL

> Fail if the agent writes any file before the Phase 2 confirmation gate.

---

## Stage 2 — Scaffold the doc harness (Layer 0)

**Action**: Approve the Phase 2 plan; let Phase 3 run.

**Expected** — after Phase 3 these exist in `$TARGET` and parse:

| Path | Assertion |
|------|-----------|
| `AGENTS.md` | Present; single always-on brief; references `PROGRESS.md`, `features.yml`, state file |
| `PROGRESS.md` | Present |
| `features.yml` | Present; has `schema_version`, `status_legend`, `features` |
| `.github/instructions/` | ≥1 `*.instructions.md` with valid frontmatter |
| `.github/skills/` | ≥1 `SKILL.md` (includes a maintenance skill); folder name == `name` |
| `.github/prompts/` | ≥1 `*.prompt.md` |
| `knowledge-base/index.md` | Present with body docs linked |
| `harness/state/demo-service/state.md` | Present; slug matches `$SLUG` |
| `.gitignore` | Contains `.harness-local/` and `.copilot-tracking/` entries |
| `.gitattributes` | Contains `* text=auto eol=lf` (emitted files normalize to LF) |

**Verify** (choose one shell):

PowerShell:

```powershell
Test-Path AGENTS.md, PROGRESS.md, features.yml, `
  .github\instructions, .github\skills, .github\prompts, `
  knowledge-base\index.md, harness\state\demo-service\state.md
Select-String -Path .gitignore -Pattern '.harness-local' -Quiet
Select-String -Path .gitignore -Pattern '.copilot-tracking' -Quiet
Select-String -Path .gitattributes -Pattern 'eol=lf' -Quiet
```

Bash:

```bash
test -f AGENTS.md && test -f PROGRESS.md && test -f features.yml && \
   test -d .github/instructions && test -d .github/skills && \
   test -d .github/prompts && test -f knowledge-base/index.md && \
   test -f harness/state/demo-service/state.md
grep -qF '.harness-local' .gitignore
grep -qF '.copilot-tracking' .gitignore
grep -qF 'eol=lf' .gitattributes
```

- **Result**: ☐ PASS ☐ FAIL

> **Placeholder check**: PowerShell:
> `Select-String -Path AGENTS.md,PROGRESS.md,features.yml -Pattern '{{'`;
> Bash: `! grep -nF '{{' AGENTS.md PROGRESS.md features.yml`. The check must
> return no matches — no unsubstituted `{{placeholder}}` tokens remain.

---

## Stage 3 — Selected adoption profile emitted (Phase 3b)

**Action**: Inspect what Phase 3b did for the selected profile. The canonical
fixed-artifact membership is
[adoption-profiles.json](../.github/skills/scaffold-harness/references/adoption-profiles.json).
Run this stage once with each profile: `doc-only`, default `standard`, and `full`.

**Expected**:

| Path | Assertion |
|------|-----------|
| `harness-scripts/signature.mjs` | Emitted; an unconditional `import` of session-start, session-end, and backpressure-stats — if it is missing those three exit non-zero with `ERR_MODULE_NOT_FOUND` |
| `harness-scripts/banner.mjs` | Emitted; the output-mode adapter imported by session-start and session-end — if it is missing both exit non-zero with `ERR_MODULE_NOT_FOUND` |
| `harness-scripts/validate-harness.mjs` | Emitted (by default) |
| `harness-scripts/heal-harness.mjs` | Emitted; `node harness-scripts/harness.mjs heal` exits 0 on a healthy tree, exits 2 with repair directives on a fault |
| `harness-scripts/session-start.mjs` | Emitted |
| `harness-scripts/session-end.mjs` | Emitted; `node harness-scripts/harness.mjs session-end` is read-only, exits 0, and nudges review-session when a signature is at the promote threshold |
| `harness-scripts/backpressure-stats.mjs` | Emitted |
| `harness-scripts/guard.mjs` | Emitted; `node harness-scripts/harness.mjs guard` exits 0 with no trips recorded |
| `harness-scripts/harness.mjs` | Emitted; `node harness-scripts/harness.mjs validate` dispatches (exit 0), unknown verb exits 1, `--help` lists verbs |
| `harness-scripts/doctor.mjs` + `harness/doctor.yml` | Emitted (by default, no opt-in flag); `node harness-scripts/harness.mjs doctor` hard-gates on required-tool presence — exit 0 with `OK: <tool>` lines when present, exit 1 with a `MISSING:` line when a required tool is absent |
| `harness/guards.yml` | Emitted (by default, no opt-in flag); `node harness-scripts/harness.mjs guard` exits 0 with no trips recorded, and `heal-loop-cap` is declared at `enforce` so the AGENTS.md re-run cap is actually enforced |
| `harness/incidents.jsonl` | Emitted (by default, no opt-in flag) as an **empty** file; `node harness-scripts/harness.mjs backpressure-stats` exits 0 reporting 0 signatures, and the review-session skill has a ledger to append to |
| `.github/workflows/validate.yml` | `full` only; runs `node harness-scripts/validate-harness.mjs`, no install step |
| `.githooks/pre-commit` | `full` only; emitted but **not** auto-enabled; opt-in `git config core.hooksPath .githooks` documented |
| `.github/hooks/hooks.json` | `full` only; emits an inert shared `hooks` object with no lifecycle wiring; session scripts remain read-only operator commands |
| `harness/state/demo-service/state.md` | Records the selected profile when phase-aware state was requested |

**Verify** (choose one shell):

PowerShell:

```powershell
Test-Path harness-scripts\signature.mjs, harness-scripts\banner.mjs, harness-scripts\validate-harness.mjs, harness-scripts\heal-harness.mjs, harness-scripts\session-start.mjs, harness-scripts\session-end.mjs, harness-scripts\backpressure-stats.mjs, harness-scripts\guard.mjs, harness-scripts\harness.mjs, .github\workflows\validate.yml, .githooks\pre-commit
git config --get core.hooksPath   # must print nothing; scaffold does not activate the hook
Select-String -Path harness\state\demo-service\state.md -Pattern 'executable|emit' -Quiet
```

Bash:

```bash
test -f harness-scripts/signature.mjs && test -f harness-scripts/validate-harness.mjs && \
   test -f harness-scripts/banner.mjs && \
   test -f harness-scripts/heal-harness.mjs && \
   test -f harness-scripts/session-start.mjs && test -f harness-scripts/session-end.mjs && \
   test -f harness-scripts/backpressure-stats.mjs && test -f harness-scripts/guard.mjs && \
   test -f harness-scripts/harness.mjs && \
   test -f .github/workflows/validate.yml && test -f .githooks/pre-commit
test -z "$(git config --get core.hooksPath)" # scaffold must not activate the hook
grep -Eq 'executable|emit' harness/state/demo-service/state.md
```

- **Result**: ☐ PASS ☐ FAIL

> **Profile matrix**: `doc-only` has none of the executable, workflow, or hook
> artifacts. `standard` has the complete executable group and manifests, with
> workflow and hooks absent. `full` contains every `standard` artifact plus the
> workflow, pre-commit hook, and agent-hooks config. The pre-commit hook remains
> inactive in every case.

---

## Stage 4 — Deterministic validator passes in the target (Layer 1)

**Action** (choose one shell):

PowerShell:

```powershell
node harness-scripts/validate-harness.mjs; "validator exit: $LASTEXITCODE"
```

Bash:

```bash
node harness-scripts/validate-harness.mjs
validator_exit=$?
printf 'validator exit: %s\n' "$validator_exit"
test "$validator_exit" -eq 0
```

**Expected**: **no output** and `validator exit: 0` — the scaffolded tree is
self-consistent (frontmatter, skill name==folder, no bare `applyTo: "**"`,
features schema, single always-on file, resolvable links, plain-text tracking).

- **Result**: ☐ PASS ☐ FAIL

### 4b — Validator fails loudly on a seeded fault (negative test)

PowerShell:

```powershell
Set-Content knowledge-base\_faulttest.md "# fault`n[broken](does-not-exist.md)"
node harness-scripts/validate-harness.mjs; "exit: $LASTEXITCODE"
Remove-Item knowledge-base\_faulttest.md
```

Bash:

```bash
printf '# fault\n[broken](does-not-exist.md)\n' > knowledge-base/_faulttest.md
node harness-scripts/validate-harness.mjs
validator_exit=$?
printf 'exit: %s\n' "$validator_exit"
rm knowledge-base/_faulttest.md
test "$validator_exit" -eq 1
```

**Expected**: exactly **one** `FAIL: link — ...` line + summary, and `exit: 1`.

- **Result**: ☐ PASS ☐ FAIL

---

## Stage 5 — Session banner works read-only (Layer 3)

**Action** (choose one shell):

PowerShell:

```powershell
node harness-scripts/session-start.mjs; "session-start exit: $LASTEXITCODE"
git status --porcelain   # must be unchanged by the banner
```

Bash:

```bash
status_before="$(git status --porcelain)"
node harness-scripts/session-start.mjs
session_exit=$?
printf 'session-start exit: %s\n' "$session_exit"
status_after="$(git status --porcelain)"
test "$session_exit" -eq 0
test "$status_before" = "$status_after"
```

**Expected**: prints branch + dirty count, PROGRESS focus/next/blockers, features
rollup, `demo-service` state phase/step, and newest research (or a labeled
"(none)"); `session-start exit: 0`; the banner makes **no writes** (git status is
identical before/after).

- **Result**: ☐ PASS ☐ FAIL

---

## Stage 6 — Non-destructive idempotent re-run

**Action**: Edit one line in the scaffolded `AGENTS.md`, then re-run the generator
**without** overwrite:

```
/build-harness project-slug=demo-service
```

**Expected**:
1. Phase 0 inventory now shows the harness files ✅ present.
2. The scaffold **skips** existing files (create-missing-only) and does **not**
   revert your `AGENTS.md` edit.
3. Any genuinely missing piece is topped up; a run report lists created vs skipped.

**Verify**: your manual edit survives.

PowerShell:

```powershell
Select-String -Path AGENTS.md -Pattern '<your edited marker>' -Quiet   # True
```

Bash:

```bash
grep -qF '<your edited marker>' AGENTS.md
```

- **Result**: ☐ PASS ☐ FAIL

> Fail if the re-run overwrites or reverts any existing file when overwrite is false.

---

## Stage 7 — Tracking foundation is committable and consistent

**Action** (same in PowerShell and Bash):

```powershell
git add -A
git status --short
```

**Expected**:
1. `harness/state/demo-service/state.md`, `AGENTS.md`, `PROGRESS.md`,
   `features.yml`, `.github/**`, `knowledge-base/**`, and (if emitted)
   `harness-scripts/**` + `.github/workflows/validate.yml` are staged.
2. `.harness-local/` and `.copilot-tracking/` are **not** staged (gitignored).
3. `state.md` contains a `transition_log`/`session_log` entry for this scaffold.

- **Result**: ☐ PASS ☐ FAIL

---

## Stage 7b — Brownfield adoption into a non-empty target

**Action**: Repeat Stages 0–4 against a **pre-populated** target, one that already
has its own `AGENTS.md` (project-owned content), a `.github/copilot-instructions.md`,
a populated `.gitignore` (with real ignore lines but neither harness ignore), and
a legacy file containing a secret-like string. First decline or omit instruction
migration and verify that both instruction files remain unchanged. Then rerun,
explicitly consent to instruction migration, and let the generator adopt.

**Expected** — after Phase 3 reconciliation:

| Assertion | Check |
|-----------|-------|
| Managed block injected | `AGENTS.md` contains the `HARNESS:BEGIN`/`HARNESS:END` sentinels and the four harness-owned headings between them |
| Project sections preserved | The pre-existing project overview / build commands are unchanged |
| `.gitignore` appended, not clobbered | Existing lines survive **and** `.harness-local/` plus `.copilot-tracking/` are now present |
| Consent required | Before explicit migration consent, `.github/copilot-instructions.md` is preserved byte-for-byte and no AGENTS reconciliation write occurs |
| Consented migrate-and-delete | After explicit consent, `.github/copilot-instructions.md` is gone (its content migrated into `AGENTS.md` first); a normal validate run reports no `FAIL: always-on` |
| Check 17 gate | Stripping a required heading from the managed block yields `FAIL: managed-block` |
| Baseline posture | `node harness-scripts/validate-harness.mjs --baseline` downgrades the secret-like hit to a non-gating `WARN: secret-scan` (exit 0); a normal run reports `FAIL: secret-scan` (exit 1) |

**Verify**: the automated slice
[scaffold-new-project.test.mjs](scaffold-new-project.test.mjs) covers this stage
via its `brownfield-*` cases (managed-block injection, project-section
preservation, `.gitignore` append, pre-consent preservation, consented
migrate-and-delete, Check 17 positive/negative, and the `--baseline` secret-scan
posture).

- **Result**: ☐ PASS ☐ FAIL

---

## Stage 8 — Teardown

PowerShell:

```powershell
Set-Location C:\sandbox\meta-harness
Remove-Item -Recurse -Force C:\sandbox\harness-test-target
```

Bash (Git Bash):

```bash
cd /c/sandbox/meta-harness
rm -rf /c/sandbox/harness-test-target
```

**Expected**: target removed; this starter repo untouched (`git status` here is
whatever it was before the test — the test only wrote inside `$TARGET`).

- **Result**: ☐ PASS ☐ FAIL

---

## Results summary

| Stage | Description | Result |
|-------|-------------|--------|
| 0 | Clean target repo | ☐ |
| 1 | Generator detect → gather → confirm gate | ☐ |
| 2 | Doc harness (Layer 0) scaffolded + parses | ☐ |
| 3 | Executable layer emitted on detected runtime | ☐ |
| 4 | Validator passes clean (Layer 1) | ☐ |
| 4b | Validator fails loudly on seeded fault | ☐ |
| 5 | Session banner read-only (Layer 3) | ☐ |
| 6 | Non-destructive idempotent re-run | ☐ |
| 7 | Tracking committable + local harness directories ignored | ☐ |
| 7b | Brownfield adoption into a non-empty target | ☐ |
| 8 | Teardown | ☐ |

**Overall**: ☐ PASS (all stages PASS) ☐ FAIL

### Notes / defects

-
