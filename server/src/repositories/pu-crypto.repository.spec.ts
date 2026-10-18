import { randomBytes } from 'node:crypto';
import { CryptoRepository } from 'src/repositories/crypto.repository.js';

// PixelUnion: AES-256-GCM helpers used to store Keycloak refresh tokens at rest.
describe(CryptoRepository.name, () => {
  const sut = new CryptoRepository();
  const key = randomBytes(32);

  describe('encryptAesGcm / decryptAesGcm', () => {
    it('should round-trip a value', () => {
      const plaintext = 'eyJhbGciOiJIUzI1NiJ9.refresh-token.ünïcødé';

      const encrypted = sut.encryptAesGcm(plaintext, key);

      expect(sut.decryptAesGcm(encrypted, key)).toBe(plaintext);
    });

    it('should round-trip an empty value', () => {
      expect(sut.decryptAesGcm(sut.encryptAesGcm('', key), key)).toBe('');
    });

    it('should use the iv | tag | ciphertext layout', () => {
      const plaintext = 'refresh-token';

      const encrypted = sut.encryptAesGcm(plaintext, key);

      expect(encrypted.length).toBe(12 + 16 + Buffer.byteLength(plaintext));
      expect(encrypted.includes(Buffer.from(plaintext))).toBe(false);
    });

    it('should use a fresh iv for every encryption', () => {
      const a = sut.encryptAesGcm('refresh-token', key);
      const b = sut.encryptAesGcm('refresh-token', key);

      expect(a.subarray(0, 12).equals(b.subarray(0, 12))).toBe(false);
      expect(a.equals(b)).toBe(false);
    });

    it.each([
      ['iv', 0],
      ['auth tag', 12],
      ['ciphertext', 28],
    ])('should reject data with a tampered %s', (_, offset) => {
      const encrypted = sut.encryptAesGcm('refresh-token', key);
      encrypted[offset] ^= 0x01;

      expect(() => sut.decryptAesGcm(encrypted, key)).toThrow();
    });

    it('should reject truncated data', () => {
      const encrypted = sut.encryptAesGcm('refresh-token', key);

      expect(() => sut.decryptAesGcm(encrypted.subarray(0, -1), key)).toThrow();
    });

    it('should reject decryption with a different key', () => {
      const encrypted = sut.encryptAesGcm('refresh-token', key);

      expect(() => sut.decryptAesGcm(encrypted, randomBytes(32))).toThrow();
    });

    it('should require a 32-byte key', () => {
      expect(() => sut.encryptAesGcm('refresh-token', randomBytes(16))).toThrow();
    });
  });
});
