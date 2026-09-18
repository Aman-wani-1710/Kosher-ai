import { useRef } from "react";
import { Image, Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { ks } from "@/src/lib/ks";

type Props = {
  source: number | { uri: string };
  onEasterEgg: () => void;
  onHint: () => void;
};

// Hidden easter egg: tap the logo — after more than 10 rapid taps (11), the
// developer password modal opens. Counter resets if taps are >2s apart.
export function LogoHeader({ source, onEasterEgg, onHint }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const taps = useRef({ count: 0, last: 0 });

  function onLogoPress() {
    const now = Date.now();
    const state = taps.current;
    state.count = now - state.last > 2000 ? 1 : state.count + 1;
    state.last = now;
    if (state.count === 8) {
      onHint();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    if (state.count >= 11) {
      state.count = 0;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onEasterEgg();
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }

  return (
    <View style={styles.header}>
      <View style={styles.left}>
        <Pressable
          testID="app-logo-button"
          onPress={onLogoPress}
          style={({ pressed }) => [styles.logoPress, pressed && { opacity: 0.8, transform: [{ scale: 0.96 }] }]}
        >
          <Image style={styles.logo} source={source} />
        </Pressable>
        <View style={styles.nameCol}>
          <Text style={styles.wordmark}>{ks.appName}</Text>
          <Text style={styles.tagline}>{ks.tagline}</Text>
        </View>
      </View>
      <View style={styles.deco} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  left: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  nameCol: { flexDirection: "column" },
  wordmark: {
    color: colors.onSurface,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  tagline: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 1,
    textAlign: "right",
    writingDirection: "rtl",
  },
  logoPress: { width: 48, height: 48, borderRadius: radius.md, overflow: "hidden" },
  logo: { width: 48, height: 48, borderRadius: radius.md },
  deco: { width: 48 },
}));