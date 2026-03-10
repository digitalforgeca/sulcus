import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Lightweight Edge-compatible auth (no OIDC provider — avoids UnknownAction in Edge).
export default NextAuth(authConfig).auth;

export const config = {
  // Only protect /dashboard routes; never intercept /api/auth/* or static files
  matcher: ["/dashboard/:path*"],
};
