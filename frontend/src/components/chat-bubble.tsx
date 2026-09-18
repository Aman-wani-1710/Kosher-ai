import { Ionicons } from "@react-native-vector-icons/ionicons";
import { Pressable, Text, View } from "react-native";

import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { ks } from "@/src/lib/ks";

type Props = {
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  playing?: boolean;
  speakLoading?: boolean;
  onPlay?: () => void;
};

export function ChatBubble({ role, text, streaming, playing, speakLoading, onPlay }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const isUser = role === "user";

  return (
    <View
      testID={isUser ? "chat-bubble-user" : "chat-bubble-assistant"}
      style={[styles.bubble, isUser ? styles.user : styles.assistant]}
    >
      <Text style={[styles.text, isUser ? styles.userText : styles.assistantText]}>{text}</Text>
      {!isUser && onPlay ? (
        <Pressable
          testID="chat-play-button"
          onPress={onPlay}
          disabled={speakLoading}
          style={({ pressed }) => [styles.playRow, pressed && { opacity: 0.7 }]}
        >
          <Ionicons
            name={speakLoading ? "hourglass-outline" : playing ? "pause-outline" : "volume-high-outline"}
            size={16}
            color={colors.brandPrimary}
          />
          <Text style={styles.playText}>
            {speakLoading ? ks.transcribing : playing ? ks.stopVoice : ks.playVoice}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  bubble: {
    maxWidth: "84%",
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginVertical: spacing.xs,
  },
  user: {
    alignSelf: "flex-end",
    backgroundColor: colors.brandPrimary,
    borderBottomRightRadius: radius.sm,
  },
  assistant: {
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceSecondary,
    borderBottomLeftRadius: radius.sm,
  },
  text: {
    fontSize: 16,
    lineHeight: 26,
    writingDirection: "rtl",
    textAlign: "right",
  },
  userText: { color: colors.onBrandPrimary },
  assistantText: { color: colors.onSurfaceSecondary },
  playRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
    alignSelf: "flex-end",
    minHeight: 32,
  },
  playText: { color: colors.brandPrimary, fontSize: 12, fontWeight: "600", writingDirection: "rtl" },
}));