import { describe, it } from "node:test";
import assert from "node:assert/strict";
import util from "node:util";
import {
  validateApiKey,
  maskApiKey,
  validateBaseUrl,
  validateNamespace,
  detectSensitiveData,
  enforceSecurityGuard,
  SecurityValidationError,
  Sulcus,
} from "../dist/index.mjs";

describe("Node.js SDK Security & Validation", () => {
  describe("validateApiKey", () => {
    it("accepts valid API keys and trims whitespace", () => {
      const key = "sk-live_12345678abcdef";
      assert.equal(validateApiKey(key), key);
      assert.equal(validateApiKey(`  ${key}  `), key);
    });

    it("throws when API key is missing and required", () => {
      assert.throws(() => validateApiKey(undefined, true), {
        name: "SecurityValidationError",
        message: /API key is required/,
      });
      assert.throws(() => validateApiKey("", true), {
        name: "SecurityValidationError",
        message: /API key is required/,
      });
      assert.throws(() => validateApiKey("   ", true), {
        name: "SecurityValidationError",
        message: /API key is required/,
      });
    });

    it("allows missing API key when required is false", () => {
      assert.equal(validateApiKey(undefined, false), undefined);
      assert.equal(validateApiKey("", false), undefined);
    });

    it("throws on newline or control characters", () => {
      assert.throws(() => validateApiKey("sk-live_test\nkey1234"), {
        name: "SecurityValidationError",
        message: /invalid whitespace or control characters/,
      });
      assert.throws(() => validateApiKey("sk-live_test\r\nkey1234"), {
        name: "SecurityValidationError",
        message: /invalid whitespace or control characters/,
      });
      assert.throws(() => validateApiKey("sk-live_\x00key1234"), {
        name: "SecurityValidationError",
        message: /invalid whitespace or control characters/,
      });
    });

    it("throws on abnormally short API keys", () => {
      assert.throws(() => validateApiKey("sk-123"), {
        name: "SecurityValidationError",
        message: /abnormally short/,
      });
    });
  });

  describe("maskApiKey", () => {
    it("returns [not-configured] for falsy keys", () => {
      assert.equal(maskApiKey(undefined), "[not-configured]");
      assert.equal(maskApiKey(""), "[not-configured]");
    });

    it("masks short keys", () => {
      assert.equal(maskApiKey("short"), "sk-***");
    });

    it("masks sk- prefixed keys safely", () => {
      assert.equal(maskApiKey("sk-live_abcdef1234567890xyz"), "sk-...0xyz");
    });

    it("masks non-sk keys safely", () => {
      assert.equal(maskApiKey("token_1234567890abcdef"), "tok...cdef");
    });
  });

  describe("validateBaseUrl", () => {
    it("validates and strips trailing slashes", () => {
      assert.equal(validateBaseUrl("https://api.sulcus.ca"), "https://api.sulcus.ca");
      assert.equal(validateBaseUrl("https://api.sulcus.ca///"), "https://api.sulcus.ca");
      assert.equal(validateBaseUrl("http://localhost:8080"), "http://localhost:8080");
      assert.equal(validateBaseUrl("http://127.0.0.1:8080/"), "http://127.0.0.1:8080");
    });

    it("rejects non-http/https schemes", () => {
      assert.throws(() => validateBaseUrl("ftp://example.com"), {
        name: "SecurityValidationError",
        message: /Insecure or unsupported URL scheme/,
      });
      assert.throws(() => validateBaseUrl("file:///etc/passwd"), {
        name: "SecurityValidationError",
        message: /Insecure or unsupported URL scheme/,
      });
    });

    it("rejects control characters or newlines", () => {
      assert.throws(() => validateBaseUrl("https://api.sulcus.ca\r\n"), {
        name: "SecurityValidationError",
        message: /illegal control characters/,
      });
    });
  });

  describe("validateNamespace", () => {
    it("accepts valid namespaces and defaults", () => {
      assert.equal(validateNamespace(), "default");
      assert.equal(validateNamespace("default"), "default");
      assert.equal(validateNamespace("team-alpha"), "team-alpha");
      assert.equal(validateNamespace("org:123/agent:456"), "org:123/agent:456");
      assert.equal(validateNamespace("user.prefs_2026"), "user.prefs_2026");
    });

    it("rejects path traversal and illegal characters", () => {
      assert.throws(() => validateNamespace("../admin"), {
        name: "SecurityValidationError",
        message: /illegal path traversal/,
      });
      assert.throws(() => validateNamespace("foo/../../bar"), {
        name: "SecurityValidationError",
        message: /illegal path traversal/,
      });
      assert.throws(() => validateNamespace("team\0alpha"), {
        name: "SecurityValidationError",
        message: /illegal path traversal/,
      });
      assert.throws(() => validateNamespace("team$alpha"), {
        name: "SecurityValidationError",
        message: /invalid characters/,
      });
    });
  });

  describe("detectSensitiveData", () => {
    it("returns empty array for safe content", () => {
      const safe = "User preferences for theme: dark mode and high contrast.";
      assert.deepEqual(detectSensitiveData(safe), []);
    });

    it("detects AWS access keys", () => {
      const text = "Deploying with key AKIA1234567890ABCDEF to us-west-2";
      const matches = detectSensitiveData(text);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].type, "aws_access_key");
    });

    it("detects private key headers", () => {
      const text = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----";
      const matches = detectSensitiveData(text);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].type, "private_key");
    });

    it("detects GitHub tokens", () => {
      const text = "Auth token: ghp_1234567890abcdefghijklmnopqrstuvwxyz12";
      const matches = detectSensitiveData(text);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].type, "github_token");
    });

    it("detects database connection strings with credentials", () => {
      const text = "Connect to postgres://app_user:s3cr3tp4ss@db.internal:5432/main";
      const matches = detectSensitiveData(text);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].type, "db_credentials");
    });
  });

  describe("enforceSecurityGuard", () => {
    const secret = "The password is in postgres://admin:secret123@db:5432/data";

    it("rejects secrets when mode is 'reject'", () => {
      assert.throws(() => enforceSecurityGuard(secret, "reject", "storing memory"), {
        name: "SecurityValidationError",
        message: /Security Alert: Detected sensitive credential/,
      });
    });

    it("does not throw when mode is 'off'", () => {
      assert.doesNotThrow(() => enforceSecurityGuard(secret, "off", "storing memory"));
    });
  });

  describe("Client-side Credential Masking in Inspection & Serialization", () => {
    const secretKey = "sk-live_very_secret_key_123456789";
    const client = new Sulcus({ apiKey: secretKey });

    it("masks API key in util.inspect", () => {
      const inspected = util.inspect(client);
      assert.ok(!inspected.includes(secretKey), "Inspected output must not contain plaintext API key");
      assert.ok(inspected.includes("sk-...6789"), "Inspected output should contain masked API key");
    });

    it("masks API key in JSON.stringify", () => {
      const serialized = JSON.stringify(client);
      assert.ok(!serialized.includes(secretKey), "Serialized JSON must not contain plaintext API key");
      assert.ok(serialized.includes("sk-...6789"), "Serialized JSON should contain masked API key");
    });
  });
});
