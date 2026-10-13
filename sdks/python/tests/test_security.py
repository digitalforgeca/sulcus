"""Tests for Sulcus client-side security validation and guardrails."""

import pytest
import warnings
from sulcus.security import (
    SecurityValidationError,
    SensitiveDataWarning,
    validate_api_key,
    mask_api_key,
    validate_base_url,
    validate_namespace,
    detect_sensitive_data,
    enforce_security_guard,
)
from sulcus import Sulcus, AsyncSulcus


def test_validate_api_key_valid():
    key = "sk-live_0123456789abcdef"
    assert validate_api_key(key) == key
    assert validate_api_key(f"  {key}  ") == key


def test_validate_api_key_required():
    with pytest.raises(SecurityValidationError, match="API key is required"):
        validate_api_key(None, required=True)
    with pytest.raises(SecurityValidationError, match="API key is required"):
        validate_api_key("", required=True)
    with pytest.raises(SecurityValidationError, match="API key is required"):
        validate_api_key("   ", required=True)

    # Optional mode (e.g. for localhost)
    assert validate_api_key(None, required=False) is None
    assert validate_api_key("", required=False) is None


def test_validate_api_key_control_chars():
    with pytest.raises(SecurityValidationError, match="invalid whitespace or control characters"):
        validate_api_key("sk-live_test\nkey1234")
    with pytest.raises(SecurityValidationError, match="invalid whitespace or control characters"):
        validate_api_key("sk-live_test\r\nkey1234")
    with pytest.raises(SecurityValidationError, match="invalid whitespace or control characters"):
        validate_api_key("sk-live_\x00key1234")


def test_validate_api_key_length():
    with pytest.raises(SecurityValidationError, match="abnormally short"):
        validate_api_key("sk-123")


def test_mask_api_key():
    assert mask_api_key(None) == "[not-configured]"
    assert mask_api_key("") == "[not-configured]"
    assert mask_api_key("short") == "sk-***"
    assert mask_api_key("sk-live_abcdef1234567890xyz") == "sk-...0xyz"
    assert mask_api_key("token_1234567890abcdef") == "tok...cdef"


def test_validate_base_url():
    assert validate_base_url("https://api.sulcus.ca") == "https://api.sulcus.ca"
    assert validate_base_url("https://api.sulcus.ca///") == "https://api.sulcus.ca"
    assert validate_base_url("http://localhost:8080") == "http://localhost:8080"
    assert validate_base_url("http://127.0.0.1:8080/") == "http://127.0.0.1:8080"

    with pytest.raises(SecurityValidationError, match="Insecure or unsupported URL scheme"):
        validate_base_url("ftp://example.com")
    with pytest.raises(SecurityValidationError, match="Insecure or unsupported URL scheme"):
        validate_base_url("file:///etc/passwd")
    with pytest.raises(SecurityValidationError, match="illegal control characters"):
        validate_base_url("https://api.sulcus.ca\r\n")


def test_validate_namespace():
    assert validate_namespace(None) == "default"
    assert validate_namespace("default") == "default"
    assert validate_namespace("team-alpha") == "team-alpha"
    assert validate_namespace("org:123/agent:456") == "org:123/agent:456"
    assert validate_namespace("user.prefs_2026") == "user.prefs_2026"

    with pytest.raises(SecurityValidationError, match="illegal path traversal"):
        validate_namespace("../admin")
    with pytest.raises(SecurityValidationError, match="illegal path traversal"):
        validate_namespace("foo/../../bar")
    with pytest.raises(SecurityValidationError, match="illegal path traversal"):
        validate_namespace("default\0admin")
    with pytest.raises(SecurityValidationError, match="invalid characters"):
        validate_namespace("team$alpha")
    with pytest.raises(SecurityValidationError, match="invalid characters"):
        validate_namespace("team;drop table")


def test_detect_sensitive_data():
    safe_text = "User preferences for theme: dark mode and high contrast."
    assert detect_sensitive_data(safe_text) == []

    # AWS key
    aws_text = "Deploying with key AKIA1234567890ABCDEF to us-west-2"
    matches = detect_sensitive_data(aws_text)
    assert len(matches) == 1
    assert matches[0]["type"] == "aws_access_key"

    # Private key
    key_text = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----"
    matches = detect_sensitive_data(key_text)
    assert len(matches) == 1
    assert matches[0]["type"] == "private_key"

    # GitHub token
    gh_text = "Auth token: ghp_1234567890abcdefghijklmnopqrstuvwxyz12"
    matches = detect_sensitive_data(gh_text)
    assert len(matches) == 1
    assert matches[0]["type"] == "github_token"

    # OpenAI key
    oai_text = "Use key sk-1234567890abcdef1234567890abcdef1234 for OpenAI"
    matches = detect_sensitive_data(oai_text)
    assert len(matches) == 1
    assert matches[0]["type"] == "openai_key"

    # Database URL
    db_text = "Connect to postgres://app_user:s3cr3tp4ss@db.internal:5432/main"
    matches = detect_sensitive_data(db_text)
    assert len(matches) == 1
    assert matches[0]["type"] == "db_credentials"


def test_enforce_security_guard_policies():
    secret_text = "The password is in postgres://admin:secret123@db:5432/data"

    # Mode: reject
    with pytest.raises(SecurityValidationError, match="Security violation: Detected sensitive credentials"):
        enforce_security_guard(secret_text, mode="reject", action_description="testing store")

    # Mode: warn
    with pytest.warns(SensitiveDataWarning, match="Detected potential sensitive credential"):
        enforce_security_guard(secret_text, mode="warn", action_description="testing store")

    # Mode: off
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        # Should not raise any warning or error
        enforce_security_guard(secret_text, mode="off", action_description="testing store")


def test_client_repr_masks_credentials():
    secret = "sk-live_very_secret_key_123456789"
    client = Sulcus(api_key=secret)
    repr_str = repr(client)
    assert secret not in repr_str
    assert "sk-...6789" in repr_str
    assert str(client) == repr_str

    async_client = AsyncSulcus(api_key=secret)
    async_repr = repr(async_client)
    assert secret not in async_repr
    assert "sk-...6789" in async_repr
