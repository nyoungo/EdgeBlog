#!/usr/bin/env node
// Generate a PBKDF2-SHA256 password hash in the exact format the Worker verifies:
//     pbkdf2$sha256$<iterations>$<saltBase64>$<hashBase64>
//
// Usage:
//   node ./scripts/hash-password.mjs "my-strong-password"
//   node ./scripts/hash-password.mjs            # prompts for the password
//
// Paste the output into:
//   UPDATE users SET password_hash = '<output>' WHERE username = 'admin';

import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

const ITERATIONS = 100_000;
const KEY_LEN = 32;
const SALT_LEN = 16;
const DIGEST = 'sha256';

export function hashPassword(password, iterations = ITERATIONS) {
  const salt = randomBytes(SALT_LEN);
  const derived = pbkdf2Sync(password, salt, iterations, KEY_LEN, DIGEST);
  return `pbkdf2$${DIGEST}$${iterations}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false;
  const [, digest, iterStr, saltB64, hashB64] = parts;
  const iterations = Number.parseInt(iterStr, 10);
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = pbkdf2Sync(password, salt, iterations, expected.length, digest);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function main() {
  let password = process.argv[2];
  if (!password) {
    const rl = createInterface({ input: stdin, output: stdout });
    password = await rl.question('Password: ');
    rl.close();
  }
  if (!password || password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }
  const hash = hashPassword(password);
  // Self-check so we never emit a hash the app cannot verify.
  if (!verifyPassword(password, hash)) {
    console.error('Internal error: generated hash failed self-verification.');
    process.exit(1);
  }
  console.log(hash);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('hash-password.mjs')) {
  main();
}
