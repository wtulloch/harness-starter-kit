# Starter Harness References

These starter-owned references explain the reusable harness model and travel with
the `scaffold-harness` skill. They are not the generated project's knowledge
base. A target repository owns and curates its root `knowledge-base/` content.

## Documents

- [architecture.md](architecture.md) — How the harness primitives compose
  (prompt → agent → instructions → skills), the state-folder pattern, and the
  self-hosting generator model.
- [conventions.md](conventions.md) — Authoring and file-path conventions:
  description-as-discovery-surface, `applyTo` specificity, link-don't-embed,
  leanness discipline, and development workflow ownership.
- [glossary.md](glossary.md) — Harness-engineering terms and the harness vs
  hardware/test-harness distinction.
- [toolchain-detection.md](../toolchain-detection.md) — Canonical manifest to
  `doctor.yml` mapping used during brownfield adoption.