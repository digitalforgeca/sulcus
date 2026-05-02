/// End-to-end integration test for the plugin download→decrypt→verify→install pipeline.
///
/// Spins up a mock HTTP server that simulates the sulcus-server extension endpoint,
/// encrypts a test dylib using the same crypto as extensions.rs, and verifies that
/// the client can download, decrypt, verify integrity, and write the file.
///
/// This test does NOT require a running sulcus-server or VPS.
/// It DOES require a built sulcus-sync cdylib to use as the test payload.
///
/// Run with: cargo test -p sulcus --test plugin_e2e --release

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use axum::{
    extract::Query,
    http::{HeaderMap, StatusCode},
    routing::get,
    Json, Router,
};
use base64::{engine::general_purpose, Engine as _};
use hkdf::Hkdf;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::Arc;

const TEST_API_KEY: &str = "sk_test_e2e_integration_key_2024";
const SALT: &[u8] = b"sulcus-sync-v1";

/// Response format matching the server's ExtensionResponse.
#[derive(Serialize)]
struct ExtensionResponse {
    version: String,
    platform: String,
    nonce: String,
    encrypted_blob: String,
    sha256_plaintext: String,
}

#[derive(Deserialize)]
struct ExtensionQuery {
    platform: String,
}

/// Shared state for the mock server — holds the dylib bytes.
struct MockState {
    dylib_bytes: Vec<u8>,
}

/// Mock handler that encrypts the dylib for each request (fresh nonce).
async fn mock_extension_handler(
    axum::extract::State(state): axum::extract::State<Arc<MockState>>,
    headers: HeaderMap,
    Query(params): Query<ExtensionQuery>,
) -> Result<Json<ExtensionResponse>, StatusCode> {
    // Verify auth header
    let raw_key = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;

    if raw_key != TEST_API_KEY {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let platform = &params.platform;
    let plaintext = &state.dylib_bytes;

    // SHA-256 of plaintext
    let mut sha_hasher = Sha256::new();
    sha_hasher.update(plaintext);
    let sha256_plaintext = hex::encode(sha_hasher.finalize());

    // HKDF key derivation (same as server)
    let hk = Hkdf::<Sha256>::new(Some(SALT), raw_key.as_bytes());
    let mut okm = [0u8; 32];
    hk.expand(platform.as_bytes(), &mut okm)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Random 12-byte nonce
    let mut nonce_bytes = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);

    // AES-256-GCM encrypt
    let key = Key::<Aes256Gcm>::from_slice(&okm);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(ExtensionResponse {
        version: "v0.1.0-test".to_string(),
        platform: platform.clone(),
        nonce: hex::encode(nonce_bytes),
        encrypted_blob: general_purpose::STANDARD.encode(&ciphertext),
        sha256_plaintext,
    }))
}

/// Find the built dylib for the current platform.
fn find_dylib() -> Option<PathBuf> {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.pop(); // crates/
    path.pop(); // repo root
    path.push("target");
    path.push("release");

    #[cfg(target_os = "macos")]
    path.push("libsulcus_sync.dylib");
    #[cfg(target_os = "linux")]
    path.push("libsulcus_sync.so");

    if path.exists() {
        Some(path)
    } else {
        None
    }
}

/// Determine the platform string for the current build target.
fn current_platform() -> &'static str {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "darwin-arm64"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "darwin-x86_64"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "linux-x86_64"
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        "linux-aarch64"
    } else {
        "unknown"
    }
}

