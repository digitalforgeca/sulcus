/**
 * Client-side authentication for Sulcus.
 *
 * Uses Keycloak direct access grants (Resource Owner Password Credentials)
 * for a seamless login experience — no redirect to Keycloak UI.
 * Falls back to PKCE redirect flow for SSO / social login if needed.
 *
 * Tokens stored in localStorage; refreshed automatically.
 */

const AUTHORITY =
  "https://sulcus-keycloak.calmstone-a7a24a97.westus.azurecontainerapps.io/realms/sulcus";
const CLIENT_ID = "sulcus-web-public";
const TOKEN_ENDPOINT = `${AUTHORITY}/protocol/openid-connect/token`;
const LOGOUT_ENDPOINT = `${AUTHORITY}/protocol/openid-connect/logout`;
const REDIRECT_URI = typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : "https://sulcus.ca/auth/callback";
const USERINFO_ENDPOINT = `${AUTHORITY}/protocol/openid-connect/userinfo`;

// --- Token Storage ---

interface TokenSet {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_at: number; // unix timestamp (seconds)
  profile: Record<string, unknown>;
}

const STORAGE_KEY = "sulcus_auth";

function storeTokens(tokens: TokenSet): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

function loadTokens(): TokenSet | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TokenSet;
  } catch {
    return null;
  }
}

function clearTokens(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

// --- Direct Grant Login ---

export interface LoginResult {
  success: boolean;
  error?: string;
}

/**
 * Login with username/password via Keycloak direct access grants.
 * No redirect — stays on our page.
 */
export async function loginDirect(username: string, password: string): Promise<LoginResult> {
  try {
    const body = new URLSearchParams({
      grant_type: "password",
      client_id: CLIENT_ID,
      username,
      password,
      scope: "openid profile email",
    });

    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const desc = (err as Record<string, string>).error_description || "Invalid credentials";
      return { success: false, error: desc };
    }

    const data = await res.json();
    const expiresAt = Math.floor(Date.now() / 1000) + (data.expires_in || 300);

    // Decode both ID token and access token to get full profile claims.
    // realm_access (roles) may only be in the access token depending on Keycloak config.
    const idProfile = parseJwt(data.id_token);
    const accessProfile = parseJwt(data.access_token);

    // Merge: ID token is the source of truth for identity claims,
    // but fall back to access token for realm_access/roles if missing from ID token.
    const profile: Record<string, unknown> = { ...idProfile };
    if (!profile["realm_access"] && accessProfile["realm_access"]) {
      profile["realm_access"] = accessProfile["realm_access"];
    }
    if (!profile["resource_access"] && accessProfile["resource_access"]) {
      profile["resource_access"] = accessProfile["resource_access"];
    }

    storeTokens({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      id_token: data.id_token,
      expires_at: expiresAt,
      profile,
    });

    startAutoRefresh();
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message || "Login failed" };
  }
}

// --- Token Refresh ---

async function refreshTokens(): Promise<boolean> {
  const tokens = loadTokens();
  if (!tokens?.refresh_token) return false;

  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: tokens.refresh_token,
    });

    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) {
      clearTokens();
      return false;
    }

    const data = await res.json();
    const expiresAt = Math.floor(Date.now() / 1000) + (data.expires_in || 300);

    // Same merge logic: prefer ID token claims but supplement with access token roles
    const idProfile = parseJwt(data.id_token);
    const accessProfile = parseJwt(data.access_token);
    const profile: Record<string, unknown> = { ...idProfile };
    if (!profile["realm_access"] && accessProfile["realm_access"]) {
      profile["realm_access"] = accessProfile["realm_access"];
    }
    if (!profile["resource_access"] && accessProfile["resource_access"]) {
      profile["resource_access"] = accessProfile["resource_access"];
    }

    storeTokens({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      id_token: data.id_token,
      expires_at: expiresAt,
      profile,
    });

    return true;
  } catch {
    clearTokens();
    return false;
  }
}

// --- Public API ---

export interface AuthUser {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  [key: string]: unknown;
}

/** Get the current user profile, or null if not authenticated. Auto-refreshes if expired. */
export async function getUser(): Promise<AuthUser | null> {
  const tokens = loadTokens();
  if (!tokens) return null;

  // Check if expired — try refresh
  const now = Math.floor(Date.now() / 1000);
  if (now >= tokens.expires_at - 30) {
    const refreshed = await refreshTokens();
    if (!refreshed) return null;
    const updated = loadTokens();
    if (!updated) return null;
    startAutoRefresh();
    return updated.profile as AuthUser;
  }

  // Ensure auto-refresh is running (covers page reload)
  if (!refreshTimer) startAutoRefresh();

  return tokens.profile as AuthUser;
}

