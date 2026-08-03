// signature.mjs — shared failure/incident fingerprinting (Layer 1 leaf module).
//
// Turns a noisy failure string into a stable, path- timestamp- and id-invariant
// signature so the same failure recurring across sessions groups as one thing.
// Tiered normalization, first tier that yields a value wins (Sentry precedence
// model): T1 structured gate output (`FAIL: <check> — <file>: <message>`) beats
// T4 free prose, so callers pass the most structured string they have.
//
// Signatures are computed on the fly, never stored — harness/incidents.jsonl
// keeps no signature field, so the mask list can change without a migration
// (bump SIGNATURE_VERSION when it does, so v1 groups stop matching v2 groups).
//
// Pure: no I/O, no process access, no side effects on import. Node built-ins
// only (`node:crypto`) — no npm install.

import { createHash } from 'node:crypto';

// v2: the path masks match absolute paths only. v1 also masked repo-relative
// paths, which collapsed two different files under the same check into one
// signature and scored a partially-fixed run as no progress.
export const SIGNATURE_VERSION = 'v2';

/** N open occurrences of one signature -> promote to a deterministic guard. */
export const PROMOTE_THRESHOLD = 3;

/** Occurrences older than this (relative to the ledger's newest dated entry) stop counting. */
export const DECAY_WINDOW_DAYS = 30;

// Ordered mask list. Order is load-bearing: every structural pattern must
// consume its text before the generic bare-integer rule runs, or that rule
// shreds the very structure the earlier masks key on.
//
// Path masks are deliberately anchored to *absolute* paths: only the checkout
// location varies by machine. Repo-relative paths are identity, not noise — the
// validator emits them in every `FAIL:` detail, so masking them would merge
// distinct failures.
const MASKS = [
  [/\u001b\[[0-9;]*m/g, ''], // ANSI SGR
  [/[A-Za-z]:\\[^\s"']+/g, '<path>'], // Windows absolute path
  [/(?<![\w.-])\/(?:[\w.-]+\/)+[\w.-]+/g, '<path>'], // POSIX absolute path
  [/\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/g, '<ts>'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>'],
  [/\b0x[0-9a-f]+\b/gi, '<hex>'],
  [/\b[0-9a-f]{7,40}\b/gi, '<sha>'],
  [/:\d+:\d+\b/g, ':<line>:<col>'],
  [/\bline \d+\b/gi, 'line <n>'],
  [/"[^"]*"|'[^']*'/g, '<lit>'],
  [/\b\d+\b/g, '<n>'], // bare integers last of the value masks — every structural pattern above has already consumed its digits
  [/\s+/g, ' '], // whitespace normalizer, genuinely last
];

/** Apply the mask pipeline and reduce to a comparable canonical form. */
export function canonicalize(raw) {
  return MASKS.reduce((s, [re, to]) => s.replace(re, to), String(raw ?? ''))
    .trim()
    .toLowerCase();
}

/**
 * Fingerprint one failure. `kind` buckets the namespace (e.g. 'gate-fail',
 * 'incident'); two different kinds never collide. Returns `v2:<kind>:<12-hex>`
 * — 48 bits, well under the birthday bound at ledger scale, short enough to
 * print in a one-line failure message.
 */
export function signature(kind, raw) {
  const canon = canonicalize(raw);
  const hash = createHash('sha256').update(`${kind}\u0000${canon}`).digest('hex').slice(0, 12);
  return `${SIGNATURE_VERSION}:${kind}:${hash}`;
}

/**
 * Fingerprint a *set* of signatures (order- and duplicate-invariant), so two
 * runs that fail on exactly the same things compare equal — the no-progress
 * proof a loop cap consumes.
 */
export function signatureSet(signatures) {
  const sorted = [...new Set([...(signatures ?? [])].map((s) => String(s)))].sort();
  const hash = createHash('sha256').update(sorted.join('\n')).digest('hex').slice(0, 12);
  return `${SIGNATURE_VERSION}:set:${hash}`;
}

// Incidents carry no timestamp field; the date lives in `date` when present and
// otherwise in the `<prefix>-YYYY-MM-DD-NN` id convention. Undated records are
// never decayed out (fail-open — a missing date must not silence a recurrence).
const DATE_RE = /(\d{4})-(\d{2})-(\d{2})/;
function incidentDate(incident) {
  const m = DATE_RE.exec(String((incident && (incident.date || incident.id)) || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}

/**
 * Group open incidents by `detection_signal.type` + a signature of `root_cause`,
 * so prose drift, absolute paths, and ids no longer split one recurrence into
 * several. Occurrences older than DECAY_WINDOW_DAYS stop counting, giving the
 * counter a sliding window instead of an all-time tally (Resilience4j/Polly
 * precedent). The window is anchored on the ledger's own newest dated entry
 * rather than wall-clock now, so the same ledger always yields the same result.
 *
 * Returns Map<signatureKey, { n, sample, label }>; `label` is the human-readable
 * `type :: root_cause` form for display.
 */
export function groupIncidents(openIncidents, allIncidents = openIncidents) {
  const dates = [...(allIncidents ?? [])].map(incidentDate).filter((d) => d !== null);
  const cutoff = dates.length ? Math.max(...dates) - DECAY_WINDOW_DAYS * 86400000 : null;

  const groups = new Map();
  for (const i of openIncidents ?? []) {
    const at = incidentDate(i);
    if (cutoff !== null && at !== null && at < cutoff) continue; // decayed out of the window
    const type = (i.detection_signal && i.detection_signal.type) || 'unknown';
    const cause = (i.root_cause || '').trim();
    const key = `${type} :: ${signature('incident', cause)}`;
    const g = groups.get(key);
    if (g) g.n += 1;
    else groups.set(key, { n: 1, sample: i, label: `${type} :: ${cause.toLowerCase().slice(0, 80)}` });
  }
  return groups;
}
