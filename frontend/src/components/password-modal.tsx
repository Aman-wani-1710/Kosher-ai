import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@react-native-vector-icons/ionicons";

import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { ks } from "@/src/lib/ks";
import { apiPost } from "@/src/lib/api";

type Props = {
  visible: boolean;
  onClose: () => void;
  onSuccess: (token: string) => void;
};

export function PasswordModal({ visible, onClose, onSuccess }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!password.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ ok: boolean; token: string }>("/dev/unlock", {
        password: password.trim(),
      });
      setPassword("");
      onSuccess(res.token);
    } catch {
      setError(ks.wrongPassword);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.backdrop}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="lock-closed" size={22} color={colors.onBrandPrimary} />
          </View>
          <Text style={styles.title}>{ks.passwordTitle}</Text>
          <Text style={styles.subtitle}>{ks.passwordSubtitle}</Text>
          <TextInput
            testID="dev-password-input"
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            keyboardType="number-pad"
            placeholder={ks.passwordPlaceholder}
            placeholderTextColor={colors.muted}
            onSubmitEditing={submit}
            autoFocus
          />
          {error ? (
            <Text testID="dev-password-error" style={styles.error}>
              {error}
            </Text>
          ) : null}
          <View style={styles.buttons}>
            <Pressable testID="dev-password-cancel-btn" style={styles.secondaryBtn} onPress={onClose}>
              <Text style={styles.secondaryText}>{ks.cancel}</Text>
            </Pressable>
            <Pressable
              testID="dev-password-submit-btn"
              style={({ pressed }) => [styles.primaryBtn, busy && { opacity: 0.6 }, pressed && { opacity: 0.8 }]}
              onPress={submit}
            >
              <Text style={styles.primaryText}>{busy ? ks.saving : ks.unlock}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(26,23,21,0.5)", alignItems: "center", justifyContent: "center" },
  card: {
    width: "84%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: {
    color: colors.onSurface,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
    writingDirection: "rtl",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    textAlign: "center",
    writingDirection: "rtl",
  },
  input: {
    width: "100%",
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceTertiary,
    color: colors.onSurface,
    textAlign: "center",
    fontSize: 18,
    letterSpacing: 4,
  },
  error: { color: colors.error, fontSize: 12, marginTop: spacing.sm, textAlign: "center", writingDirection: "rtl" },
  buttons: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg, alignSelf: "stretch" },
  secondaryBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { color: colors.onSurfaceTertiary, fontSize: 14, fontWeight: "600" },
  primaryBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: "700" },
}));