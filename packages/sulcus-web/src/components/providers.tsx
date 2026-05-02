"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  loginDirect as authLoginDirect,
  logout as authLogout,
  getUser as authGetUser,
  type LoginResult,
} from "@/lib/auth";

interface AuthUser {
  id: string;
  email: string;
  name?: string;
  roles: string[];
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  loginDirect: (username: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  loginDirect: async () => ({ success: false, error: "Not initialized" }),
  logout: async () => {},
  refresh: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof Error && /API (4\d{2})/.test(error.message)) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
      refetchOnWindowFocus: false,
    },
  },
});

const TIER_ROLES = ["free", "pro", "enterprise", "cortex", "neuron"] as const;

function parseRoles(profile: Record<string, unknown>): string[] {
  try {
    // realm_access is in ID token when the Keycloak "roles" scope mapper has id.token.claim=true.
    // As a fallback, auth.ts also merges access token realm_access into the stored profile.
    const realmAccess = profile["realm_access"] as { roles?: string[] } | undefined;
    const roles = realmAccess?.roles || [];
    return roles.filter((r) => (TIER_ROLES as readonly string[]).includes(r));
  } catch {
    return [];
  }
}

function profileToUser(profile: Record<string, unknown>): AuthUser {
  return {
    id: (profile["sub"] as string) || "",
    email: (profile["email"] as string) || "",
    name:
      (profile["name"] as string) ||
      (profile["preferred_username"] as string) ||
      undefined,
    roles: parseRoles(profile),
  };
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const authUser = await authGetUser();
      if (authUser) {
        setUser(profileToUser(authUser as Record<string, unknown>));
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loginDirectFn = async (username: string, password: string): Promise<LoginResult> => {
    const result = await authLoginDirect(username, password);
    if (result.success) {
      await refresh(); // Update user state after successful login
    }
    return result;
  };

  const logoutFn = async () => {
    setUser(null);
    await authLogout();
  };

  return (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={{ user, loading, loginDirect: loginDirectFn, logout: logoutFn, refresh }}>
        {children}
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}
