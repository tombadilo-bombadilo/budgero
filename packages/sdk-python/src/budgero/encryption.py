"""
Encryption utilities for the Budgero SDK.

Uses AES-256-GCM for encrypting mutation payloads before sending to the API.
This matches the encryption scheme used by the Budgero app.
"""
from __future__ import annotations

import base64
import json
import os
from typing import Any
import hmac
import hashlib

from Crypto.Cipher import AES

from budgero.exceptions import EncryptionError


# Constants matching Budgero's encryption scheme
SALT_LENGTH = 32  # Salt is SHA-256(space key)
IV_LENGTH = 12  # 12 bytes for GCM nonce
TAG_LENGTH = 16  # 16 bytes for GCM auth tag
KEY_LENGTH = 32  # 32 bytes for AES-256


def encrypt_payload(payload: dict[str, Any], key: bytes) -> str:
    """
    Encrypt a mutation payload using AES-256-GCM.

    The encryption format matches Budgero's scheme:
    - Derive salt as SHA-256(key)
    - Generate random 12-byte IV
    - Encrypt with AES-256-GCM
    - Concatenate: salt + IV + ciphertext + auth_tag
    - Base64 encode the result

    Args:
        payload: Dictionary containing the mutation operation and arguments.
        key: 32-byte encryption key.

    Returns:
        Base64-encoded encrypted payload.

    Raises:
        EncryptionError: If encryption fails or key is invalid.

    Example:
        >>> key = bytes.fromhex("your-32-byte-hex-key")
        >>> encrypted = encrypt_payload({"op": "test", "args": {}}, key)
    """
    if len(key) != KEY_LENGTH:
        raise EncryptionError(
            f"Encryption key must be {KEY_LENGTH} bytes, got {len(key)}"
        )

    try:
        # Serialize payload to JSON
        plaintext = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")

        # Derive salt from key (SHA-256)
        salt = hashlib.sha256(key).digest()

        # Generate random IV
        iv = os.urandom(IV_LENGTH)

        # Create cipher and encrypt
        cipher = AES.new(key, AES.MODE_GCM, nonce=iv)
        ciphertext, tag = cipher.encrypt_and_digest(plaintext)

        # Combine: salt + IV + ciphertext + tag
        encrypted = salt + iv + ciphertext + tag

        # Base64 encode
        return base64.b64encode(encrypted).decode("ascii")

    except Exception as e:
        raise EncryptionError(f"Failed to encrypt payload: {e}") from e


def decrypt_payload(encrypted_b64: str, key: bytes) -> dict[str, Any]:
    """
    Decrypt an AES-256-GCM encrypted payload.

    Args:
        encrypted_b64: Base64-encoded encrypted payload.
        key: 32-byte encryption key.

    Returns:
        Decrypted payload as a dictionary.

    Raises:
        EncryptionError: If decryption fails or data is corrupted.
    """
    if len(key) != KEY_LENGTH:
        raise EncryptionError(
            f"Encryption key must be {KEY_LENGTH} bytes, got {len(key)}"
        )

    try:
        # Base64 decode
        encrypted = base64.b64decode(encrypted_b64, validate=True)

        # Extract components
        if len(encrypted) < SALT_LENGTH + IV_LENGTH + TAG_LENGTH:
            raise EncryptionError("Encrypted data is too short")

        salt = encrypted[:SALT_LENGTH]
        iv = encrypted[SALT_LENGTH:SALT_LENGTH + IV_LENGTH]
        tag = encrypted[-TAG_LENGTH:]
        ciphertext = encrypted[SALT_LENGTH + IV_LENGTH:-TAG_LENGTH]

        expected_salt = hashlib.sha256(key).digest()
        if not hmac.compare_digest(salt, expected_salt):
            raise EncryptionError("Invalid salt for provided key")

        # Decrypt
        cipher = AES.new(key, AES.MODE_GCM, nonce=iv)
        plaintext = cipher.decrypt_and_verify(ciphertext, tag)

        # Parse JSON
        decoded: dict[str, Any] = json.loads(plaintext.decode("utf-8"))
        return decoded

    except EncryptionError:
        raise
    except Exception as e:
        raise EncryptionError(f"Failed to decrypt payload: {e}") from e


def key_from_hex(hex_key: str) -> bytes:
    """
    Convert a hex-encoded key string to bytes.

    Args:
        hex_key: Hex-encoded 32-byte key (64 hex characters).

    Returns:
        32-byte key.

    Raises:
        EncryptionError: If the hex string is invalid or wrong length.

    Example:
        >>> key = key_from_hex("0123456789abcdef" * 4)
    """
    try:
        key = bytes.fromhex(hex_key)
        if len(key) != KEY_LENGTH:
            raise EncryptionError(
                f"Key must be {KEY_LENGTH} bytes ({KEY_LENGTH * 2} hex chars), "
                f"got {len(key)} bytes"
            )
        return key
    except ValueError as e:
        raise EncryptionError(f"Invalid hex key: {e}") from e


def key_from_base64(b64_key: str) -> bytes:
    """
    Convert a base64-encoded key string to bytes.

    Args:
        b64_key: Base64-encoded 32-byte key.

    Returns:
        32-byte key.

    Raises:
        EncryptionError: If the base64 string is invalid or wrong length.

    Example:
        >>> key = key_from_base64("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
    """
    try:
        key = base64.b64decode(b64_key, validate=True)
        if len(key) != KEY_LENGTH:
            raise EncryptionError(
                f"Key must be {KEY_LENGTH} bytes, got {len(key)} bytes"
            )
        return key
    except Exception as e:
        raise EncryptionError(f"Invalid base64 key: {e}") from e
