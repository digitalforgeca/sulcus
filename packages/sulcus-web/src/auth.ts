import NextAuth from "next-auth";
import Keycloak from "next-auth/providers/keycloak";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  providers: [
    Keycloak({
      clientId: process.env.AUTH_KEYCLOAK_ID || process.env.KEYCLOAK_CLIENT_ID,
      clientSecret: process.env.AUTH_KEYCLOAK_SECRET || process.env.KEYCLOAK_CLIENT_SECRET,
      issuer: process.env.AUTH_KEYCLOAK_ISSUER || process.env.KEYCLOAK_ISSUER,
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        token.idToken = account.id_token;
        token.refreshToken = account.refresh_token;
      }
      return token;
    },
    async session({ session, token }: any) {
      session.accessToken = token.accessToken;
      session.idToken = token.idToken;
      return session;
    },
  },
});
