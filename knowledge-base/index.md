# Knowledge Base — Starter Engineering Harness

The curated reference layer for the starter engineering harness. [AGENTS.md](../AGENTS.md) links
here rather than inlining this content, keeping the always-on brief lean. Load a
document when the task matches its description.

## Documents

- [architecture.md](architecture.md) — How the harness primitives compose
  (prompt → agent → instructions → skills), the state-folder pattern, and the
  self-hosting generator model.
- [conventions.md](conventions.md) — Authoring and file-path conventions:
  description-as-discovery-surface, `applyTo` specificity, link-don't-embed,
  leanness discipline, and plain-text `.copilot-tracking/` citations.
- [glossary.md](glossary.md) — Harness-engineering terms and the harness vs
  hardware/test-harness distinction.
- [toolchain-detection.md](toolchain-detection.md) — Pointer to the manifest →
  `doctor.yml` mapping table, which ships with the generator at
  [.github/skills/scaffold-harness/references/toolchain-detection.md](../.github/skills/scaffold-harness/references/toolchain-detection.md).
