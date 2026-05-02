#!/usr/bin/env python3
"""
Anonymize Sulcus training data — replace PII with realistic fakes via Faker.

Replaces real API keys, emails, IPs, tokens, etc. with plausible-looking
synthetic values (same format, different data). This produces training data
that looks natural rather than littered with [PLACEHOLDER] brackets.

Uses Faker for realistic generation + deterministic seeding per-record for
reproducibility.

Usage:
    python anonymize.py --input labeled_memories.jsonl --output anonymized_memories.jsonl
"""

import argparse
import json
import re
import sys
import random
import string
import hashlib

from faker import Faker

fake = Faker()
Faker.seed(42)
random.seed(42)


# ── FAKE GENERATORS ──

def fake_api_key() -> str:
    """Generate a realistic-looking API key (sk-...)."""
    return "sk-" + "".join(random.choices("abcdef0123456789", k=32))


def fake_bearer_token() -> str:
    """Generate a realistic-looking Bearer token."""
    return "Bearer " + "".join(random.choices(string.ascii_letters + string.digits + "+/=", k=40))


def fake_webhook_secret() -> str:
    return "whsec_" + "".join(random.choices(string.ascii_letters + string.digits, k=32))


def fake_azure_endpoint() -> str:
    subdomain = fake.word() + "-" + fake.word()
    return f"https://{subdomain}.cognitiveservices.azure.com/openai/deployments/model/chat"


def fake_azure_app_url() -> str:
    subdomain = fake.word() + "-" + fake.word()
    return f"https://{subdomain}.azurecontainerapps.io"


def fake_secret() -> str:
    """Generic secret value."""
    return "".join(random.choices(string.ascii_letters + string.digits + "_-.", k=random.randint(16, 32)))


def fake_ssh_key() -> str:
    return "-----BEGIN RSA PRIVATE KEY-----\nMIIE...{truncated}...==\n-----END RSA PRIVATE KEY-----"


def fake_email() -> str:
    return fake.email()


def fake_ip() -> str:
    return fake.ipv4()


def fake_discord_token() -> str:
    return "".join(random.choices(string.ascii_letters + string.digits + "._-", k=60))


def fake_stripe_key(match) -> str:
    prefix = match.group(0)[:7]  # e.g. "sk_test" or "pk_live"
    if prefix.startswith("sk_"):
        prefix = "sk_test_"
    elif prefix.startswith("pk_"):
        prefix = "pk_test_"
    elif prefix.startswith("rk_"):
        prefix = "rk_test_"
    else:
        prefix = "sk_test_"
    return prefix + "".join(random.choices(string.ascii_letters + string.digits, k=24))


def fake_hex_secret() -> str:
    return "".join(random.choices("abcdef0123456789", k=40))


def fake_sulcus_key() -> str:
    prefix = random.choice(["prod", "dev", "staging"])
    return f"{prefix}-sulcus-" + "".join(random.choices("abcdef0123456789", k=32))


def fake_oauth_secret() -> str:
    return "WPL_AP1." + "".join(random.choices(string.ascii_letters + string.digits + "+/=", k=20))


def fake_service_sid() -> str:
    prefix = random.choice(["AC", "SK"])
    return prefix + "".join(random.choices("abcdef0123456789", k=32))


# ── PII PATTERNS (regex → faker generator) ──
# Each entry: (compiled regex, replacement function or string)
# Functions receive the match object, strings are used directly.

