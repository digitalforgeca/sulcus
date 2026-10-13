"""Sulcus Security & Validation Engine.

Provides input validation, credential masking, URL/SSRF sanitization,
and client-side sensitive data (PII/Secret) detection for Sulcus SDKs.
"""

from __future__ import annotations

import re
import urllib.parse
from typing import Any, Dict, List, Optional
import warnings


class SecurityValidationError(ValueError):
    """Raised when client input fails security validation."""
    pass


class SensitiveDataWarning(UserWarning):
    """Warned when potential secrets or credentials are detected in memory content."""
    pass


# High-confidence credential and sensitive data regex patterns
SENSITIVE_PATTERNS: List[Dict[str, Any]] = [
    {
        "type": "private_key",
        "name": "RSA/EC Private Key",
        "pattern": re.compile(r"-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----", re.MULTILINE),
        "severity": "critical",
    },
    {
        "type": "aws_access_key",
        "name": "AWS Access Key ID",
        "pattern": re.compile(r"\b(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b"),
        "severity": "critical",
    },
    {
        "type": "github_token",
        "name": "GitHub Token",
        "pattern": re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{36,}\b"),
        "severity": "high",
    },
    {
        "type": "slack_token",
        "name": "Slack Token",
        "pattern": re.compile(r"\bxox[baprs]-[0-9a-zA-Z-]{10,}\b"),
        "severity": "high",
    },
    {
        "type": "anthropic_key",
        "name": "Anthropic API Key",
        "pattern": re.compile(r"\bsk-ant-[a-zA-Z0-9_\-]{20,}\b"),
        "severity": "high",
    },
    {
        "type": "openai_key",
        "name": "Generic / OpenAI API Key",
        "pattern": re.compile(r"\bsk-[a-zA-Z0-9_\-]{24,}\b"),
        "severity": "high",
    },
    {
        "type": "google_api_key",
        "name": "Google API Key",
        "pattern": re.compile(r"\bAIza[0-9A-Za-z\-_]{35}\b"),
        "severity": "high",
    },
    {
        "type": "jwt",
        "name": "JSON Web Token (JWT)",
        "pattern": re.compile(r"\beyJ[A-Za-z0-9-_]{10,}\.eyJ[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,}\b"),
        "severity": "medium",
    },
    {
        "type": "db_credentials",
        "name": "Database Connection String with Credentials",
        "pattern": re.compile(r"(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^:\s]+:[^@\s]+@[^\s]+"),
        "severity": "critical",
    },
]

DISALLOWED_NAMESPACES = {"..", ".", "", "/", "\\"}
NAMESPACE_REGEX = re.compile(r"^[a-zA-Z0-9_\-\.:/]+$")


def validate_api_key(key: Optional[str], required: bool = True) -> Optional[str]:
    """Validate and sanitize an API key.

    Args:
        key: The API key string.
        required: Whether a non-empty key is required.

    Returns:
        The stripped, validated API key, or None if not required and empty.

    Raises:
        SecurityValidationError: If the key is invalid or contains forbidden characters.
    """
    if key is None or not str(key).strip():
        if required:
            raise SecurityValidationError("API key is required for Sulcus operations.")
        return None

    sanitized = str(key).strip()

    # Check for carriage returns, newlines, tabs, or null bytes (header injection prevention)
    if any(c in sanitized for c in ("\r", "\n", "\t", "\0")):
        raise SecurityValidationError("API key contains invalid whitespace or control characters.")

    if len(sanitized) < 8:
        raise SecurityValidationError("API key is abnormally short (min 8 characters).")

    return sanitized


def mask_api_key(key: Optional[str]) -> str:
    """Mask an API key for safe representation in logs, repr, and traces.

    Examples:
        sk-live-1234567890abcdef -> sk-...cdef
        short_key               -> sk-***
    """
    if not key:
        return "[not-configured]"

    s = str(key).strip()
    if len(s) <= 8:
        return "sk-***"

    if s.startswith("sk-"):
        return f"sk-...{s[-4:]}"

    return f"{s[:3]}...{s[-4:]}"


