/// Integration tests for the plugin download+decrypt+verify pipeline.
///
/// These test the cryptographic chain WITHOUT needing a running server:
/// 1. Encrypt a test payload the same way the server does (extensions.rs)
/// 2. Decrypt it the same way the client does (plugin.rs)
/// 3. Verify SHA-256 integrity
///
/// This ensures the HKDF key derivation and AES-256-GCM encrypt/decrypt
/// are compatible between sulcus-server and sulcus.
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose, Engine as _};
use hkdf::Hkdf;
use rand::RngCore;
use sha2::{Digest, Sha256};

const SALT: &[u8] = b"sulcus-sync-v1";

/// Derive a 32-byte AES key from an API key + platform string.
/// This mirrors the HKDF derivation used in both server (extensions.rs)
/// and client (plugin.rs).
fn derive_key(api_key: &str, platform: &str) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(Some(SALT), api_key.as_bytes());
    let mut okm = [0u8; 32];
    hk.expand(platform.as_bytes(), &mut okm)
        .expect("HKDF expand failed");
    okm
}

/// Encrypt a payload the way the server does.
fn server_encrypt(
    plaintext: &[u8],
    api_key: &str,
    platform: &str,
) -> (Vec<u8>, [u8; 12], String) {
    let okm = derive_key(api_key, platform);

    let mut nonce_bytes = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);

    let key = Key::<Aes256Gcm>::from_slice(&okm);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .expect("encryption failed");

    // SHA-256 of plaintext
    let mut hasher = Sha256::new();
    hasher.update(plaintext);
    let sha256_hex = hex::encode(hasher.finalize());

    (ciphertext, nonce_bytes, sha256_hex)
}

/// Decrypt a payload the way the client does.
fn client_decrypt(
    ciphertext: &[u8],
    nonce_bytes: &[u8; 12],
    api_key: &str,
    platform: &str,
) -> Result<Vec<u8>, String> {
    let okm = derive_key(api_key, platform);

    let key = Key::<Aes256Gcm>::from_slice(&okm);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| "AES-GCM decryption failed".to_string())
}

#[test]
fn test_encrypt_decrypt_roundtrip() {
    let api_key = "sk_test_abc123def456";
    let platform = "darwin-arm64";
    let plaintext = b"Hello, this is a fake dylib content for testing!";

    let (ciphertext, nonce, sha256) = server_encrypt(plaintext, api_key, platform);
    let decrypted = client_decrypt(&ciphertext, &nonce, api_key, platform).unwrap();

    assert_eq!(decrypted, plaintext);

    // Verify SHA-256
    let mut hasher = Sha256::new();
    hasher.update(&decrypted);
    let computed_sha = hex::encode(hasher.finalize());
    assert_eq!(computed_sha, sha256);
}

#[test]
fn test_wrong_api_key_fails_decrypt() {
    let api_key = "sk_test_correct_key";
    let wrong_key = "sk_test_wrong_key";
    let platform = "linux-x86_64";
    let plaintext = b"secret dylib bytes";

    let (ciphertext, nonce, _sha256) = server_encrypt(plaintext, api_key, platform);
    let result = client_decrypt(&ciphertext, &nonce, wrong_key, platform);

    assert!(result.is_err(), "decryption with wrong key should fail");
}

#[test]
fn test_wrong_platform_fails_decrypt() {
    let api_key = "sk_test_platform_mismatch";
    let server_platform = "darwin-arm64";
    let client_platform = "linux-x86_64";
    let plaintext = b"platform-specific binary";

    let (ciphertext, nonce, _sha256) =
        server_encrypt(plaintext, api_key, server_platform);
    let result = client_decrypt(&ciphertext, &nonce, api_key, client_platform);

    assert!(
        result.is_err(),
        "decryption with wrong platform should fail (different HKDF info)"
    );
}

#[test]
fn test_tampered_ciphertext_fails() {
    let api_key = "sk_test_tamper_check";
    let platform = "darwin-x86_64";
    let plaintext = b"binary that should not be tampered with";

    let (mut ciphertext, nonce, _sha256) = server_encrypt(plaintext, api_key, platform);

    // Tamper with one byte
    if let Some(byte) = ciphertext.get_mut(0) {
        *byte ^= 0xFF;
    }

    let result = client_decrypt(&ciphertext, &nonce, api_key, platform);
    assert!(result.is_err(), "tampered ciphertext should fail GCM auth");
}

#[test]
fn test_large_payload_roundtrip() {
    // Simulate a real dylib size (~8MB)
    let api_key = "sk_test_large_binary";
    let platform = "linux-aarch64";
    let plaintext: Vec<u8> = (0..8_000_000).map(|i| (i % 256) as u8).collect();

    let (ciphertext, nonce, sha256) = server_encrypt(&plaintext, api_key, platform);
    let decrypted = client_decrypt(&ciphertext, &nonce, api_key, platform).unwrap();

    assert_eq!(decrypted.len(), plaintext.len());
    assert_eq!(decrypted, plaintext);

    let mut hasher = Sha256::new();
    hasher.update(&decrypted);
    assert_eq!(hex::encode(hasher.finalize()), sha256);
}

#[test]
fn test_all_platforms_derive_different_keys() {
    let api_key = "sk_test_platform_keys";
    let platforms = ["darwin-arm64", "darwin-x86_64", "linux-x86_64", "linux-aarch64"];

    let keys: Vec<[u8; 32]> = platforms.iter().map(|p| derive_key(api_key, p)).collect();

    // All keys should be unique
    for i in 0..keys.len() {
        for j in (i + 1)..keys.len() {
            assert_ne!(
                keys[i], keys[j],
                "keys for {} and {} should differ",
                platforms[i], platforms[j]
            );
        }
    }
}

#[test]
fn test_base64_json_roundtrip() {
    // Test the full serialization path: server encrypts → base64 → JSON → client decodes → decrypts
    let api_key = "sk_test_json_roundtrip";
    let platform = "darwin-arm64";
    let plaintext = b"testing the full JSON wire format";

    let (ciphertext, nonce_bytes, sha256) = server_encrypt(plaintext, api_key, platform);

    // Serialize the way the server does
    let nonce_hex = hex::encode(nonce_bytes);
    let blob_b64 = general_purpose::STANDARD.encode(&ciphertext);

    // Deserialize the way the client does
    let decoded_nonce: [u8; 12] = hex::decode(&nonce_hex)
        .unwrap()
        .try_into()
        .unwrap();
    let decoded_ciphertext = general_purpose::STANDARD.decode(&blob_b64).unwrap();

    let decrypted =
        client_decrypt(&decoded_ciphertext, &decoded_nonce, api_key, platform).unwrap();
    assert_eq!(decrypted, plaintext);

    let mut hasher = Sha256::new();
    hasher.update(&decrypted);
    assert_eq!(hex::encode(hasher.finalize()), sha256);
}