PATTERNS = [
    # API keys (sk-..., various formats)
    (re.compile(r'sk-[a-f0-9]{20,}'), lambda m: fake_api_key()),
    (re.compile(r'(?:api[_\s]?key|apikey)[:\s=]+[\"\']?([A-Za-z0-9_\-]{15,})[\"\']?', re.I),
     lambda m: f"api_key: {fake_api_key()}"),

    # Bearer tokens
    (re.compile(r'Bearer\s+[A-Za-z0-9+/=_\-]{20,}', re.I), lambda m: fake_bearer_token()),

    # Webhook secrets
    (re.compile(r'whsec_[A-Za-z0-9]{20,}'), lambda m: fake_webhook_secret()),

    # Azure/cloud endpoint URLs with keys
    (re.compile(r'https?://[a-z0-9\-]+\.cognitiveservices\.azure\.com\S*'), lambda m: fake_azure_endpoint()),
    (re.compile(r'https?://[a-z0-9\-]+\.azurecontainerapps\.io\S*'), lambda m: fake_azure_app_url()),

    # Generic tokens/secrets in key=value format
    (re.compile(r'((?:secret|token|password|passwd|pwd)[:\s=]+)[\"\']?[A-Za-z0-9+/=_\-\.]{10,}[\"\']?', re.I),
     lambda m: m.group(1) + fake_secret()),

    # SSH private keys
    (re.compile(r'-----BEGIN[A-Z\s]+PRIVATE KEY-----[\s\S]*?-----END[A-Z\s]+PRIVATE KEY-----'),
     lambda m: fake_ssh_key()),

    # Email addresses
    (re.compile(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}'), lambda m: fake_email()),

    # IP addresses (v4)
    (re.compile(r'\b(?:\d{1,3}\.){3}\d{1,3}\b'), lambda m: fake_ip()),

    # Discord tokens (bot tokens are base64-ish)
    (re.compile(r'((?:discord|bot)\s*token[:\s=]+)[\"\']?[A-Za-z0-9._\-]{50,}[\"\']?', re.I),
     lambda m: m.group(1) + fake_discord_token()),

    # Stripe keys
    (re.compile(r'(?:pk|sk|rk)_(?:test|live)_[A-Za-z0-9]{20,}'), fake_stripe_key),

    # Generic hex secrets (32+ chars in credential context)
    (re.compile(r'((?:key|secret|hash|salt)[:\s=]+)[\"\']?[a-f0-9]{32,}[\"\']?', re.I),
     lambda m: m.group(1) + fake_hex_secret()),

    # Sulcus-style API keys
    (re.compile(r'[a-z]+-sulcus-[a-f0-9]{32}'), lambda m: fake_sulcus_key()),

    # LinkedIn/OAuth secrets
    (re.compile(r'WPL_AP1\.[A-Za-z0-9+/=]{10,}'), lambda m: fake_oauth_secret()),

    # Sinch/Twilio SIDs
    (re.compile(r'(?:AC|SK)[a-f0-9]{32}', re.I), lambda m: fake_service_sid()),
]

# Names we know about that should be preserved (these are public agent names, not PII)
PRESERVE_NAMES = {'Daedalus', 'Icarus', 'Ariadne', 'Dooley', 'Sulcus', 'Booker', 'Minerva'}


def anonymize_text(text: str) -> tuple[str, int]:
    """
    Apply all PII patterns to text, replacing with realistic fakes.
    Returns (anonymized_text, replacement_count).
    """
    count = 0
    result = text
    for pattern, replacer in PATTERNS:
        if callable(replacer):
            new_result, n = pattern.subn(replacer, result)
        else:
            new_result, n = pattern.subn(replacer, result)
        count += n
        result = new_result
    return result, count


def deplaceholder(text: str) -> str:
    """
    Replace any remaining bracket placeholders from prior anonymization runs
    with realistic fakes. Handles [API_KEY], [TOKEN], [EMAIL], [IP_ADDR], etc.
    """
    placeholder_map = {
        "[API_KEY]": fake_api_key,
        "[TOKEN]": lambda: "".join(random.choices(string.ascii_letters + string.digits, k=32)),
        "[SECRET]": fake_secret,
        "[EMAIL]": fake_email,
        "[IP_ADDR]": fake_ip,
        "[AZURE_ENDPOINT]": fake_azure_endpoint,
        "[AZURE_APP_URL]": fake_azure_app_url,
        "[WEBHOOK_SECRET]": fake_webhook_secret,
        "[HEX_SECRET]": fake_hex_secret,
        "[SULCUS_KEY]": fake_sulcus_key,
        "[SSH_PRIVATE_KEY]": fake_ssh_key,
        "[STRIPE_KEY]": lambda: "sk_test_" + "".join(random.choices(string.ascii_letters + string.digits, k=24)),
        "[DISCORD_TOKEN]": fake_discord_token,
        "[OAUTH_SECRET]": fake_oauth_secret,
        "[SERVICE_SID]": fake_service_sid,
    }
    # Also handle "Bearer [TOKEN]" as a unit
    text = re.sub(r'Bearer \[TOKEN\]', lambda m: fake_bearer_token(), text)

    for placeholder, generator in placeholder_map.items():
        while placeholder in text:
            text = text.replace(placeholder, generator(), 1)
    return text


def main():
    parser = argparse.ArgumentParser(description="Anonymize Sulcus training data")
    parser.add_argument("--input", required=True, help="Input labeled JSONL")
    parser.add_argument("--output", default="anonymized_memories.jsonl", help="Output anonymized JSONL")
    parser.add_argument("--dry-run", action="store_true", help="Show replacements without writing")
    parser.add_argument("--deplaceholder", action="store_true",
                        help="Also replace [BRACKET] placeholders from prior runs with fakes")
    args = parser.parse_args()

    records = []
    with open(args.input) as f:
        for line in f:
            if line.strip():
                records.append(json.loads(line))

    total_replacements = 0
    records_with_pii = 0

    for rec in records:
        original = rec["content"]
        anonymized, count = anonymize_text(original)

        # Replace any leftover bracket placeholders from prior anonymization
        if args.deplaceholder:
            pre_deplace = anonymized
            anonymized = deplaceholder(anonymized)
            if anonymized != pre_deplace:
                # Count bracket replacements
                import difflib
                bracket_count = sum(1 for tag in re.findall(r'\[[A-Z_]+\]', pre_deplace))
                count += bracket_count

        rec["content"] = anonymized
        rec["pii_replacements"] = count

        if count > 0:
            records_with_pii += 1
            total_replacements += count

            if args.dry_run:
                print(f"\n--- Record {rec['id']} ({count} replacements) ---", file=sys.stderr)
                print(f"  BEFORE: {original[:200]}", file=sys.stderr)
                print(f"  AFTER:  {anonymized[:200]}", file=sys.stderr)

    if not args.dry_run:
        with open(args.output, "w") as f:
            for rec in records:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    print(f"\nAnonymization complete:", file=sys.stderr)
    print(f"  Total records: {len(records)}", file=sys.stderr)
    print(f"  Records with PII: {records_with_pii}", file=sys.stderr)
    print(f"  Total replacements: {total_replacements}", file=sys.stderr)
    if not args.dry_run:
        print(f"  Output: {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
