/**
 * H8 — markup handling.
 *
 * Policy (DECISIONS.md D-006): STRIP, do not allowlist. Only 866 of 193,155
 * records contain markup and it is uniformly junk from a broken export —
 * `<p>...<\p>` wrappers with malformed closing tags and `&;`-mangled entities.
 * There is no formatting worth preserving, so the safest handling is to reduce
 * everything to plain text at build time and render through ordinary React
 * interpolation, which escapes by default.
 *
 * Consequence: `dangerouslySetInnerHTML` appears nowhere in the codebase, so
 * §13 anti-requirement 6 is satisfied structurally rather than by a sanitiser
 * that must be trusted at every call site. This function is nevertheless unit
 * tested against script-injection payloads (§12) because it runs over untrusted
 * dataset text.
 *
 * Pure and total: any input string produces a plain-text output string.
 */

/** Entities actually observed in the corpus, plus the standard five. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  deg: '°',
  plusmn: '±',
  times: '×',
  micro: 'µ',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
});

/**
 * Elements whose *content* is not renderable text and must be discarded along
 * with the tags. Without this, stripping `<script>alert(1)</script>` would leave
 * the bare string `alert(1)` in the stem.
 */
const VOID_CONTENT_RE =
  /<\s*(script|style|iframe|object|embed|noscript|template)\b[^>]*>[\s\S]*?<[\s/\\]*\1\s*>/gi;
/** An unterminated dangerous element: drop everything from the tag onward. */
const VOID_CONTENT_UNCLOSED_RE =
  /<\s*(?:script|style|iframe|object|embed|noscript|template)\b[\s\S]*$/gi;

/**
 * Any tag-like construct. Tolerates the corpus's malformed closers (`<\p>`) and
 * unterminated tags. Deliberately greedy about what counts as a tag: this output
 * is rendered as text, so over-stripping is a cosmetic bug and under-stripping is
 * a security bug.
 */
const TAG_RE = /<[\s/\\!?]*[a-zA-Z][^<>]*>|<[\s/\\]*[a-zA-Z][^<>]*(?=<|$)/g;

/**
 * Comments, CDATA, doctypes, processing instructions, and bare `</` fragments —
 * anything opening with `<` followed by `!`, `?`, `/` or `\`, terminated or not.
 *
 * Kept separate from TAG_RE because TAG_RE requires a letter after the opening
 * punctuation, so a bare `<?` or `</` would otherwise survive. Unlike `<b` in
 * `a<b`, these sequences never occur in legitimate medical prose, so stripping
 * them unterminated costs nothing.
 */
const PI_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[!?/\\][^<>]*>?/g;

const NUMERIC_ENTITY_RE = /&#([xX][0-9a-fA-F]+|\d+);/g;
const NAMED_ENTITY_RE = /&([a-zA-Z][a-zA-Z0-9]{1,10});/g;
/** The corpus's signature breakage: `Park&;s`, an entity that lost its name. */
const MANGLED_ENTITY_RE = /&\s*;/g;

/**
 * Code-point ranges removed outright: C0/C1 controls except tab and newline,
 * zero-width characters, bidi overrides, and the BOM.
 *
 * Bidi overrides matter more here than they usually would — they can visually
 * reorder an option's text, which in a medical MCQ is a correctness hazard, not
 * a rendering quirk.
 *
 * Expressed as numeric ranges rather than a regex character class so that no
 * literal control byte ever appears in this source file.
 */
const STRIPPED_RANGES: readonly (readonly [number, number])[] = Object.freeze([
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
]);

function isStrippedCodePoint(cp: number): boolean {
  for (const range of STRIPPED_RANGES) {
    if (cp >= range[0] && cp <= range[1]) return true;
  }
  return false;
}

function stripControlCharacters(s: string): string {
  let out = '';
  // `for..of` iterates whole code points and never yields an empty string, so
  // codePointAt(0) is always defined here.
  for (const ch of s) {
    if (!isStrippedCodePoint(ch.codePointAt(0) as number)) out += ch;
  }
  return out;
}

function decodeNumeric(_match: string, body: string): string {
  const isHex = body.startsWith('x') || body.startsWith('X');
  const cp = isHex ? Number.parseInt(body.slice(1), 16) : Number.parseInt(body, 10);
  // Guard the full domain of String.fromCodePoint up front: anything outside the
  // printable range, above the Unicode maximum, or in the lone-surrogate block
  // becomes a space. With those excluded fromCodePoint cannot throw, so there is
  // no catch clause here to go untested.
  if (!Number.isFinite(cp) || cp < 0x20 || cp > 0x10ffff) return ' ';
  if (cp >= 0xd800 && cp <= 0xdfff) return ' ';
  return String.fromCodePoint(cp);
}

/**
 * Reduce dataset text to plain text: remove markup, decode entities, normalise
 * whitespace. Returns `''` for nullish input.
 *
 * Entity decoding runs AFTER tag stripping and the loop re-runs, so an encoded
 * tag (`&lt;script&gt;`) cannot be smuggled through the decode step.
 */
export function toPlainText(input: string | null | undefined): string {
  if (input === null || input === undefined) return '';
  let s = String(input);

  // Iterate to a fixed point. Each round strips tags then decodes entities, so
  // an encoded tag revealed by decoding is stripped on the next round. The bound
  // stops an adversarially deep `&amp;amp;…lt;` chain from spinning; the
  // defensive strip after the loop guarantees no tag survives regardless.
  for (let pass = 0; pass < 8; pass++) {
    const before = s;
    s = s.replace(VOID_CONTENT_RE, ' ');
    s = s.replace(VOID_CONTENT_UNCLOSED_RE, ' ');
    s = s.replace(PI_RE, ' ').replace(TAG_RE, ' ');
    s = s
      .replace(NUMERIC_ENTITY_RE, decodeNumeric)
      .replace(NAMED_ENTITY_RE, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
      .replace(MANGLED_ENTITY_RE, "'");
    if (s === before) break;
  }
  // Final defensive pass: nothing tag-shaped may survive into the output.
  s = s
    .replace(VOID_CONTENT_RE, ' ')
    .replace(VOID_CONTENT_UNCLOSED_RE, ' ')
    .replace(PI_RE, ' ')
    .replace(TAG_RE, ' ');

  return stripControlCharacters(s).replace(/\s+/g, ' ').trim();
}

/** True when the input contained anything that `toPlainText` had to remove. */
export function containsMarkup(input: string | null | undefined): boolean {
  if (input === null || input === undefined) return false;
  const s = String(input);
  return (
    /<[\s/\\!?]*[a-zA-Z]/.test(s) ||
    /&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,10}|\s*);/.test(s)
  );
}
