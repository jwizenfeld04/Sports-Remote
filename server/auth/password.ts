// Password and PIN hashing with Node's built-in scrypt.
//
// A hash is stored as one self-describing string so the cost parameters can be raised later
// without breaking old hashes:  scrypt$<N>$<r>$<p>$<salt base64url>$<hash base64url>
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

export interface ScryptParams {
  N: number; // CPU/memory cost, a power of two
  r: number; // block size
  p: number; // parallelism
}

/** Default cost: about 32 MiB and 50-100 ms per hash on a small server. */
export const DEFAULT_SCRYPT: ScryptParams = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LEN = 32;
const SALT_LEN = 16;
// Refuse to verify hashes with absurd parameters (a tampered file shouldn't be able to hang the server).
const MAX_N = 2 ** 20;

function scrypt(secret: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  // scrypt needs 128 * N * r bytes; give it headroom above Node's 32 MiB default.
  const opts: ScryptOptions = { N: params.N, r: params.r, p: params.p, maxmem: 256 * params.N * params.r };
  return new Promise((resolve, reject) =>
    scryptCb(secret.normalize("NFKC"), salt, KEY_LEN, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

/** Hash a password or PIN with a fresh random salt. */
export async function hashSecret(secret: string, params: ScryptParams = DEFAULT_SCRYPT): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scrypt(secret, salt, params);
  return ["scrypt", params.N, params.r, params.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** Check a secret against a stored hash in constant time. Malformed hashes never match. */
export async function verifySecret(secret: unknown, stored: string | null | undefined): Promise<boolean> {
  if (typeof secret !== "string" || !stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every(Number.isInteger) || N < 2 || N > MAX_N || (N & (N - 1)) !== 0 || r < 1 || r > 32 || p < 1 || p > 16) return false;
  const salt = Buffer.from(parts[4], "base64url");
  const want = Buffer.from(parts[5], "base64url");
  if (want.length !== KEY_LEN) return false;
  const got = await scrypt(secret, salt, { N, r, p });
  return timingSafeEqual(got, want);
}

/**
 * Burn about the same time as a real verify. Used when the username doesn't exist, so response
 * times don't reveal which usernames are real.
 */
let dummyHash: Promise<string> | null = null;
export async function verifyDummy(secret: unknown, params: ScryptParams = DEFAULT_SCRYPT): Promise<false> {
  dummyHash ??= hashSecret("not-a-real-password", params);
  await verifySecret(typeof secret === "string" ? secret : "", await dummyHash);
  return false;
}

// ---- Rules for what people may choose ----

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 256; // long enough for passphrases, short enough that hashing stays cheap

/** null when fine, otherwise a message for the user. */
export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== "string") return "Password is required.";
  if (pw.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (pw.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`;
  return null;
}

/** A household PIN is 4 to 12 digits. */
export function pinProblem(pin: unknown): string | null {
  if (typeof pin !== "string" || !/^\d{4,12}$/.test(pin)) return "PIN must be 4 to 12 digits.";
  return null;
}

/**
 * Usernames: 2-32 characters, lowercase letters, digits, dot, dash, underscore; must start with a
 * letter or digit. They're compared case-insensitively (we store them lowercased).
 */
export function normalizeUsername(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const n = name.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{1,31}$/.test(n) ? n : null;
}
