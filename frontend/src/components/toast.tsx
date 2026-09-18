import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, { FadeInDown, FadeOutUp } from "react-native-reanimated";
import type { StyleProp, ViewStyle } from "react-native";

import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Props = { message: string | null; onDone?: () => void; style?: StyleProp<ViewStyle> };

export function Toast({ message, onDone, style }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => onDone?.(), 3000);
    return () => clearTimeout(t);
  }, [message, onDone]);

  if (!message) return null;

  return (
    <Animated.View
      testID="toast"
      entering={FadeInDown.duration(220)}
      exiting={FadeOutUp.duration(180)}
      style={[styles.wrap, style]}
      pointerEvents="none"
    >
      <View style={styles.toast}>
        <Text style={styles.text} numberOfLines={3}>
          {message}
        </Text>
      </View>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  toast: {
    backgroundColor: colors.surfaceInverse,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    maxWidth: "88%",
  },
  text: {
    color: colors.onSurfaceInverse,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    writingDirection: "rtl" as const,
  },
}));