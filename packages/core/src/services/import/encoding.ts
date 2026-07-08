/**
 * Encoding-aware text decoder for bank-export imports.
 *
 * European bank exports routinely use Latin-1 (ISO-8859-1) or Windows-1252
 * for accented characters (`MÜLLER`, `Étoile`, `Bäcker`). `File.text()` in
 * the browser hard-codes UTF-8, so a Latin-1 byte stream comes through as
 * mojibake (`MÃLLER`) — and a strict UTF-8 decoder would simply throw on
 * invalid byte sequences.
 *
 * The strategy here:
 *   1. Strip a leading byte-order mark and use the encoding it implies.
 *   2. Sniff the first ~1KB as ASCII for an in-file declaration:
 *      - OFX 2.x / CAMT XML: `<?xml ... encoding="..."?>`
 *      - OFX 1.x SGML:       `CHARSET:1252` / `ENCODING:UNICODE`
 *   3. If a declaration was found, try that encoding.
 *   4. Otherwise try strict UTF-8 (so well-formed UTF-8 files always
 *      stay UTF-8 even when no declaration is present).
 *   5. Fall back to Windows-1252 — the most permissive 8-bit codepage,
 *      and what Quicken-era QIF files use.
 *
 * QIF carries no in-file marker, so it always lands in the strict-UTF-8 →
 * Windows-1252 fallback path.
 */

const ASCII_PEEK_BYTES = 2048;

export interface DecodeResult {
  text: string;
  /** The encoding actually used (after fallback). */
  encoding: string;
  /** The encoding declared in-file, if any. Useful for diagnostics. */
  declared?: string;
}

export function decodeImportText(buffer: ArrayBuffer | Uint8Array): DecodeResult {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  // Step 1 — explicit BOM wins.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return {
      text: new TextDecoder('utf-8').decode(bytes.subarray(3)),
      encoding: 'utf-8',
      declared: 'utf-8 (BOM)',
    };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      text: new TextDecoder('utf-16le').decode(bytes.subarray(2)),
      encoding: 'utf-16le',
      declared: 'utf-16le (BOM)',
    };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      text: new TextDecoder('utf-16be').decode(bytes.subarray(2)),
      encoding: 'utf-16be',
      declared: 'utf-16be (BOM)',
    };
  }

  // Step 2 — peek as ASCII to find an in-file declaration. The sniff
  // window is intentionally bounded (the declaration is always near the
  // top), and we use `fatal: false` so non-ASCII bytes in the body don't
  // abort the peek.
  const peek = new TextDecoder('ascii', { fatal: false }).decode(
    bytes.subarray(0, Math.min(ASCII_PEEK_BYTES, bytes.length))
  );

  const declared = detectDeclaredEncoding(peek);

  // Step 3 — declared encoding.
  if (declared) {
    try {
      return {
        text: new TextDecoder(declared).decode(bytes),
        encoding: declared,
        declared,
      };
    } catch {
      // TextDecoder threw on an unknown label — fall through.
    }
  }

  // Step 4 — strict UTF-8.
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      encoding: 'utf-8',
      declared,
    };
  } catch {
    // Step 5 — Windows-1252 always succeeds (every byte maps to a char).
    return {
      text: new TextDecoder('windows-1252').decode(bytes),
      encoding: 'windows-1252',
      declared,
    };
  }
}

function detectDeclaredEncoding(peek: string): string | undefined {
  // OFX 2.x / CAMT / generic XML: <?xml version="1.0" encoding="..."?>
  const xmlMatch = peek.match(/<\?xml[^?>]*\bencoding\s*=\s*["']([^"']+)["']/i);
  if (xmlMatch) return normalizeEncodingLabel(xmlMatch[1]);

  // OFX 1.x SGML: line-oriented headers.
  const charsetMatch = peek.match(/^CHARSET\s*[:=]\s*(\S+)/im);
  if (charsetMatch) {
    const fromCharset = ofxCharsetToLabel(charsetMatch[1]);
    if (fromCharset) return fromCharset;
  }
  const encodingMatch = peek.match(/^ENCODING\s*[:=]\s*(\S+)/im);
  if (encodingMatch) {
    const fromEncoding = ofxEncodingToLabel(encodingMatch[1]);
    if (fromEncoding) return fromEncoding;
  }

  return undefined;
}

/**
 * The OFX 1.x spec uses unsigned CHARSET values that aren't always valid
 * IANA labels. Map the common ones; let unrecognized values fall through.
 */
function ofxCharsetToLabel(charset: string): string | undefined {
  const c = charset.trim().toUpperCase();
  if (c === 'NONE') return undefined;
  if (c === '1252' || c === 'CP1252' || c === 'WINDOWS-1252') return 'windows-1252';
  if (c === '8859-1' || c === 'ISO-8859-1' || c === 'LATIN-1' || c === 'LATIN1')
    return 'iso-8859-1';
  if (c === '8859-15' || c === 'ISO-8859-15') return 'iso-8859-15';
  if (c === 'UTF-8' || c === 'UTF8') return 'utf-8';
  // OFX 1.x sometimes pairs CHARSET:NONE with ENCODING:UTF-8.
  return undefined;
}

/**
 * OFX 1.x ENCODING values are USASCII (legacy) or UNICODE (which means
 * UTF-8 in practice — the spec predates the term).
 */
function ofxEncodingToLabel(encoding: string): string | undefined {
  const e = encoding.trim().toUpperCase();
  if (e === 'USASCII' || e === 'US-ASCII' || e === 'ASCII') return 'us-ascii';
  if (e === 'UNICODE' || e === 'UTF-8' || e === 'UTF8') return 'utf-8';
  return undefined;
}

function normalizeEncodingLabel(label: string): string {
  return label.trim().toLowerCase();
}
