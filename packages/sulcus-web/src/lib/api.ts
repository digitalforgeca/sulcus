/**
 * Shared API authentication for Sulcus dashboard.
 * 
 * Prefers Keycloak access token from the session cookie.
 * Falls back to static API key for backwards compatibility.
 */

export const SERVER_URL =
  process.env.NEXT_PUBLIC_SULCUS_SERVER_URL ||
  "https://sulcus-server.calmstone-a7a24a97.westus.azurecontainerapps.io";

const STATIC_API_KEY = process.env.NEXT_PUBLIC_SULCUS_API_KEY || "";

let _cachedToken: string | null = null;
let _tokenExpiresAt = 0;

/**
 * Get a valid access token, preferring the Keycloak JWT from the session.
 */
export async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 30s buffer)
  if (_cachedToken && _tokenExpiresAt > Date.now() + 30_000) {
    return _cachedToken;
  }

  try {
    const res = await fetch("/api/auth/session", { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      if (data.authenticated && data.accessToken) {
        _cachedToken = data.accessToken;
        _tokenExpiresAt = data.expiresAt || Date.now() + 300_000;
        return _cachedToken!;
      }
    }
  } catch {
    // Session endpoint unavailable — fall back
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
    _cachedToken = null;
    _tokenExpiresAt = 0;
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
  return res.json();
}
