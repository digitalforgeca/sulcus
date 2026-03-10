import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Simple middleware: redirect unauthenticated users on /dashboard/* to sign-in.
// We check for the session cookie. If missing, redirect to signin page.
// This bypasses next-auth v5 Edge runtime OIDC issues entirely.
export function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get("__Secure-authjs.session-token")
    || request.cookies.get("authjs.session-token")
    || request.cookies.get("next-auth.session-token");

  if (!sessionCookie) {
    // Redirect to our custom login page with the dashboard as callback
    const signInUrl = new URL("/login", request.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", request.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
