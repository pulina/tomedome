import { safeStorage } from 'electron';
import { getLogger } from './logger';

export function encryptValue(plaintext: string): string {
  if (!plaintext) return '';
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Secure storage is unavailable; cannot save API keys. Use a desktop session with OS keychain / secret service.',
    );
  }
  return safeStorage.encryptString(plaintext).toString('base64');
}

export function isEncryptionReady(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export interface DecryptSensitiveResult {
  plaintext: string;
  legacyPlain: boolean;
}

export function decryptSensitiveStored(encoded: string): DecryptSensitiveResult {
  if (!encoded) return { plaintext: '', legacyPlain: false };
  const buf = Buffer.from(encoded, 'base64');

  if (safeStorage.isEncryptionAvailable()) {
    try {
      return { plaintext: safeStorage.decryptString(buf), legacyPlain: false };
    } catch {
      const asString = buf.toString('utf8');
      if (asString.startsWith('PLAIN:')) {
        return { plaintext: asString.slice('PLAIN:'.length), legacyPlain: true };
      }
      getLogger().warn(
        {},
        'safeStorage decrypt failed — keychain cannot open old ciphertext; re-enter API key in Settings',
      );
      return { plaintext: '', legacyPlain: false };
    }
  }

  const asString = buf.toString('utf8');
  if (asString.startsWith('PLAIN:')) {
    return { plaintext: asString.slice('PLAIN:'.length), legacyPlain: true };
  }
  return { plaintext: '', legacyPlain: false };
}
