import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@react-native-vector-icons/ionicons";

import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { useT } from "@/src/lib/i18n";

type Props = {
  visible: boolean;
  mode: "explain" | "blocked";
  onRequest: () => void;
  onClose: () => void;
};

export function MicPermissionModal({ visible, mode, onRequest, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="mic" size={22} color={colors.onBrandPrimary} />
          </View>
          <Text style={styles.title}>{t.micPermissionTitle}</Text>
          <Text style={styles.body}>{mode === "blocked" ? t.micBlockedBody : t.micPermissionBody}</Text>
          <Pressable
            testID="mic-permission-allow-btn"
            style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.8 }]}
            onPress={onRequest}
          >
            <Text style={styles.primaryText}>{t.micAllow}</Text>
          </Pressable>
          {mode === "blocked" ? (
            <Pressable
              testID="mic-open-settings-btn"
              style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.8 }]}
              onPress={() => {
                onClose();
                // eslint-disable-next-line no-undef
                require("react-native").Linking.openSettings();
              }}
            >
              <Text style={styles.secondaryText}>{t.openSettings}</Text>
            </Pressable>
          ) : null}
          <Pressable testID="mic-permission-cancel-btn" onPress={onClose} hitSlop={12}>
            <Text style={styles.cancelText}>{t.cancel}</Text>
          </Pressable>
        </View>
      </View>
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
  title: { color: colors.onSurface, fontSize: 18, fontWeight: "700", textAlign: "center", writingDirection: "rtl" },
  primaryBtn: {
    alignSelf: "stretch",
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.lg,
  },
  primaryText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: "700" },
  secondaryBtn: {
    alignSelf: "stretch",
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.md,
  },
  secondaryText: { color: colors.onSurfaceTertiary, fontSize: 14, fontWeight: "600" },
  cancelText: { color: colors.muted, fontSize: 13, marginTop: spacing.lg, fontWeight: "600" },
  body: {
    color: colors.onSurfaceSecondary,
    fontSize: 14,
    lineHeight: 22,
    marginTop: spacing.sm,
    textAlign: "center",
    writingDirection: "rtl",
  },
}));