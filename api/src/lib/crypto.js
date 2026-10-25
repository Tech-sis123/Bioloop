import crypto from 'node:crypto';

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Constant-time string compare
export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Device keys look like: blk_<prefix>_<secret>. Only the hash is stored.
export function newDeviceKey() {
  const prefix = crypto.randomBytes(4).toString('hex');
  const secret = randomToken(24);
  const key = `blk_${prefix}_${secret}`;
  return { key, prefix, hash: sha256(key) };
}
