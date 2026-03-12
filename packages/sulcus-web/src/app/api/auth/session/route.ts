import { NextResponse } from "next/server";
import { getSession } from "@/auth";

/**
 * GET /api/auth/session
 *
 * Returns the current session including the Keycloak access token.
 * Used by the dashboard to authenticate API calls to the Sulcus server.
 */
export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    userId: session.userId,
    email: session.email,
    name: session.name,
    roles: session.roles,
    accessToken: session.accessToken,
    expiresAt: session.expiresAt,
  });
}
