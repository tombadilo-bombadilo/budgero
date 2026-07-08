import base64
import json
import os
import pytest
from budgero.client import BudgeroClient
from budgero.encryption import (
    encrypt_payload,
    decrypt_payload,
    key_from_hex,
    key_from_base64,
    EncryptionError,
    KEY_LENGTH,
    IV_LENGTH,
    TAG_LENGTH,
    SALT_LENGTH,
)

@pytest.fixture
def key():
    return os.urandom(KEY_LENGTH)

@pytest.fixture
def payload():
    return {"op": "test", "args": {"foo": "bar", "num": 123}}

def test_encrypt_decrypt_roundtrip(key, payload):
    """Test that data can be encrypted and decrypted back to original."""
    encrypted = encrypt_payload(payload, key)
    assert isinstance(encrypted, str)
    
    decrypted = decrypt_payload(encrypted, key)
    assert decrypted == payload

def test_encrypt_format(key, payload):
    """Test that encrypted output has correct format and length."""
    encrypted_b64 = encrypt_payload(payload, key)
    encrypted_bytes = base64.b64decode(encrypted_b64)
    
    # Minimum length: salt + IV + Tag + at least some ciphertext
    assert len(encrypted_bytes) > SALT_LENGTH + IV_LENGTH + TAG_LENGTH

def test_decrypt_invalid_key(key, payload):
    """Test that decryption fails with wrong key."""
    encrypted = encrypt_payload(payload, key)
    wrong_key = os.urandom(KEY_LENGTH)
    
    with pytest.raises(EncryptionError):
        decrypt_payload(encrypted, wrong_key)

def test_decrypt_corrupted_data(key, payload):
    """Test that decryption fails with modified data."""
    encrypted_b64 = encrypt_payload(payload, key)
    encrypted_bytes = bytearray(base64.b64decode(encrypted_b64))
    
    # Flip a bit in the ciphertext (after salt + IV)
    encrypted_bytes[SALT_LENGTH + IV_LENGTH + 5] ^= 0x01
    
    corrupted_b64 = base64.b64encode(encrypted_bytes).decode("ascii")
    
    with pytest.raises(EncryptionError):
        decrypt_payload(corrupted_b64, key)

def test_key_helpers():
    """Test hex and base64 key helpers."""
    original_key = os.urandom(KEY_LENGTH)
    
    # Hex
    hex_key = original_key.hex()
    assert key_from_hex(hex_key) == original_key
    
    # Base64
    b64_key = base64.b64encode(original_key).decode("ascii")
    assert key_from_base64(b64_key) == original_key

def test_invalid_key_length():
    """Test errors for invalid key lengths."""
    short_key = os.urandom(16)
    payload = {"a": 1}
    
    with pytest.raises(EncryptionError, match="must be 32 bytes"):
        encrypt_payload(payload, short_key)
        
    with pytest.raises(EncryptionError, match="must be 32 bytes"):
        decrypt_payload("some_data", short_key)


def test_message_id_is_added_and_deterministic(key):
    """Ensure client-derived message_id is stable and included in payload."""
    b64_key = base64.b64encode(key).decode("ascii")
    client = BudgeroClient(
        api_key="test",
        encryption_key=b64_key,
        base_url="http://example.com",
    )
    try:
        message_id, encrypted = client._encrypt_mutation("transactions.add", {"foo": "bar"})
        decrypted = decrypt_payload(encrypted, key)
        assert decrypted["message_id"] == message_id

        # Same payload produces the same message_id
        message_id_again, _ = client._encrypt_mutation("transactions.add", {"foo": "bar"})
        assert message_id_again == message_id
    finally:
        client.close()
