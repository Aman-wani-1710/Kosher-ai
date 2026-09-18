import { useRef } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { Ionicons } from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";

import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Props = {
  source: number | { uri: string };
  appName: string;
  tagline: string;
  showTagline: boolean;
  position: "left" | "center" | "right";
  onEasterEgg: () => void;
  onHint: () => void;
  onLogoTap: () => void; // single tap opens menu / history
  onMenu: () => void;
};

// Logo tap counter easter egg: >10 taps (11) opens the dev password modal.
// A normal single tap opens the menu/history sheet.
export function LogoHeader({
  source,
  appName,
  tagline,
  showTagline,
  position,
  onEasterEgg,
  onHint,
  onLogoTap,
  onMenu,
}: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const taps = useRef({ count: 0, last: 0 });

  function onLogoPress() {
    const now = Date.now();
    const state = taps.current;
    state.count = now - state.last > 1500 ? 1 : state.count + 1;
    state.last = now;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (state.count === 8) onHint();
    if (state.count >= 11) {
      state.count = 0;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onEasterEgg();
    } else if (state.count === 1) {
      // schedule single-tap menu open only if no rapid follow-up
      setTimeout(() => {
        if (taps.current.count === 1 && Date.now() - taps.current.last >= 260) {
          taps.current.count = 0;
          onLogoTap();
        }
      }, 280);
    }
  }

  const brand = (
    <Pressable
      testID="app-logo-button"
      onPress={onLogoPress}
      style={({ pressed }) => [styles.brandRow, pressed && { opacity: 0.85 }]}
    >
      <Image style={styles.logo} source={source} />
      <View style={styles.nameCol}>
        <Text style={styles.wordmark}>{appName}</Text>
        {showTagline ? <Text style={styles.tagline}>{tagline}</Text> : null}
      </View>
    </Pressable>
  );

  const menuBtn = (
    <Pressable testID="menu-button" onPress={onMenu} style={({ pressed }) => [styles.menuBtn, pressed && { opacity: 0.7 }]}>
      <Ionicons name="menu" size={22} color={colors.onSurface} />
    </Pressable>
  );

  if (position === "center") {
    return (
      <View style={styles.header}>
        {menuBtn}
        <View style={styles.centerBrand}>{brand}</View>
        <View style={styles.spacer} />
      </View>
    );
  }
  if (position === "right") {
    return (
      <View style={styles.header}>
        {menuBtn}
        <View style={styles.flexEnd}>{brand}</View>
      </View>
    );
  }
  return (
    <View style={styles.header}>
      {brand}
      {menuBtn}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  centerBrand: { flex: 1, alignItems: "center" },
  flexEnd: { flex: 1, alignItems: "flex-end" },
  spacer: { width: 40 },
  nameCol: { flexDirection: "column" },
  wordmark: { color: colors.onSurface, fontSize: 18, fontWeight: "800", letterSpacing: 0.3 },
  tagline: { color: colors.muted, fontSize: 11, marginTop: 1, textAlign: "right", writingDirection: "rtl" },
  logo: { width: 44, height: 44, borderRadius: radius.md },
  menuBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
  },
}));