/// Test 1: Full download→decrypt→verify pipeline using mock server and real dylib.
#[tokio::test]
async fn test_e2e_download_decrypt_verify_with_real_dylib() {
    let dylib_path = match find_dylib() {
        Some(p) => p,
        None => {
            eprintln!(
                "Skipping e2e test: sulcus-sync dylib not built. Run: cargo build --release -p sulcus-sync"
            );
            return;
        }
    };

    let dylib_bytes = std::fs::read(&dylib_path).expect("failed to read dylib");
    let dylib_size = dylib_bytes.len();
    assert!(dylib_size > 1000, "dylib too small to be real: {} bytes", dylib_size);

    // Compute expected SHA-256
    let mut hasher = Sha256::new();
    hasher.update(&dylib_bytes);
    let expected_sha = hex::encode(hasher.finalize());

    let state = Arc::new(MockState { dylib_bytes });

    // Start mock server on ephemeral port
    let app = Router::new()
        .route("/api/v1/extensions/sync", get(mock_extension_handler))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_url = format!("http://{}", addr);

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    // Give server a moment to start
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Use a temp directory instead of the real plugin path
    let tmp_dir = tempfile::tempdir().expect("failed to create temp dir");
    let tmp_plugin_path = tmp_dir.path().join(if cfg!(target_os = "macos") {
        "libsulcus_sync.dylib"
    } else {
        "libsulcus_sync.so"
    });

    // --- Replicate the client download logic (from plugin.rs) ---
    let platform = current_platform();
    let url = format!("{}/api/v1/extensions/sync?platform={}", server_url, platform);

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", TEST_API_KEY))
        .send()
        .await
        .expect("request failed");

    assert_eq!(resp.status(), 200, "expected 200 OK from mock server");

    #[derive(Deserialize)]
    struct ClientResponse {
        version: String,
        platform: String,
        nonce: String,
        encrypted_blob: String,
        sha256_plaintext: String,
    }

    let data: ClientResponse = resp.json().await.expect("failed to parse JSON response");

    assert_eq!(data.version, "v0.1.0-test");
    assert_eq!(data.platform, platform);
    assert_eq!(data.sha256_plaintext, expected_sha);

    // Decode nonce
    let nonce_bytes: Vec<u8> = hex::decode(&data.nonce).expect("invalid nonce hex");
    assert_eq!(nonce_bytes.len(), 12, "nonce must be 12 bytes");

    // Decode ciphertext
    let ciphertext = general_purpose::STANDARD
        .decode(&data.encrypted_blob)
        .expect("invalid base64 encrypted_blob");

    // Derive decryption key
    let hk = Hkdf::<Sha256>::new(Some(SALT), TEST_API_KEY.as_bytes());
    let mut okm = [0u8; 32];
    hk.expand(platform.as_bytes(), &mut okm).expect("HKDF expand failed");

    // Decrypt
    let key = Key::<Aes256Gcm>::from_slice(&okm);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .expect("AES-GCM decryption failed — crypto mismatch between mock server and client");

    // Verify size matches
    assert_eq!(plaintext.len(), dylib_size, "decrypted size mismatch");

    // Verify SHA-256
    let mut verify_hasher = Sha256::new();
    verify_hasher.update(&plaintext);
    let computed_sha = hex::encode(verify_hasher.finalize());
    assert_eq!(computed_sha, expected_sha, "SHA-256 mismatch after decrypt");

    // Write to temp path and verify it's loadable
    std::fs::write(&tmp_plugin_path, &plaintext).expect("failed to write plugin");

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp_plugin_path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    // Verify the written file has correct symbols
    assert!(tmp_plugin_path.exists(), "plugin file not written");
    let written_bytes = std::fs::read(&tmp_plugin_path).expect("failed to read written plugin");
    assert_eq!(written_bytes.len(), dylib_size, "written file size mismatch");

    // Try loading the dylib to verify it's still a valid shared library
    unsafe {
        let lib = libloading::Library::new(&tmp_plugin_path)
            .expect("failed to load downloaded+decrypted dylib — corruption in decrypt pipeline");

        let create: libloading::Symbol<sulcus::plugin::CreatePluginFn> = lib
            .get(b"sulcus_sync_create\0")
            .expect("sulcus_sync_create symbol not found in decrypted dylib");

        let raw = create();
        assert!(!raw.is_null(), "sulcus_sync_create returned null");

        let plugin = Box::from_raw(raw);
        assert!(!plugin.version().is_empty(), "plugin version empty");
        plugin.stop();
        drop(plugin);
    }

    eprintln!("✓ E2E test passed: download → decrypt → verify → load → symbols OK");
    eprintln!("  Platform: {}", platform);
    eprintln!("  Dylib size: {} bytes", dylib_size);
    eprintln!("  SHA-256: {}", expected_sha);
}

/// Test 2: Verify that wrong API key fails decryption.
#[tokio::test]
async fn test_e2e_wrong_key_cannot_decrypt() {
    // Use a synthetic payload (no need for real dylib)
    let fake_payload: Vec<u8> = [0xDE, 0xAD, 0xBE, 0xEF].iter().copied().cycle().take(4096).collect();
    let state = Arc::new(MockState {
        dylib_bytes: fake_payload,
    });

    let app = Router::new()
        .route("/api/v1/extensions/sync", get(mock_extension_handler))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_url = format!("http://{}", addr);

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let platform = current_platform();
    let url = format!("{}/api/v1/extensions/sync?platform={}", server_url, platform);

    // Download with correct key
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", TEST_API_KEY))
        .send()
        .await
        .unwrap();

    #[derive(Deserialize)]
    struct Resp {
        nonce: String,
        encrypted_blob: String,
    }

    let data: Resp = resp.json().await.unwrap();

    let nonce_bytes: Vec<u8> = hex::decode(&data.nonce).unwrap();
    let ciphertext = general_purpose::STANDARD.decode(&data.encrypted_blob).unwrap();

    // Try decrypting with WRONG key
    let wrong_key = "sk_wrong_key_attacker";
    let hk = Hkdf::<Sha256>::new(Some(SALT), wrong_key.as_bytes());
    let mut okm = [0u8; 32];
    hk.expand(platform.as_bytes(), &mut okm).unwrap();

    let key = Key::<Aes256Gcm>::from_slice(&okm);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let result = cipher.decrypt(nonce, ciphertext.as_ref());
    assert!(
        result.is_err(),
        "decryption with wrong key should fail — GCM auth tag must reject"
    );

    eprintln!("✓ Wrong-key decryption correctly rejected by AES-GCM auth tag");
}

/// Test 3: Unauthorized request (no/bad auth header) returns 401.
#[tokio::test]
async fn test_e2e_unauthorized_returns_401() {
    let state = Arc::new(MockState {
        dylib_bytes: vec![0u8; 100],
    });

    let app = Router::new()
        .route("/api/v1/extensions/sync", get(mock_extension_handler))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_url = format!("http://{}", addr);

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let client = reqwest::Client::new();

    // No auth header
    let resp = client
        .get(format!("{}/api/v1/extensions/sync?platform={}", server_url, current_platform()))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401, "missing auth should return 401");

    // Wrong key
    let resp = client
        .get(format!("{}/api/v1/extensions/sync?platform={}", server_url, current_platform()))
        .header("Authorization", "Bearer wrong_key_entirely")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401, "wrong key should return 401");

    eprintln!("✓ Unauthorized requests correctly rejected");
}
