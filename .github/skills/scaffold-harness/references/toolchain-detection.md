# Toolchain Detection

The single source of truth for turning a target repo's manifests into
`harness/doctor.yml` `tools:` entries during brownfield adoption. Both the
agent-driven adoption path and the opt-in
`node harness-scripts/harness.mjs doctor --scan --write` writer read this one
table so the detection stays consistent.

This reference ships with the [scaffold-harness](../SKILL.md) skill so it travels
with the generator into any repo that adopts the harness.

## Entry shape

Every appended entry mirrors the shape already in `harness/doctor.yml`: a `name`,
a `check` argv array spawned for presence, and an optional `required` flag.

```yaml
tools:
  - name: node
    check: ["node", "--version"]
    required: true
```

[harness-scripts/doctor.mjs](../../../../harness-scripts/doctor.mjs) supports
exactly one probe: it spawns the `check` argv and treats the tool as present
unless the spawn errors. Detection reuses this spawn-presence model. Do not
introduce a new probe type (no `file-exists`, no version-constraint parsing) —
presence on `PATH` is the whole contract.

## Mapping table

When a manifest below is found in the target, append its `tools:` entries. Each
`check` is the tool's own presence command.

| Manifest detected | `tools:` entries to append |
|-------------------|----------------------------|
| `package.json` (JS/TS) | `{name: node, check: ["node","--version"], required: true}`; `{name: npm, check: ["npm","--version"], required: false}` (add `{name: pnpm, check: ["pnpm","--version"], required: false}` or `{name: yarn, check: ["yarn","--version"], required: false}` when the matching lockfile is present) |
| `pyproject.toml` / `requirements.txt` (Python) | `{name: python, check: ["python","--version"], required: true}` (add `{name: uv, check: ["uv","--version"], required: false}` or `{name: poetry, check: ["poetry","--version"], required: false}` when configured) |
| `go.mod` (Go) | `{name: go, check: ["go","version"], required: true}` |
| `Cargo.toml` (Rust) | `{name: cargo, check: ["cargo","--version"], required: true}` |
| `pom.xml` / `build.gradle` (Java) | `{name: java, check: ["java","-version"], required: true}` (add `{name: mvn, check: ["mvn","--version"], required: false}` for Maven or `{name: gradle, check: ["gradle","--version"], required: false}` for Gradle) |
| `*.csproj` / `*.sln` (.NET) | `{name: dotnet, check: ["dotnet","--version"], required: true}` |

## Merge rule

Append-if-`name`-missing. Scan the existing `tools:` sequence; append only entries
whose `name` is not already present. Existing entries always win — never drop,
reorder, or rewrite a `tools:` entry the target already declares. This mirrors the
append-if-line-missing rule used for `.gitignore` / `.gitattributes` in the
brownfield flow, so re-running adoption is idempotent.

## Required default policy

* Primary runtime: `required: true`. The language interpreter or compiler a
  contributor cannot build without (`node`, `python`, `go`, `cargo`, `java`,
  `dotnet`).
* Package managers and linters: `required: false`. Secondary tools (`npm`, `pnpm`,
  `yarn`, `uv`, `poetry`, `mvn`, `gradle`) are advisory — their absence should not
  hard-fail the pre-flight check.
