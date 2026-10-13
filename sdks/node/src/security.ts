/**
 * Sulcus Client-Side Security & Validation Guardrails (Node.js / TypeScript).
 *
 * Provides client-side defense against:
 * 1. Accidental credential leaks in logs, stack traces, and serialized outputs.
 * 2. SSRF, protocol manipulation, and malformed base URLs.
 * 3. Namespace path traversal (e.g. `../../admin`).
 * 4. Storing sensitive API keys, private keys, or credentials into memory graphs.
 */

export class SecurityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityValidationError";
    Object.setPrototypeOf(this, SecurityValidationError.prototype);
  }
}

export interface SensitiveDataMatch {
  pattern: string;
  type: string;
  snippet: string;
}

const SENSITIVE_PATTERNS: Array<{ type: string; regex: RegExp; name: string }> = [
  {
    type: "aws_access_key",
    regex: /\b(AKIA[0-9A-Z]{16})\b/g,
    name: "AWS Access Key",
  },
  {
    type: "private_key",
    regex: /-----BEGIN (?:RSA|OPENSSH|EC|PGP|DSA)? PRIVATE KEY-----/g,
    name: "Private Key Header",
  },
  {
    type: "github_token",
    regex: /\b(gh[pousr]_[A-Za-z0-9_]{36,255})\b/g,
    name: "GitHub Token",
  },
  {
    type: "openai_key",
    regex: /\b(sk-[a-zA-Z0-9_-]{32,64})\b/g,
    name: "OpenAI Secret Key",
  },
  {
    type: "jwt",
    regex: /\beyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g,
    name: "JSON Web Token (JWT)",
  },
  {
    type: "db_credentials",
    regex: /(?:postgres|mysql|mongodb|redis):\/\/[a-zA-Z0-9_]+:[^@\s]+@[a-zA-Z0-9_.-]+/g,
    name: "Database Connection String with Credentials",
  },
];

/**
 * Validate that an API key is non-empty, contains no whitespace or control characters,
 * and conforms to reasonable length constraints.
 */
export function validateApiKey(apiKey?: string, required = true): string | undefined {
  if (!apiKey || !apiKey.trim()) {
    if (required) {
      throw new SecurityValidationError("API key is required for Sulcus Cloud operations.");
    }
    return undefined;
  }

  const trimmed = apiKey.trim();
  if (/[\r\n\t\x00-\x1f]/.test(trimmed)) {
    throw new SecurityValidationError("API key contains invalid whitespace or control characters.");
  }

  if (trimmed.length < 8) {
    throw new SecurityValidationError("API key is abnormally short (min 8 characters).");
  }

  return trimmed;
}

/**
 * Mask an API key for safe display in logs, debug outputs, and exceptions.
 * Example: `sk-live_12345678abcdef` -> `sk-...cdef`
 */
export function maskApiKey(apiKey?: string): string {
  if (!apiKey) {
    return "[not-configured]";
  }
  const clean = apiKey.trim();
  if (clean.length <= 8) {
    return "sk-***";
  }
  if (clean.startsWith("sk-")) {
    return `sk-...${clean.slice(-4)}`;
  }
  return `${clean.slice(0, 3)}...${clean.slice(-4)}`;
}

/**
 * Validate server base URL against SSRF and malformed protocol schemes.
 */
export function validateBaseUrl(url?: string): string {
  if (!url) {
    return "https://api.sulcus.ca";
  }

  if (/[\r\n\t\x00-\x1f]/.test(url)) {
    throw new SecurityValidationError("Base URL contains illegal control characters or line breaks.");
  }

  const target = url.trim().replace(/\/+$/, "");

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    throw new SecurityValidationError(`Invalid base URL: '${url}'`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SecurityValidationError(
      `Insecure or unsupported URL scheme: '${parsed.protocol}'. Must be http: or https:`
    );
  }

  return target;
}

/**
 * Validate namespace string to prevent directory traversal and injection.
 */
export function validateNamespace(namespace?: string): string {
  const target = (namespace || "default").trim();

  if (!target) {
    throw new SecurityValidationError("Namespace cannot be empty.");
  }

  if (target.includes("..") || target.includes("\0")) {
    throw new SecurityValidationError(`Namespace contains illegal path traversal characters: '${target}'`);
  }

  // Allow alphanumeric, dash, underscore, dot, colon, and forward slash (hierarchical namespaces)
  if (!/^[a-zA-Z0-9_\-\.\:\/]+$/.test(target)) {
    throw new SecurityValidationError(
      `Namespace contains invalid characters: '${target}'. Only alphanumeric, -, _, ., :, and / are allowed.`
    );
  }

  return target;
}

/**
 * Scan text for potential sensitive credentials, private keys, or connection strings.
 */
export function detectSensitiveData(text: string): SensitiveDataMatch[] {
  if (!text || typeof text !== "string") {
    return [];
  }

  const results: SensitiveDataMatch[] = [];

  for (const item of SENSITIVE_PATTERNS) {
    // Reset regex index for global regexes
    item.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = item.regex.exec(text)) !== null) {
      const matchedStr = match[0];
      const snippet =
        matchedStr.length > 12
          ? `${matchedStr.slice(0, 4)}...${matchedStr.slice(-4)}`
          : "***";
      results.push({
        pattern: item.name,
        type: item.type,
        snippet,
      });
      // Prevent infinite loop on zero-width match
      if (match.index === item.regex.lastIndex) {
        item.regex.lastIndex++;
      }
    }
  }

  return results;
}

/**
 * Enforce the client-side security guard policy.
 *
 * @param content - Memory content to inspect.
 * @param mode - Policy mode: 'warn', 'reject', or 'off'.
 * @param actionDescription - Human-readable description of the operation being guarded.
 */
export function enforceSecurityGuard(
  content: string,
  mode: "warn" | "reject" | "off" = "warn",
  actionDescription = "storing memory"
): void {
  if (mode === "off") {
    return;
  }

  const matches = detectSensitiveData(content);
  if (matches.length > 0) {
    const types = matches.map((m) => m.pattern).join(", ");
    const msg = `Security Alert: Detected sensitive credential (${types}) while ${actionDescription}.`;
    if (mode === "reject") {
      throw new SecurityValidationError(
        `${msg} Storing secrets is blocked by security policy. Mask or remove the secret before saving.`
      );
    } else {
      console.warn(`[SULCUS SECURITY WARNING] ${msg} Ensure this data is intended for persistence.`);
    }
  }
}
