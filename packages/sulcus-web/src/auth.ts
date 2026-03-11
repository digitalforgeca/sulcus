import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

// ── Env ──────────────────────────────────────────────────────────
const KC_URL = process.env.AUTH_KEYCLOAK_URL || "https://sulcus-keycloak.calmstone-a7a24a97.westus.azurecontainerapps.io";
const KC_REALM = process.env.AUTH_KEYCLOAK_REALM || "sulcus";
const KC_CLIENT_ID = process.env.AUTH_KEYCLOAK_ID || process.env.AUTH_KEYCLOAK_CLIENT_ID || "sulcus-web";
const KC_CLIENT_SECRET = process.env.AUTH_KEYCLOAK_SECRET || process.env.AUTH_KEYCLOAK_CLIENT_SECRET || "";
const KC_ADMIN_USER = process.env.AUTH_KEYCLOAK_ADMIN_USER || "admin";
const KC_ADMIN_PASS = process.env.AUTH_KEYCLOAK_ADMIN_PASS || "";
const AUTH_SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "dev-secret-change-me";

const COOKIE_NAME = "sulcus.session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

const secret = new TextEncoder().encode(AUTH_SECRET);

// ── Types ────────────────────────────────────────────────────────
export interface SulcusSession {
  userId: string;
  email: string;
  name?: string;
  roles: string[];
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

// ── Token endpoint helpers ───────────────────────────────────────
function tokenUrl() {
  return `${KC_URL}/realms/${KC_REALM}/protocol/openid-connect/token`;
}

function adminUrl(path: string) {
  return `${KC_URL}/admin/realms/${KC_REALM}${path}`;
}

async function getAdminToken(): Promise<string> {
  // Admin credentials authenticate against the master realm, not the application realm
  const res = await fetch(`${KC_URL}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: "admin-cli",
      username: KC_ADMIN_USER,
      password: KC_ADMIN_PASS,
      grant_type: "password",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Admin auth failed");
  return data.access_token;
}

// ── Decode Keycloak access token (JWT) ───────────────────────────
function decodeJwt(token: string): any {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return {};
  }
}

// ── Login (Resource Owner Password Grant) ────────────────────────
export async function login(email: string, password: string): Promise<{ ok: true; session: SulcusSession } | { ok: false; error: string }> {
  const res = await fetch(tokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: KC_CLIENT_ID,
      client_secret: KC_CLIENT_SECRET,
      grant_type: "password",
      username: email,
      password: password,
      scope: "openid",
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (data.error === "invalid_grant") return { ok: false, error: "Invalid email or password" };
    return { ok: false, error: data.error_description || "Login failed" };
  }

  const data = await res.json();
  const decoded = decodeJwt(data.access_token);
  const realmRoles = decoded.realm_access?.roles || [];

  const session: SulcusSession = {
    userId: decoded.sub,
    email: decoded.email || email,
    name: decoded.name || decoded.preferred_username,
    roles: realmRoles.filter((r: string) => ["free", "pro", "enterprise"].includes(r)),
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in || 300) * 1000,
  };

  return { ok: true, session };
}

// ── Register ─────────────────────────────────────────────────────
export async function register(email: string, password: string, name?: string): Promise<{ ok: true; session: SulcusSession } | { ok: false; error: string }> {
  try {
    const adminToken = await getAdminToken();

    // Check if user already exists
    const searchRes = await fetch(adminUrl(`/users?email=${encodeURIComponent(email)}&exact=true`), {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const existing = await searchRes.json();
    if (existing.length > 0) {
      return { ok: false, error: "An account with this email already exists" };
    }

    // Create user
    const createRes = await fetch(adminUrl("/users"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        username: email,
        enabled: true,
        emailVerified: true,
        firstName: name?.split(" ")[0] || "",
        lastName: name?.split(" ").slice(1).join(" ") || "",
        credentials: [{ type: "password", value: password, temporary: false }],
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      return { ok: false, error: err.errorMessage || "Registration failed" };
    }

    // Get the new user's ID from Location header
    const location = createRes.headers.get("location") || "";
    const userId = location.split("/").pop() || "";

    // Assign "free" role
    if (userId) {
      // Get free role ID
      const rolesRes = await fetch(adminUrl("/roles/free"), {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (rolesRes.ok) {
        const freeRole = await rolesRes.json();
        await fetch(adminUrl(`/users/${userId}/role-mappings/realm`), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${adminToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify([freeRole]),
        });
      }
    }

    // Auto-login after registration
    return login(email, password);
  } catch (e: any) {
    return { ok: false, error: e.message || "Registration failed" };
  }
}

// ── Session cookie helpers ───────────────────────────────────────
export async function setSessionCookie(session: SulcusSession) {
  const token = await new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function getSession(): Promise<SulcusSession | null> {
  try {
    const jar = await cookies();
    const cookie = jar.get(COOKIE_NAME);
    if (!cookie?.value) return null;

    const { payload } = await jwtVerify(cookie.value, secret);
    const session = payload as unknown as SulcusSession;

    // If access token expired but we have a refresh token, try refreshing
    if (session.expiresAt < Date.now() && session.refreshToken) {
      const refreshed = await refreshSession(session);
      if (refreshed) {
        await setSessionCookie(refreshed);
        return refreshed;
      }
      // Refresh failed — session expired
      await clearSessionCookie();
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

// ── Token refresh ────────────────────────────────────────────────
async function refreshSession(session: SulcusSession): Promise<SulcusSession | null> {
  try {
    const res = await fetch(tokenUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: KC_CLIENT_ID,
        client_secret: KC_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: session.refreshToken,
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const decoded = decodeJwt(data.access_token);
    const realmRoles = decoded.realm_access?.roles || [];

    return {
      userId: decoded.sub,
      email: decoded.email || session.email,
      name: decoded.name || decoded.preferred_username,
      roles: realmRoles.filter((r: string) => ["free", "pro", "enterprise"].includes(r)),
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in || 300) * 1000,
    };
  } catch {
    return null;
  }
}

// ── Logout ───────────────────────────────────────────────────────
export async function logout() {
  const session = await getSession();
  if (session?.refreshToken) {
    // Keycloak backchannel logout
    await fetch(`${KC_URL}/realms/${KC_REALM}/protocol/openid-connect/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: KC_CLIENT_ID,
        client_secret: KC_CLIENT_SECRET,
        refresh_token: session.refreshToken,
      }),
    }).catch(() => {});
  }
  await clearSessionCookie();
}
// deploy Wed Mar 11 13:23:34 PDT 2026
