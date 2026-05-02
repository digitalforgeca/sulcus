/**
 * Shared API authentication for Sulcus dashboard.
 *
 * Prefers Keycloak access token from the PKCE session (oidc-client-ts).
 * Falls back to static API key for backwards compatibility.
 * In local mode (NEXT_PUBLIC_LOCAL_MODE=true), skips auth entirely —
 * sulcus accepts all requests from localhost without credentials.
 */

export const SERVER_URL =
  process.env.NEXT_PUBLIC_SULCUS_SERVER_URL ||
  "https://api.sulcus.ca";

/** True when the dashboard is running against a local sulcus instance. */
export const IS_LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

const STATIC_API_KEY = process.env.NEXT_PUBLIC_SULCUS_API_KEY || "";

/**
 * Get a valid access token from the PKCE session.
 * In local mode, returns empty string — no auth needed.
 */
export async function getAccessToken(): Promise<string> {
  if (IS_LOCAL_MODE) return "";

  // Dynamically import to avoid SSR issues (oidc-client-ts uses browser APIs)
  try {
    const { getAccessToken: oidcGetToken } = await import("@/lib/auth");
    const token = await oidcGetToken();
    if (token) return token;
  } catch {
    // Auth module unavailable (SSR or error) — fall back
  }

  return STATIC_API_KEY;
}

/**
 * Get authorization headers for API calls.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/**
 * Authenticated fetch wrapper for Sulcus server API.
 * If a Keycloak JWT returns 401 (OIDC not yet validated on server),
 * retries with the static API key as fallback.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const hdrs = await authHeaders();
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers: { ...hdrs, ...init?.headers },
  });

  // If 401 and we used a JWT (starts with eyJ), retry with static API key
  if (res.status === 401 && STATIC_API_KEY && hdrs.Authorization?.includes("eyJ")) {
    const fallbackHdrs = {
      Authorization: `Bearer ${STATIC_API_KEY}`,
      "Content-Type": "application/json",
    };
    const retry = await fetch(`${SERVER_URL}${path}`, {
      ...init,
      headers: { ...fallbackHdrs, ...init?.headers },
    });
    if (!retry.ok) {
      const text = await retry.text().catch(() => retry.statusText);
      throw new Error(`API ${retry.status}: ${text}`);
    }
    if (retry.status === 204) return undefined as unknown as T;
    return retry.json();
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  const text = await res.text();
  if (!text) return undefined as unknown as T;
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`API returned invalid JSON (status ${res.status})`); }
}
