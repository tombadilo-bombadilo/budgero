/**
 * Crypto module — encryption, compression, and key management.
 */

// Envelope encryption (low-level)
export { encryptEnvelope, decryptEnvelope, clearEnvelopeCache, getCachedSalt } from './envelope';
export type { DecryptEnvelopeResult } from './envelope';

// Compression
export { compress, decompress, tryDecompress } from './compression';

// Base64 / base64url codecs
export { toBase64, fromBase64, toBase64Url, fromBase64Url } from './base64';

// Mutation encryption for real-time sync
export { MutationEncryption } from './mutation-crypto';

// Database utilities (compress + encrypt combined)
export { compressAndEncryptDatabase, decryptAndDecompressDatabase } from './database-crypto';
export type { CompressAndEncryptResult, DecryptAndDecompressResult } from './database-crypto';

// Space key crypto
export {
  generateSpaceKey,
  encodeSpaceKey,
  decodeSpaceKey,
  wrapSpaceKeyWithMaster,
  unwrapSpaceKeyWithMaster,
  generateInviteSecret,
  hashInviteSecret,
  encryptSpaceKeyForInvite,
  decryptSpaceKeyFromInvite,
} from './space-key-crypto';

// Local persistence cipher
export { createLocalPersistenceCipher } from './persistence-cipher';
export type { LocalPersistenceCipher } from './persistence-cipher';
