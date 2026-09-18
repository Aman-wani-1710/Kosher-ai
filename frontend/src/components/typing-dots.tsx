import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

function Dot({ delay, color }: { delay: number; color: string }) {
  const opacity = useSharedValue(0.3);
  const styles = makeStyles(() => ({
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color },
  }))();

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 300, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.3, { duration: 300, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [opacity]);

  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.dot, animated]} />;
}

export function TypingDots() {
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <View testID="typing-dots" style={styles.row}>
      <Dot delay={0} color={colors.brandPrimary} />
      <Dot delay={150} color={colors.brandPrimary} />
      <Dot delay={300} color={colors.brandPrimary} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    marginVertical: spacing.xs,
  },
}));