def validate_base_url(url: Optional[str], default: str = "https://api.sulcus.ca") -> str:
    """Validate and sanitize a server Base URL.

    Guards against:
    - Non-HTTP(S) schemes (file://, javascript:, ftp://, etc.)
    - Control characters and newlines (request smuggling)
    - Ambiguous trailing slashes

    Args:
        url: The candidate base URL.
        default: Default URL if none provided.

    Returns:
        Sanitized base URL without trailing slashes.

    Raises:
        SecurityValidationError: If the URL is malicious or malformed.
    """
    if not url:
        return default.rstrip("/")

    raw = str(url)
    if any(c in raw for c in ("\r", "\n", "\t", "\0")):
        raise SecurityValidationError("Base URL contains illegal control characters or line breaks.")

    candidate = raw.strip()

    try:
        parsed = urllib.parse.urlparse(candidate)
    except Exception as e:
        raise SecurityValidationError(f"Invalid Base URL format: {e}") from e

    if parsed.scheme.lower() not in ("http", "https"):
        raise SecurityValidationError(
            f"Insecure or unsupported URL scheme: '{parsed.scheme}'. Must be http: or https:"
        )

    if not parsed.netloc:
        raise SecurityValidationError(f"Invalid Base URL '{candidate}': missing host specification.")

    return candidate.rstrip("/")


def validate_namespace(namespace: Optional[str], default: str = "default") -> str:
    """Validate and sanitize a namespace string.

    Guards against:
    - Directory traversal sequences ('..')
    - Null bytes and control characters
    - Reserved path names

    Args:
        namespace: The candidate namespace.
        default: Default namespace fallback.

    Returns:
        The validated namespace.

    Raises:
        SecurityValidationError: If the namespace is invalid.
    """
    if namespace is None:
        return default

    ns = str(namespace).strip()
    if not ns:
        return default

    if ns in DISALLOWED_NAMESPACES or ".." in ns or "\0" in ns:
        raise SecurityValidationError(
            f"Namespace contains illegal path traversal characters: '{ns}'"
        )

    if "\r" in ns or "\n" in ns or "\t" in ns:
        raise SecurityValidationError("Invalid namespace: control characters are not permitted.")

    if not NAMESPACE_REGEX.match(ns):
        raise SecurityValidationError(
            f"Namespace contains invalid characters: '{ns}'. Only alphanumeric, -, _, ., :, and / are allowed."
        )

    return ns


def detect_sensitive_data(text: str) -> List[Dict[str, Any]]:
    """Scan input text for sensitive credentials, secrets, and private keys.

    Args:
        text: The text string to scan.

    Returns:
        List of detected match metadata dicts: name, type, severity, snippet.
    """
    if not text or not isinstance(text, str):
        return []

    matches: List[Dict[str, Any]] = []

    for item in SENSITIVE_PATTERNS:
        pattern: re.Pattern = item["pattern"]
        for match in pattern.finditer(text):
            val = match.group(0)
            masked = f"{val[:4]}...{val[-4:]}" if len(val) > 8 else "***"
            matches.append({
                "type": item["type"],
                "name": item["name"],
                "severity": item["severity"],
                "snippet": masked,
                "masked": masked,
                "start": match.start(),
                "end": match.end(),
            })

    return matches


def enforce_security_guard(
    text: str,
    mode: str = "warn",
    action_description: str = "storing memory",
) -> List[Dict[str, Any]]:
    """Inspect text according to the client's security guard policy.

    Args:
        text: Content to inspect.
        mode: Policy mode — 'warn' (default), 'reject', or 'off'.
        action_description: Description for messages.

    Returns:
        List of detected matches.

    Raises:
        SecurityValidationError: If mode is 'reject' and sensitive data was detected.
    """
    if mode == "off" or not text:
        return []

    findings = detect_sensitive_data(text)
    if not findings:
        return []

    names = ", ".join(f["name"] for f in findings)
    msg = (
        f"Security Alert: Detected sensitive credentials ({names}) while "
        f"{action_description}. Verify that secrets are not being leaked into shared memory."
    )

    if mode == "reject":
        raise SecurityValidationError(
            f"Security violation: Detected sensitive credentials ({names}) while {action_description}. "
            f"Storing secrets is blocked by security policy. Mask or remove the secret before saving."
        )
    elif mode == "warn":
        warnings.warn(f"Detected potential sensitive credential ({names}) while {action_description}.", SensitiveDataWarning, stacklevel=3)

    return findings
