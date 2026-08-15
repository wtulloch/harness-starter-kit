// banner.mjs — output-mode adapter for the read-only session banners (Layer 3 leaf module).
//
// Default 'text' mode is the human/CI multi-line banner (unchanged). Opt-in
// 'additional-context' mode collapses the SAME accumulated lines into the
// single-line `{"additionalContext":"..."}` envelope the GitHub Copilot hooks
// runtime injects as model-facing context — the only stdout shape that reaches
// the model on a sessionStart hook (multi-line plain text falls through as "no
// output"). Ship OFF by default: nothing wires this mode until pinned payload
// evidence (DR-01/WI-01) confirms the host byte behavior.
//
// Pure: no I/O, no writes, no process access on import. Node built-ins only.

// Host context ceiling is UNVERIFIED until DR-01 pinned payload evidence lands;
// this conservative cap prevents a silently host-truncated injection.
export const MAX_CONTEXT_BYTES = 8 * 1024;

/** Parse `--emit=<mode>` from argv; unknown or absent falls back to 'text'. */
export function emitMode(argv = process.argv.slice(2)) {
  const flag = argv.find((a) => a.startsWith('--emit='));
  const mode = flag ? flag.slice('--emit='.length) : 'text';
  return mode === 'additional-context' ? mode : 'text';
}

/**
 * Render accumulated banner `lines` for the chosen mode.
 * - 'text': the multi-line banner plus a trailing newline (unchanged default).
 * - 'additional-context': one physical line of JSON whose value may contain \n,
 *   size-capped. Returns '' when there is nothing to inject so the host treats
 *   it as "no output" rather than injecting an empty context.
 */
export function render(lines, mode = 'text') {
  const text = lines.join('\n');
  if (mode !== 'additional-context') return text + '\n';
  if (!text.trim()) return '';
  let value = text;
  if (Buffer.byteLength(value, 'utf8') > MAX_CONTEXT_BYTES) {
    value = value.slice(0, MAX_CONTEXT_BYTES - 32) + '\n… (truncated)';
  }
  // JSON.stringify emits one physical line and escapes embedded newlines to \n.
  return JSON.stringify({ additionalContext: value }) + '\n';
}
