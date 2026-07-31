import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export class CredentialCipher {
  private readonly key: Buffer
  constructor(encodedKey = process.env.CREDENTIAL_ENCRYPTION_KEY_BASE64) {
    if (!encodedKey && process.env.NODE_ENV === 'production') throw new Error('CREDENTIAL_ENCRYPTION_KEY_BASE64 is required in production')
    this.key = encodedKey ? Buffer.from(encodedKey, 'base64') : Buffer.alloc(32, 7)
    if (this.key.length !== 32) throw new Error('Credential encryption key must be 32 bytes')
  }
  encrypt(value: unknown) { const iv=randomBytes(12); const cipher=createCipheriv('aes-256-gcm',this.key,iv); const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]); return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]) }
  decrypt<T>(value: Buffer): T { const iv=value.subarray(0,12); const tag=value.subarray(12,28); const decipher=createDecipheriv('aes-256-gcm',this.key,iv); decipher.setAuthTag(tag); return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString('utf8')) as T }
}
