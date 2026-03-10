import type { NextAuthConfig } from "next-auth";

// Lightweight auth config for Edge middleware (no OIDC provider).
// The full Keycloak provider lives in auth.ts (Node.js runtime only).
export const authConfig: NextAuthConfig = {
  trustHost: true,
  providers: [],
  pages: {
    signIn: "/api/auth/signin",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnDashboard = nextUrl.pathname.startsWith("/dashboard");
      if (isOnDashboard) {
        return isLoggedIn;
      }
      return true;
    },
  },
};
