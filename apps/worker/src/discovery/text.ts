const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, e: string) => {
    if (e[0] === '#') {
      const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED[e.toLowerCase()] ?? match;
  });
}

// Job descriptions arrive as HTML. We store plain text: it's what the rule filter
// searches and what the AI extraction step will read — markup is only noise there.
export function htmlToText(html: string): string {
  let s = html;
  // Some sources (Greenhouse, the WWR feed) entity-encode the HTML itself.
  if (!/<[a-z]/i.test(s) && /&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|tr|ul|ol|section)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(s)
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Seconds or milliseconds since epoch, or a date string. Anything unparseable -> null.
export function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  let d: Date;
  if (typeof value === 'number') d = new Date(value < 1e12 ? value * 1000 : value);
  else if (typeof value === 'string' && /^\d+$/.test(value)) return toDate(Number(value));
  // Remotive sends naive timestamps ("2026-09-21T12:55:11"); they're UTC.
  else if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?$/.test(value)) d = new Date(`${value}Z`);
  else if (typeof value === 'string') d = new Date(value);
  else if (value instanceof Date) d = value;
  else return null;
  return Number.isNaN(d.getTime()) ? null : d;
}

export const joinParts = (...parts: (string | null | undefined)[]) =>
  parts.map((p) => p?.trim()).filter(Boolean).join(', ') || null;