/** Get the access token, refreshing if needed. */
export async function getAccessToken(): Promise<string | null> {
  const tokens = loadTokens();
  if (!tokens) return null;

  const now = Math.floor(Date.now() / 1000);
  if (now >= tokens.expires_at - 30) {
    const refreshed = await refreshTokens();
    if (!refreshed) return null;
    const updated = loadTokens();
    return updated?.access_token || null;
  }

  return tokens.access_token;
}

/** True if the user has a valid (or refreshable) session. */
export async function isAuthenticated(): Promise<boolean> {
  const user = await getUser();
  return user !== null;
}

/** Logout — clear local tokens and optionally end Keycloak session. */
export async function logout(): Promise<void> {
  stopAutoRefresh();
  const tokens = loadTokens();
  clearTokens();

  // End Keycloak session via backchannel if we have an id_token
  if (tokens?.id_token) {
    try {
      const params = new URLSearchParams({
        id_token_hint: tokens.id_token,
        post_logout_redirect_uri: typeof window !== "undefined" ? window.location.origin : "https://sulcus.ca",
        client_id: CLIENT_ID,
      });
      // Navigate to Keycloak logout — ends session cookie
      window.location.href = `${LOGOUT_ENDPOINT}?${params.toString()}`;
      return;
    } catch {
      // Fallback: just clear local state
    }
  }

  window.location.href = "/";
}

/**
 * PKCE redirect login — fallback for SSO/social.
 * Kept for future use but not the default path.
 */
export async function loginRedirect(): Promise<void> {
  const { UserManager, WebStorageStateStore } = await import("oidc-client-ts");
  const mgr = new UserManager({
    authority: AUTHORITY,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    post_logout_redirect_uri: typeof window !== "undefined" ? window.location.origin : "https://sulcus.ca",
    response_type: "code",
    scope: "openid profile email",
    stateStore: new WebStorageStateStore({ store: window.localStorage }),
    userStore: new WebStorageStateStore({ store: window.localStorage }),
  });
  await mgr.signinRedirect();
}

/** Handle PKCE callback — for /auth/callback page. */
export async function handleCallback(): Promise<AuthUser> {
  const { UserManager, WebStorageStateStore } = await import("oidc-client-ts");
  const mgr = new UserManager({
    authority: AUTHORITY,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid profile email",
    stateStore: new WebStorageStateStore({ store: window.localStorage }),
    userStore: new WebStorageStateStore({ store: window.localStorage }),
  });

  const user = await mgr.signinRedirectCallback();

  // Store in our format too
  const profile = user.profile as Record<string, unknown>;
  storeTokens({
    access_token: user.access_token,
    refresh_token: (user as unknown as Record<string, string>).refresh_token || "",
    id_token: user.id_token || "",
    expires_at: user.expires_at || Math.floor(Date.now() / 1000) + 300,
    profile,
  });

  return profile as AuthUser;
}

/**
 * Keycloak registration via PKCE redirect.
 * Uses oidc-client-ts UserManager so the OIDC state is stored in localStorage
 * before redirecting — fixing "No state in response" on callback.
 */
export async function registerRedirect(): Promise<void> {
  const { UserManager, WebStorageStateStore } = await import("oidc-client-ts");
  const mgr = new UserManager({
    authority: AUTHORITY,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    post_logout_redirect_uri: typeof window !== "undefined" ? window.location.origin : "https://sulcus.ca",
    response_type: "code",
    scope: "openid profile email",
    stateStore: new WebStorageStateStore({ store: window.localStorage }),
    userStore: new WebStorageStateStore({ store: window.localStorage }),
  });
  // Keycloak supports kc_action=register to show registration form instead of login
  await mgr.signinRedirect({ extraQueryParams: { kc_action: "register" } });
}

// --- Background Token Refresh ---

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/** Start a background timer that refreshes the token before it expires. */
export function startAutoRefresh(): void {
  stopAutoRefresh();
  const tokens = loadTokens();
  if (!tokens) return;

  const now = Math.floor(Date.now() / 1000);
  // Refresh 2 minutes before expiry (or immediately if already close)
  const refreshIn = Math.max((tokens.expires_at - now - 120) * 1000, 5000);

  refreshTimer = setTimeout(async () => {
    const ok = await refreshTokens();
    if (ok) {
      startAutoRefresh(); // schedule next refresh
    } else {
      // Refresh failed — session is dead, redirect to login
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    }
  }, refreshIn);
}

/** Stop the background refresh timer. */
export function stopAutoRefresh(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

// --- Helpers ---

/** Decode a JWT payload (no verification — we trust Keycloak). */
function parseJwt(token: string): Record<string, unknown> {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64);
    return JSON.parse(json);
  } catch {
    return {};
  }
}
