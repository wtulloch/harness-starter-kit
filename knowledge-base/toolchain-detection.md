# Toolchain Detection

**Moved.** The manifest → `harness/doctor.yml` mapping table now ships with the
generator so it travels into every adopting repo:
[.github/skills/scaffold-harness/references/toolchain-detection.md](../.github/skills/scaffold-harness/references/toolchain-detection.md).

That reference covers the entry shape, the per-stack mapping table (JS/TS,
Python, Go, Rust, Java, .NET), the append-if-`name`-missing merge rule, and the
`required` default policy. This page is a pointer only — do not re-inline the
table here.
