import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const VERSION = "v1";

export const ENCRYPTION_KEY_ENV = "REFUNDS_ENCRYPTION_KEY";

export class EncryptionKeyError extends Error {
  override name = "EncryptionKeyError";
}

export class DecryptionError extends Error {
  override name = "DecryptionError";
}

/**
 * Reads the 32-byte base64 key from REFUNDS_ENCRYPTION_KEY and fails fast if
 * it is missing or the wrong length.
 */
export function loadEncryptionKey(env: Readonly<Record<string, string | undefined>> = process.env): Buffer {
  const raw = env[ENCRYPTION_KEY_ENV];
  if (raw === undefined || raw.trim() === "") {
    throw new EncryptionKeyError(
      `${ENCRYPTION_KEY_ENV} is not set. Generate one with: ` +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return parseEncryptionKey(raw);
}

export function parseEncryptionKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key.trim(), "base64");
  if (key.length !== KEY_BYTES) {
    throw new EncryptionKeyError(
      `${ENCRYPTION_KEY_ENV} must be ${KEY_BYTES} bytes of base64 (got ${key.length} bytes).`,
    );
  }
  return key;
}

/** Returns `v1:<iv b64>:<authTag b64>:<ciphertext b64>` with a random 12-byte IV. */
export function encrypt(plaintext: string, key: Buffer): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decrypt(payload: string, key: Buffer): string {
  assertKey(key);
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new DecryptionError("Unrecognised ciphertext format.");
  }
  const [, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new DecryptionError("Invalid IV or auth tag length.");
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new DecryptionError("Ciphertext failed authentication.");
  }
}

export function encryptInteger(value: number, key: Buffer): string {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError("Only safe integers can be encrypted as an integer value.");
  }
  return encrypt(String(value), key);
}

export function decryptInteger(payload: string, key: Buffer): number {
  const text = decrypt(payload, key);
  if (!/^-?\d+$/.test(text)) {
    throw new DecryptionError("Decrypted value is not an integer.");
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    throw new DecryptionError("Decrypted integer is out of range.");
  }
  return value;
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new EncryptionKeyError(`Encryption key must be ${KEY_BYTES} bytes (got ${key.length}).`);
  }
}
