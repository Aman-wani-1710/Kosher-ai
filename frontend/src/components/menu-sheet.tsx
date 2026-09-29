import { forwardRef } from "react";
import { ActivityIndicator, FlatList, Image, Platform, Pressable, Text, View } from "react-native";
import { Ionicons } from "@react-native-vector-icons/ionicons";
import * as AppleAuthentication from "expo-apple-authentication";
import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import type { BottomSheetModal as BSM } from "@gorhom/bottom-sheet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { makeStyles, radius, spacing, useTheme, useThemeMode } from "@/src/theme";
import { useT, useLang } from "@/src/lib/i18n";
import { apiDelete, apiGet, apiPost, type Conversation } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";

type Props = {
  activeConversationId: string;
  onSelectConversation: (id: string) => void;
  onNewChat: (id: string) => void;
};

export const MenuSheet = forwardRef<BSM, Props>(function MenuSheet(
  { activeConversationId, onSelectConversation, onNewChat },
  ref,
) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { toggle: toggleLang, lang } = useLang();
  const { mode, toggle: toggleTheme } = useThemeMode();
  const { user, loading, signInWithGoogle, signInWithApple, signOut } = useAuth();
  const queryClient = useQueryClient();

  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: () => apiGet<Conversation[]>("/conversations"),
    enabled: !!user,
  });

  const newChat = useMutation({
    mutationFn: () => apiPost<Conversation>("/conversations"),
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      onNewChat(c.id);
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/conversations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["conversations"] }),
  });

  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={["70%", "90%"]}
      backgroundStyle={styles.bg}
      handleIndicatorStyle={styles.handle}
      enableDynamicSizing={false}
    >
      <BottomSheetView style={styles.container}>
        {/* account */}
        <View style={styles.account}>
          {user ? (
            <>
              {user.picture ? (
                <Image testID="account-avatar" style={styles.avatar} source={{ uri: user.picture }} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Ionicons name="person" size={20} color={colors.onBrandPrimary} />
                </View>
              )}
              <View style={styles.accountText}>
                <Text style={styles.accountName} numberOfLines={1}>{user.name || user.email}</Text>
                <Text style={styles.accountEmail} numberOfLines={1}>{user.email}</Text>
              </View>
              <Pressable testID="sign-out-btn" onPress={signOut} hitSlop={8} style={styles.signOutBtn}>
                <Ionicons name="log-out-outline" size={20} color={colors.error} />
              </Pressable>
            </>
          ) : (
            <View style={styles.guestBox}>
              <Text style={styles.guestTitle}>{t.guest}</Text>
              <Text style={styles.guestSub}>{t.signInForHistory}</Text>
              <Pressable
                testID="sign-in-btn"
                onPress={signInWithGoogle}
                style={({ pressed }) => [styles.googleBtn, pressed && { opacity: 0.85 }]}
              >
                {loading ? (
                  <ActivityIndicator size="small" color={colors.onSurface} />
                ) : (
                  <Ionicons name="logo-google" size={18} color={colors.brandPrimary} />
                )}
                <Text style={styles.googleText}>{t.signIn}</Text>
              </Pressable>
              {Platform.OS === "ios" ? (
                <Pressable
                  testID="apple-sign-in-btn"
                  onPress={signInWithApple}
                  style={({ pressed }) => [styles.appleBtn, pressed && { opacity: 0.85 }]}
                >
                  <Ionicons name="logo-apple" size={18} color={colors.onSurface} />
                  <Text style={styles.googleText}>{t.signInApple}</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>

        {/* language + theme quick toggles */}
        <View style={styles.settingsRow}>
          <Pressable testID="menu-lang-toggle" onPress={toggleLang} style={({ pressed }) => [styles.settingBtn, pressed && { opacity: 0.8 }]}>
            <Ionicons name="language" size={16} color={colors.brandPrimary} />
            <Text style={styles.settingText}>{lang === "en" ? "کٲشُر" : "English"}</Text>
          </Pressable>
          <Pressable testID="menu-theme-toggle" onPress={toggleTheme} style={({ pressed }) => [styles.settingBtn, pressed && { opacity: 0.8 }]}>
            <Ionicons name={mode === "dark" ? "sunny" : "moon"} size={16} color={colors.brandPrimary} />
            <Text style={styles.settingText}>{mode === "dark" ? t.lightMode : t.darkMode}</Text>
          </Pressable>
        </View>

        {/* new chat */}
        <Pressable
          testID="new-chat-btn"
          onPress={() => (user ? newChat.mutate() : onNewChat("guest"))}
          style={({ pressed }) => [styles.newChat, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="add" size={20} color={colors.onBrandPrimary} />
          <Text style={styles.newChatText}>{t.newChat}</Text>
        </Pressable>

        <Text style={styles.historyLabel}>{t.historyTitle}</Text>

        {user ? (
          <FlatList
            data={conversations.data ?? []}
            keyExtractor={(c) => c.id}
            renderItem={({ item }) => {
              const active = item.id === activeConversationId;
              return (
                <View style={[styles.convRow, active && styles.convRowActive]}>
                  <Pressable
                    testID={`conversation-${item.id}`}
                    style={styles.convMain}
                    onPress={() => onSelectConversation(item.id)}
                  >
                    <Ionicons name="chatbubble-ellipses-outline" size={18} color={active ? colors.brandPrimary : colors.muted} />
                    <Text style={[styles.convTitle, active && { color: colors.brandPrimary }]} numberOfLines={1}>
                      {item.title}
                    </Text>
                  </Pressable>
                  <Pressable testID={`delete-conversation-${item.id}`} onPress={() => del.mutate(item.id)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={16} color={colors.muted} />
                  </Pressable>
                </View>
              );
            }}
            ListEmptyComponent={<Text style={styles.empty}>{t.noHistory}</Text>}
            showsVerticalScrollIndicator={false}
          />
        ) : (
          <Text style={styles.empty}>{t.signInForHistory}</Text>
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
});

const useStyles = makeStyles((colors) => ({
  bg: { backgroundColor: colors.surface },
  handle: { backgroundColor: colors.border },
  container: { flex: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  account: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  avatar: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary },
  avatarFallback: { alignItems: "center", justifyContent: "center", backgroundColor: colors.brandPrimary },
  accountText: { flex: 1 },
  accountName: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  accountEmail: { color: colors.muted, fontSize: 12, marginTop: 1 },
  signOutBtn: { padding: spacing.xs },
  guestBox: { flex: 1, gap: spacing.sm },
  guestTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "700", writingDirection: "rtl", textAlign: "right" },
  guestSub: { color: colors.muted, fontSize: 12, writingDirection: "rtl", textAlign: "right" },
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    marginTop: spacing.xs,
  },
  googleText: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  appleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    marginTop: spacing.sm,
  },
  settingsRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  settingBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    minHeight: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary,
  },
  settingText: { color: colors.onBrandTertiary, fontSize: 12, fontWeight: "700" },
  newChat: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
    marginTop: spacing.lg,
  },
  newChatText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "700", writingDirection: "rtl" },
  historyLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    writingDirection: "rtl",
    textAlign: "right",
  },
  convRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    minHeight: 48,
  },
  convRowActive: { backgroundColor: colors.brandTertiary },
  convMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  convTitle: { flex: 1, color: colors.onSurface, fontSize: 14, writingDirection: "rtl", textAlign: "right" },
  empty: { color: colors.muted, fontSize: 13, textAlign: "center", marginTop: spacing.xl, writingDirection: "rtl" },
}));
