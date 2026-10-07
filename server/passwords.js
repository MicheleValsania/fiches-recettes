import crypto from "node:crypto";
import { promisify } from "node:util";
import { safeEqual } from "./auth.js";

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const HASH_PREFIX = "scrypt-v1";

export async function hashPassword(password) {
  const normalized = String(password);
  if (normalized.length < 12) throw new Error("Password must contain at least 12 characters.");

  const salt = crypto.randomBytes(16).toString("base64url");
  const derivedKey = await scrypt(normalized, salt, KEY_LENGTH);
  return `${HASH_PREFIX}$${salt}$${Buffer.from(derivedKey).toString("base64url")}`;
}

export async function verifyPassword(password, storedHash) {
  const [prefix, salt, encodedHash, ...rest] = String(storedHash || "").split("$");
  if (prefix !== HASH_PREFIX || !salt || !encodedHash || rest.length > 0) return false;

  try {
    const derivedKey = await scrypt(String(password), salt, KEY_LENGTH);
    return safeEqual(Buffer.from(derivedKey).toString("base64url"), encodedHash);
  } catch {
    return false;
  }
}
