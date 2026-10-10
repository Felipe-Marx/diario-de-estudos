export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

// dia local (YYYY-MM-DD), n dias atrás
export const loc = (n = 0) =>
  new Date(Date.now() - n * 864e5 - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
export const today = () => loc(0);
export const fmt = (d: string) => d.slice(8) + '/' + d.slice(5, 7);
export const byDue = <T extends { due: string }>(a: T, b: T) => ((a.due || '9') > (b.due || '9') ? 1 : -1);

// Markdown mínimo (títulos, listas, negrito, itálico, código). O texto é escapado antes.
export function md(text: string): string {
  const inl = (s: string) =>
    s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  let out = '', code = false, list = false;
  for (const l of esc(text).split('\n')) {
    if (l.startsWith('```')) {
      if (list) { out += '</ul>'; list = false; }
      out += code ? '</pre>' : '<pre>';
      code = !code;
      continue;
    }
    if (code) { out += l + '\n'; continue; }
    const li = l.match(/^[-*] (.*)/);
    if (li) {
      if (!list) { out += '<ul>'; list = true; }
      out += '<li>' + inl(li[1]) + '</li>';
      continue;
    }
    if (list) { out += '</ul>'; list = false; }
    const h = l.match(/^(#{1,3}) (.*)/);
    if (h) { const n = h[1].length + 1; out += `<h${n}>${inl(h[2])}</h${n}>`; }
    else if (l.trim()) out += '<p>' + inl(l) + '</p>';
  }
  return out + (list ? '</ul>' : '') + (code ? '</pre>' : '');
}
