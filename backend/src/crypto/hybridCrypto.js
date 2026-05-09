import crypto from 'node:crypto';

const AES_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const RSA_ENCRYPTED_KEY_BYTES = 256;

export class HybridCrypto {
  constructor() {
    const pair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    this.publicKey = pair.publicKey;
    this.privateKey = pair.privateKey;
  }

  encrypt(payload) {
    const plaintext = Buffer.from(JSON.stringify(payload));
    const aesKey = crypto.randomBytes(AES_KEY_BYTES);
    const iv = crypto.randomBytes(GCM_IV_BYTES);

    const aes = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
    const encryptedPayload = Buffer.concat([aes.update(plaintext), aes.final()]);
    const authTag = aes.getAuthTag();

    const encryptedAesKey = crypto.publicEncrypt({
      key: this.publicKey,
      oaepHash: 'sha256',
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING
    }, aesKey);

    return Buffer.concat([encryptedAesKey, iv, encryptedPayload, authTag]).toString('base64');
  }

  decrypt(base64Ciphertext) {
    const all = Buffer.from(base64Ciphertext, 'base64');
    if (all.length < RSA_ENCRYPTED_KEY_BYTES + GCM_IV_BYTES + 16) {
      throw new Error('ciphertext_too_short');
    }

    const encryptedAesKey = all.subarray(0, RSA_ENCRYPTED_KEY_BYTES);
    const iv = all.subarray(RSA_ENCRYPTED_KEY_BYTES, RSA_ENCRYPTED_KEY_BYTES + GCM_IV_BYTES);
    const encryptedPayloadWithTag = all.subarray(RSA_ENCRYPTED_KEY_BYTES + GCM_IV_BYTES);
    const encryptedPayload = encryptedPayloadWithTag.subarray(0, encryptedPayloadWithTag.length - 16);
    const authTag = encryptedPayloadWithTag.subarray(encryptedPayloadWithTag.length - 16);

    const aesKey = crypto.privateDecrypt({
      key: this.privateKey,
      oaepHash: 'sha256',
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING
    }, encryptedAesKey);

    const aes = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
    aes.setAuthTag(authTag);
    const plaintext = Buffer.concat([aes.update(encryptedPayload), aes.final()]);

    return JSON.parse(plaintext.toString('utf8'));
  }

  hashCiphertext(base64Ciphertext) {
    return crypto.createHash('sha256').update(base64Ciphertext).digest('hex');
  }

  pinHash(pin) {
    return crypto.createHash('sha256').update(String(pin)).digest('hex');
  }
}
