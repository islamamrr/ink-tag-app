// QR codes: the module matrix (qrcode-generator, MIT, pure JS) and the
// payloads the templates encode: a link, a contact card, a Wi-Fi network.

// eslint-disable-next-line import/no-named-as-default
import qrcode from 'qrcode-generator';

export type QrLevel = 'L' | 'M' | 'Q' | 'H';

// The library's default treats text as Latin-1; names and Wi-Fi passwords
// can be anything, so encode as UTF-8 (every current phone reader expects it).
// Our own encoder: the library's ESM build, which the app bundle uses, has no
// stringToBytesFuncs table (only its CommonJS build does), and reading it
// crashed the app on start.
qrcode.stringToBytes = utf8Bytes;

/** UTF-8 bytes of a string; lone surrogates become U+FFFD. */
export function utf8Bytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

/** true = dark module, rows top to bottom. Throws if the data is too long for a QR code. */
export function qrMatrix(data: string, level: QrLevel = 'M'): boolean[][] {
  const qr = qrcode(0, level);
  qr.addData(data, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

// ---------------------------------------------------------------- payloads

export interface Contact {
  name: string;
  phone?: string;
  email?: string;
  org?: string;
  title?: string;
  url?: string;
}

/** vCard 3.0, which iOS and Android cameras both turn into "Add contact". */
export function vcard(c: Contact): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n');
  const parts = c.name.trim().split(/\s+/);
  const last = parts.length > 1 ? parts.pop()! : '';
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${esc(last)};${esc(parts.join(' '))};;;`,
    `FN:${esc(c.name.trim())}`,
  ];
  if (c.org) lines.push(`ORG:${esc(c.org)}`);
  if (c.title) lines.push(`TITLE:${esc(c.title)}`);
  if (c.phone) lines.push(`TEL;TYPE=CELL:${esc(c.phone)}`);
  if (c.email) lines.push(`EMAIL:${esc(c.email)}`);
  if (c.url) lines.push(`URL:${esc(normalizeUrl(c.url))}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

export type WifiSecurity = 'WPA' | 'WEP' | 'none';

export interface Wifi {
  ssid: string;
  password?: string;
  security?: WifiSecurity;
  hidden?: boolean;
}

/** The "WIFI:" format phone cameras offer to join. */
export function wifiPayload(w: Wifi): string {
  const esc = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');
  const sec = w.security ?? (w.password ? 'WPA' : 'none');
  let s = `WIFI:T:${sec === 'none' ? 'nopass' : sec};S:${esc(w.ssid)};`;
  if (sec !== 'none' && w.password) s += `P:${esc(w.password)};`;
  if (w.hidden) s += 'H:true;';
  return `${s};`;
}

/** Adds https:// to a bare "example.com/x" so cameras open it as a link. */
export function normalizeUrl(u: string): string {
  const t = u.trim();
  if (!t) return t;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;
  return `https://${t}`;
}
