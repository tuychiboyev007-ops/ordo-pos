/**
 * PIN-kod xeshi — kassa ham, server ham shu funksiyani ishlatadi.
 * Kassa internetsiz ham xodimni PIN bilan kiritishi kerak, shuning uchun
 * xodimlarning xeshi kassa qurilmasida saqlanadi. PBKDF2 ataylab sekin:
 * qurilmadan xeshni olib PIN ni terib topish daqiqalar talab qiladi.
 * Har amal (bekor qilish, chegirma) kim tomonidan qilingani baribir
 * serverda yoziladi va egasiga ko'rinadi.
 */
export const PIN_ITER = 60000;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function pinHash(pin, salt, iter = PIN_ITER) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(String(salt)), iterations: iter }, key, 256);
  return hex(bits);
}

export function randomHex(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return hex(a);
}

/** Vaqt bo'yicha teng solishtirish. */
export function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
