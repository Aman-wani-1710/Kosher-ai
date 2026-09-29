import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { Alert, LogBox, Linking, Platform, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { Ionicons } from "@react-native-vector-icons/ionicons";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { AuthProvider, useAuth } from "@/src/lib/auth";
import { LanguageProvider } from "@/src/lib/i18n";
import { ThemeProvider } from "@/src/theme";
import { API_URL } from "@/src/lib/api";
import { storage } from "@/src/utils/storage";

// Disable logbox errors etc so that users can see the app
// and agent works as expected.
LogBox.ignoreAllLogs(true);

// --- Push notifications: module-scope config (before any component) ---
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}
if (Platform.OS === "android") {
  Notifications.setNotificationChannelAsync("default", {
    name: "Default",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
  });
}

const PUSH_GUEST_KEY = "push_guest_id";
const PUSH_NUDGE_KEY = "pushNudgeAt";

async function registerForPush(userId: string) {
  if (Platform.OS === "web" || !Device.isDevice) return;
  const perm = await Notifications.requestPermissionsAsync();
  if (perm.status !== "granted") {
    if (!perm.canAskAgain) await maybeNudge();
    return;
  }
  try {
    const tokenResp = await Notifications.getDevicePushTokenAsync();
    await fetch(`${API_URL}/register-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, platform: Platform.OS, device_token: tokenResp.data }),
    });
  } catch {
    // non-blocking: push registration failure must not break the app
  }
}

async function maybeNudge() {
  const last = await storage.getItem<number>(PUSH_NUDGE_KEY, 0);
  const week = 7 * 24 * 60 * 60 * 1000;
  if (last && Date.now() - Number(last) <= week) return;
  await storage.setItem(PUSH_NUDGE_KEY, Date.now());
  Alert.alert(
    "Notifications off",
    "Turn on notifications to get your daily Kashmiri chat reminder.",
    [
      { text: "Later", style: "cancel" },
      { text: "Open Settings", onPress: () => Linking.openSettings() },
    ],
  );
}

// Render one icon glyph at mount so the vector-icon font is prewarmed before
// any screen needs it (fixes icons not loading on Android Expo Go).
function IconPrewarm() {
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }}
    >
      <Ionicons name="mic" size={12} />
    </View>
  );
}

function PushGate() {
  const router = useRouter();
  const { user } = useAuth();

  // Register on app open (and whenever the signed-in user changes).
  useEffect(() => {
    if (Platform.OS === "web") return;
    (async () => {
      let id = user?.user_id;
      if (!id) {
        id = (await storage.getItem<string>(PUSH_GUEST_KEY, "")) || "";
        if (!id) {
          id = `guest_${Math.random().toString(36).slice(2, 14)}`;
          await storage.setItem(PUSH_GUEST_KEY, id);
        }
      }
      await registerForPush(id);
    })();
  }, [user?.user_id]);

  // Notification tap handlers (warm + cold start).
  useEffect(() => {
    if (Platform.OS === "web") return;
    const tapSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = (response.notification.request.content.data || {}) as Record<string, string>;
      const url = data.deeplink || data.action_url;
      if (!url) return;
      url.startsWith("http") ? Linking.openURL(url) : router.push(url as any);
    });
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = (response.notification.request.content.data || {}) as Record<string, string>;
      const url = data.deeplink || data.action_url;
      if (url) (url.startsWith("http") ? Linking.openURL(url) : router.push(url as any));
    });
    return () => tapSub.remove();
  }, [router]);

  return null;
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <LanguageProvider>
              <AuthProvider>
                <KeyboardProvider>
                  <BottomSheetModalProvider>
                    <PushGate />
                    <Stack screenOptions={{ headerShown: false }}>
                      <Stack.Screen name="index" />
                      <Stack.Screen name="voice" options={{ presentation: "fullScreenModal", animation: "fade" }} />
                      <Stack.Screen name="dev" options={{ presentation: "modal" }} />
                    </Stack>
                    <IconPrewarm />
                  </BottomSheetModalProvider>
                </KeyboardProvider>
              </AuthProvider>
            </LanguageProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
