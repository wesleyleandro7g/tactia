import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { AppError, ErrorCode } from '@tactia/shared';

const scryptAsync = promisify(scrypt);
const KEYLEN = 64;
const PREFIX_BYTES = 4;
const SECRET_BYTES = 32;
const TOKEN_PREFIX = 'tactia_live_';
const MAX_TOKEN_LENGTH = 128;
const TOKEN_PATTERN = /^tactia_live_([a-f0-9]{8})_([a-f0-9]{64})$/;
const DUMMY_HASH_HEX = '00'.repeat(KEYLEN);

function pepper(): Buffer {
  const hex = process.env['ENCRYPTION_KEY'];
  if (!hex) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'ENCRYPTION_KEY environment variable is not set');
  }
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  }
  return key;
}

export function parseTenantApiKeyToken(token: string): { prefix: string } | null {
  const match = TOKEN_PATTERN.exec(token);
  if (!match) return null;
  const prefix = match[1];
  if (!prefix) return null;
  return { prefix };
}

export async function hashApiKeySecret(secret: string): Promise<string> {
  const material = secret.length > MAX_TOKEN_LENGTH ? secret.slice(0, MAX_TOKEN_LENGTH) : secret;
  const derived = (await scryptAsync(material, pepper(), KEYLEN)) as Buffer;
  return derived.toString('hex');
}

export function apiKeyHashesEqual(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(leftHex, 'hex');
  const right = Buffer.from(rightHex, 'hex');
  if (left.length !== KEYLEN || right.length !== KEYLEN) return false;
  return timingSafeEqual(left, right);
}

export async function verifyApiKeySecret(token: string, storedHashHex: string | null): Promise<boolean> {
  const computed = await hashApiKeySecret(token);
  const expected = storedHashHex && storedHashHex.length === DUMMY_HASH_HEX.length ? storedHashHex : DUMMY_HASH_HEX;
  return apiKeyHashesEqual(computed, expected) && storedHashHex !== null;
}

export function generateTenantApiKeySecret(): { prefix: string; secret: string } {
  const prefix = randomBytes(PREFIX_BYTES).toString('hex');
  const rest = randomBytes(SECRET_BYTES).toString('hex');
  return { prefix, secret: `${TOKEN_PREFIX}${prefix}_${rest}` };
}

export { TOKEN_PREFIX, TOKEN_PATTERN };
