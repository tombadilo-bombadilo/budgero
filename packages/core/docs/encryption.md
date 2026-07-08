# Encryption Guide

File: `src/encryption/crypto.ts`

## Overview
Provides symmetric encryption utilities for protecting sensitive data at rest.

### Core API
- EncryptionService
  - initialize(masterPassword: string): Promise<void>
  - encrypt(plain: string | Uint8Array): Promise<string>
  - decrypt(cipherBase64: string): Promise<string>
  - deriveKey(purpose: string): Promise<Uint8Array>
- EncryptionUtils
  - Helper utilities reused by the service

### Algorithms
- AES-256-GCM for authenticated encryption
- PBKDF2 for password-based key derivation (salted)
- Random salt per encryption, stored alongside ciphertext

### Usage
```ts
import { EncryptionService } from '@budgero/core';

const enc = new EncryptionService();
await enc.initialize('user-master-password');
const cipher = await enc.encrypt('secret');
const plain = await enc.decrypt(cipher);
```

### Best Practices
- Use a strong, user-provided password or a stored key from a secure enclave (server).
- Do not log keys or raw ciphertext in production.
- Rotate keys periodically; re-encrypt stored data during rotation windows.

### Notes
- The browser adapter and Node adapter do not automatically encrypt database pages; this module is for application-level field encryption.
- Ensure consistent encoding (UTF-8) and avoid double-encoding when passing strings vs binary.
