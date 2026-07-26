/**
 * H8 — the sanitiser. §12 requires "a unit test proving script injection is
 * neutralised".
 *
 * Because the policy is strip-to-plain-text (D-006) and the output is rendered
 * through ordinary React interpolation, the bar is: no tag-shaped construct and
 * no executable payload may survive into the output string.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { containsMarkup, toPlainText } from '@/lib/utils/sanitise';

describe('toPlainText — script injection is neutralised', () => {
  const PAYLOADS: readonly string[] = [
    '<script>alert(1)</script>',
    '<SCRIPT SRC=//evil.tld/x.js></SCRIPT>',
    '<script>alert("xss")',
    '<img src=x onerror=alert(1)>',
    '<svg/onload=alert(1)>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<body onload=alert(1)>',
    '<a href="javascript:alert(1)">click</a>',
    '<style>body{background:url(javascript:alert(1))}</style>',
    '&lt;script&gt;alert(1)&lt;/script&gt;',
    '&#60;script&#62;alert(1)&#60;/script&#62;',
    '&#x3c;script&#x3e;alert(1)&#x3c;/script&#x3e;',
    '<<SCRIPT>alert(1);//<</SCRIPT>',
    '<scr<script>ipt>alert(1)</scr</script>ipt>',
    '<object data="data:text/html,<script>alert(1)</script>"></object>',
    '<template><script>alert(1)</script></template>',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    '<embed src="x.swf">',
  ];

  it.each(PAYLOADS)('neutralises %s', (payload) => {
    const out = toPlainText(payload);
    // No tag-shaped construct survives.
    expect(out).not.toMatch(/<[a-zA-Z/!?\\]/);
    expect(out.toLowerCase()).not.toContain('<script');
    expect(out.toLowerCase()).not.toContain('onerror=');
    expect(out.toLowerCase()).not.toContain('onload=');
    // Script and style CONTENT is discarded, not merely unwrapped.
    if (/<\s*(script|style|iframe|object|embed|template|noscript)/i.test(payload)) {
      expect(out).not.toContain('alert(1)');
    }
  });

  it('discards script content rather than leaving the payload as bare text', () => {
    expect(toPlainText('before<script>alert(1)</script>after')).toBe('before after');
  });

  it('handles an unterminated dangerous element by dropping the remainder', () => {
    expect(toPlainText('safe text<script>alert(1)')).toBe('safe text');
  });

  it('an encoded tag cannot be smuggled through the decode step', () => {
    // Decoding &lt;script&gt; would produce a real tag; the loop must re-strip it.
    const out = toPlainText('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
  });

  it('never emits a tag-shaped construct for arbitrary input (property)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (s) => {
        expect(toPlainText(s)).not.toMatch(/<[a-zA-Z/!?\\]/);
      }),
      { numRuns: 2000 }
    );
  });

  it('is idempotent (property)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (s) => {
        const once = toPlainText(s);
        expect(toPlainText(once)).toBe(once);
      }),
      { numRuns: 1000 }
    );
  });
});

describe('toPlainText — the corpus\'s actual defects', () => {
  it('unwraps the malformed <p>...<\\p> wrapper seen in 806 explanations', () => {
    const input = '<p> Leptospirosis is the most widespread zoonotic disease. <\\p>';
    expect(toPlainText(input)).toBe('Leptospirosis is the most widespread zoonotic disease.');
  });

  it("repairs the mangled `Park&;s` entity to an apostrophe", () => {
    expect(toPlainText('Park&;s textbook of preventive medicine')).toBe("Park's textbook of preventive medicine");
  });

  it('decodes the named entities that occur in the corpus', () => {
    expect(toPlainText('a &amp; b')).toBe('a & b');
    expect(toPlainText('30&deg;C &plusmn; 2')).toBe('30°C ± 2');
    expect(toPlainText('&alpha;-thalassemia')).toBe('α-thalassemia');
    expect(toPlainText('x&nbsp;y')).toBe('x y');
  });

  it('leaves an unknown entity alone rather than mangling the text', () => {
    expect(toPlainText('&notarealentity; here')).toBe('&notarealentity; here');
  });

  it('decodes numeric entities and rejects nonsense code points', () => {
    expect(toPlainText('&#65;&#66;')).toBe('AB');
    expect(toPlainText('&#x41;')).toBe('A');
    expect(toPlainText('&#X42;')).toBe('B');
    expect(toPlainText('&#0;')).toBe('');
    expect(toPlainText('&#1114112;')).toBe('');
    expect(toPlainText('a&#55296;b')).toBe('a b');
  });

  it('does NOT repair the rt token-loss defect — that is flagged, never fixed (H4)', () => {
    // Auto-correcting medical text is forbidden (§13 anti-requirement 5).
    expect(toPlainText('Chronic hypeension of the aery')).toBe('Chronic hypeension of the aery');
  });

  it('strips control characters and bidi overrides', () => {
    const bidi = `A${String.fromCharCode(0x202e)}B`;
    expect(toPlainText(bidi)).toBe('AB');
    expect(toPlainText(`x${String.fromCharCode(0)}y`)).toBe('xy');
    expect(toPlainText(`x${String.fromCharCode(0x200b)}y`)).toBe('xy');
    expect(toPlainText(`${String.fromCharCode(0xfeff)}abc`)).toBe('abc');
  });

  it('collapses whitespace and trims', () => {
    expect(toPlainText('  a \n\t b  ')).toBe('a b');
  });

  it('returns empty string for nullish input', () => {
    expect(toPlainText(null)).toBe('');
    expect(toPlainText(undefined)).toBe('');
    expect(toPlainText('')).toBe('');
  });

  it('leaves ordinary medical text untouched', () => {
    const s = 'A 6-year-old child has a foreign body in the trachea. Best initial management is?';
    expect(toPlainText(s)).toBe(s);
  });

  it('does not treat a bare "<" or a less-than comparison as markup', () => {
    expect(toPlainText('CD4 < 200 cells/mm3')).toBe('CD4 < 200 cells/mm3');
    expect(toPlainText('age < 3 years')).toBe('age < 3 years');
  });

  it('strips comments, CDATA, doctypes and processing instructions', () => {
    expect(toPlainText('a<!-- hidden -->b')).toBe('a b');
    expect(toPlainText('<!DOCTYPE html>text')).toBe('text');
    expect(toPlainText('<![CDATA[payload]]>after')).toBe('after');
    expect(toPlainText('<?xml version="1.0"?>body')).toBe('body');
  });

  it('strips an unterminated tag that is followed by another "<"', () => {
    // Regression: the unterminated branch anchored to end-of-string, so a later
    // "<" left the first fragment intact.
    expect(toPlainText('<b<')).toBe('<');
    expect(toPlainText('x</y<z')).toBe('x');
  });
});

describe('containsMarkup', () => {
  it('detects tags and entities', () => {
    expect(containsMarkup('<p>hi</p>')).toBe(true);
    expect(containsMarkup('a &amp; b')).toBe(true);
    expect(containsMarkup('Park&;s')).toBe(true);
    expect(containsMarkup('&#65;')).toBe(true);
    expect(containsMarkup('&#x41;')).toBe(true);
  });

  it('does not fire on plain text or numeric comparisons', () => {
    expect(containsMarkup('plain text')).toBe(false);
    expect(containsMarkup('CD4 < 200')).toBe(false);
    expect(containsMarkup(null)).toBe(false);
    expect(containsMarkup(undefined)).toBe(false);
  });
});
