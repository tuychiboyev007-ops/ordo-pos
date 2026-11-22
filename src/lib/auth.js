/**
 * Kirish uch pog'onali:
 *  1. Restoran egasi qurilmani bir marta email+parol bilan ulaydi → qurilma belgisi (device token).
 *     Belgi muddatsiz, lekin egasi uni istalgan payt o'chira oladi (devices.revoked).
 *  2. Xodim o'sha qurilmada PIN-kod bilan kiradi (internetsiz ham — xesh kassada).
 *  3. Boshqaruv paneli (menyu, xodimlar, hisobot) uchun — PIN serverda tekshirilib,
 *     12 soatlik sessiya belgisi beriladi.
 */
import { pinHash, randomHex, sameHex } from '../../public/js/pin.js';

const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function signToken(secret, payload) {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}

export async function readToken(secret, token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!sameHex(await hmac(secret, body), sig)) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64u(body)));
    if (p.exp && p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}

export async function hashPassword(pw) {
  const salt = randomHex(16);
  return `pbkdf2$100000$${salt}$${await pinHash(pw, salt, 100000)}`;
}

export async function checkPassword(pw, stored) {
  const [kind, iter, salt, hash] = String(stored || '').split('$');
  if (kind !== 'pbkdf2') return false;
  return sameHex(await pinHash(pw, salt, Number(iter)), hash);
}

export async function makePin(pin) {
  const salt = randomHex(12);
  return { pin_salt: salt, pin_hash: await pinHash(pin, salt) };
}

export const validPin = (pin) => /^\d{4,6}$/.test(String(pin ?? ''));
