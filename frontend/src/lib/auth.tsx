import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import * as AppleAuthentication from "expo-apple-authentication";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { apiGet, apiPost, setAuthToken, type AuthUser } from "@/src/lib/api";
import { storage } from "@/src/utils/storage";

WebBrowser.maybeCompleteAuthSession();

const TOKEN_KEY = "kosher_session_token";

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  signInWithGoogle: async () => {},
  signInWithApple: async () => {},
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

async function persistToken(token: string) {
  setAuthToken(token);
  if (Platform.OS === "web") {
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {}
  } else {
    await storage.secureSet(TOKEN_KEY, token);
  }
}

async function loadToken(): Promise<string> {
  if (Platform.OS === "web") {
    try {
      return window.localStorage.getItem(TOKEN_KEY) ?? "";
    } catch {
      return "";
    }
  }
  return (await storage.secureGet(TOKEN_KEY, "")) ?? "";
}

async function clearToken() {
  setAuthToken(null);
  if (Platform.OS === "web") {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {}
  } else {
    await storage.secureRemove(TOKEN_KEY);
  }
}

function extractSessionId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const processed = useRef<Set<string>>(new Set());

  const exchange = useCallback(async (sessionId: string) => {
    if (processed.current.has(sessionId)) return;
    processed.current.add(sessionId);
    try {
      const res = await apiPost<{ session_token: string; user: AuthUser }>("/auth/session", {
        session_id: sessionId,
      });
      await persistToken(res.session_token);
      setUser(res.user);
    } catch {
      // stay guest
    }
  }, []);

  // check existing session / handle web callback on mount
  useEffect(() => {
    (async () => {
      if (Platform.OS === "web") {
        const sid = extractSessionId(window.location.hash) || extractSessionId(window.location.search);
        if (sid) {
          await exchange(sid);
          try {
            window.history.replaceState(
              window.history.state,
              "",
              window.location.pathname,
            );
          } catch {}
          setLoading(false);
          return;
        }
      } else {
        const initial = await Linking.getInitialURL();
        const sid = extractSessionId(initial);
        if (sid) await exchange(sid);
      }
      const token = await loadToken();
      if (token) {
        setAuthToken(token);
        try {
          const me = await apiGet<AuthUser>("/auth/me");
          setUser(me);
        } catch {
          await clearToken();
        }
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // hot deep links on native
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = Linking.addEventListener("url", ({ url }) => {
      const sid = extractSessionId(url);
      if (sid) void exchange(sid);
    });
    return () => sub.remove();
  }, [exchange]);

  const signInWithGoogle = useCallback(async () => {
    const redirectUrl =
      Platform.OS === "web" ? window.location.origin + "/" : Linking.createURL("");
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
    if (Platform.OS === "web") {
      window.location.href = authUrl;
      return;
    }
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    let url: string | null = null;
    if (result.type === "success" && result.url) url = result.url;
    if (!url) url = await Linking.getInitialURL();
    const sid = extractSessionId(url);
    if (sid) await exchange(sid);
  }, [exchange]);

  const signOut = useCallback(async () => {
    try {
      await apiPost("/auth/logout");
    } catch {}
    await clearToken();
    setUser(null);
  }, []);

  const signInWithApple = useCallback(async () => {
    try {
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!cred.identityToken) return;
      const name = cred.fullName
        ? [cred.fullName.givenName, cred.fullName.familyName].filter(Boolean).join(" ")
        : undefined;
      const res = await apiPost<{ session_token: string; user: AuthUser }>("/auth/apple", {
        identity_token: cred.identityToken,
        name: name || undefined,
        email: cred.email || undefined,
      });
      await persistToken(res.session_token);
      setUser(res.user);
    } catch (e: any) {
      if (e?.code === "ERR_REQUEST_CANCELED") return; // user cancelled — stay guest
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, signInWithApple, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
