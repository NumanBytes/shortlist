// A small RFC 5322 / MIME reader for job-alert emails — hand-rolled, like the OAuth code,
// so every step is visible. It handles what alert emails actually use: nested multipart,
// quoted-printable and base64 bodies, charset decoding, and RFC 2047 encoded headers.
// It only reads; nothing here is stored (docs/email-alerts.md §10.3).

export interface ParsedMail {
  from: string | null;
  subject: string;
  date: Date | null;
  text: string | null; // first text/plain part
  html: string | null; // first text/html part
}

interface Part {
  headers: Map<string, string>;
  body: Buffer; // still transfer-encoded
}

// Work on bytes as latin1 so offsets are byte offsets; decode charsets only at the end.
export function parseMail(raw: Buffer | string): ParsedMail {
  const bytes = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw;
  const root = splitPart(bytes);
  const found: { text: string | null; html: string | null } = { text: null, html: null };
  walk(root, found, 0);
  const date = root.headers.get('date');
  const parsedDate = date ? new Date(date) : null;
  return {
    from: root.headers.has('from') ? decodeWords(root.headers.get('from')!) : null,
    subject: decodeWords(root.headers.get('subject') ?? ''),
    date: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null,
    ...found,
  };
}

function splitPart(bytes: Buffer): Part {
  const s = bytes.toString('latin1');
  const m = /\r?\n\r?\n/.exec(s);
  const headerText = m ? s.slice(0, m.index) : s;
  const bodyStart = m ? m.index + m[0].length : s.length;
  return { headers: parseHeaders(headerText), body: bytes.subarray(bodyStart) };
}

// Header names lower-cased; folded continuation lines joined. The first occurrence wins.
function parseHeaders(text: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of text.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    if (!headers.has(name)) headers.set(name, line.slice(i + 1).trim());
  }
  return headers;
}

function contentType(part: Part): { type: string; params: Record<string, string> } {
  const value = part.headers.get('content-type') ?? 'text/plain';
  const [type = 'text/plain', ...rest] = value.split(';');
  const params: Record<string, string> = {};
  for (const p of rest) {
    const i = p.indexOf('=');
    if (i > 0)
      params[p.slice(0, i).trim().toLowerCase()] = p
        .slice(i + 1)
        .trim()
        .replace(/^"(.*)"$/, '$1');
  }
  return { type: type.trim().toLowerCase(), params };
}

const MAX_DEPTH = 8; // a hostile email can't recurse us forever

function walk(part: Part, found: { text: string | null; html: string | null }, depth: number) {
  if (depth > MAX_DEPTH) return;
  const { type, params } = contentType(part);
  if (type.startsWith('multipart/') && params.boundary) {
    for (const child of splitMultipart(part.body, params.boundary)) walk(splitPart(child), found, depth + 1);
    return;
  }
  if ((part.headers.get('content-disposition') ?? '').toLowerCase().startsWith('attachment')) return;
  if (type === 'text/plain' && found.text === null) found.text = decodeBody(part, params.charset);
  else if (type === 'text/html' && found.html === null) found.html = decodeBody(part, params.charset);
}

function splitMultipart(body: Buffer, boundary: string): Buffer[] {
  const s = body.toString('latin1');
  const delimiter = `--${boundary}`;
  const parts: Buffer[] = [];
  let pos = s.indexOf(delimiter);
  while (pos !== -1) {
    const afterDelimiter = pos + delimiter.length;
    if (s.startsWith('--', afterDelimiter)) break; // closing delimiter
    const start = s.indexOf('\n', afterDelimiter);
    if (start === -1) break;
    const next = s.indexOf(`\n${delimiter}`, start);
    const end = next === -1 ? s.length : next;
    // Drop the CRLF that belongs to the next delimiter line.
    parts.push(body.subarray(start + 1, end > 0 && s[end - 1] === '\r' ? end - 1 : end));
    pos = next === -1 ? -1 : next + 1;
  }
  return parts;
}

function decodeBody(part: Part, charset: string | undefined): string {
  const encoding = (part.headers.get('content-transfer-encoding') ?? '7bit').toLowerCase();
  let bytes: Buffer;
  if (encoding === 'base64')
    bytes = Buffer.from(part.body.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  else if (encoding === 'quoted-printable') bytes = decodeQuotedPrintable(part.body.toString('latin1'));
  else bytes = part.body;
  return decodeCharset(bytes, charset);
}

export function decodeQuotedPrintable(s: string): Buffer {
  const noSoftBreaks = s.replace(/=\r?\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < noSoftBreaks.length; i++) {
    const c = noSoftBreaks[i]!;
    const hex = noSoftBreaks.slice(i + 1, i + 3);
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      out.push(parseInt(hex, 16));
      i += 2;
    } else {
      out.push(noSoftBreaks.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(out);
}

function decodeCharset(bytes: Buffer, charset = 'utf-8'): string {
  try {
    return new TextDecoder(charset.toLowerCase(), { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes); // unknown charset label
  }
}

// RFC 2047: "=?UTF-8?B?...?=" / "=?utf-8?Q?...?=" inside Subject and From.
export function decodeWords(value: string): string {
  return value
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, '$1') // whitespace between encoded words is dropped
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, charset: string, enc: string, text: string) => {
      const bytes =
        enc.toUpperCase() === 'B' ? Buffer.from(text, 'base64') : decodeQuotedPrintable(text.replace(/_/g, ' '));
      return decodeCharset(bytes, charset);
    });
}
