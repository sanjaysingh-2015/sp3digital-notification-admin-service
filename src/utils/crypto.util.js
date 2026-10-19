const crypto = require('crypto');

/**
 * AES-256-GCM for the SMTP passwords tenants store. The key is
 * NOTIFICATION_ENCRYPTION_KEY: 32 random bytes, base64. Stored as
 * "v1:<iv>:<auth tag>:<cipher text>" (all base64), so the key can be rotated later
 * by introducing "v2" without breaking old rows.
 */
function key() {
  const raw = process.env.NOTIFICATION_ENCRYPTION_KEY;
  if (!raw) return null;
  const buffer = Buffer.from(raw, 'base64');
  return buffer.length === 32 ? buffer : null;
}

const isConfigured = () => key() !== null;

function encrypt(plain) {
  const k = key();
  if (!k) throw new Error('NOTIFICATION_ENCRYPTION_KEY is not set (32 random bytes, base64)');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

function decrypt(stored) {
  const k = key();
  if (!k) throw new Error('NOTIFICATION_ENCRYPTION_KEY is not set');
  const [version, iv, tag, data] = String(stored).split(':');
  if (version !== 'v1') throw new Error('Unknown encryption format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, isConfigured };
