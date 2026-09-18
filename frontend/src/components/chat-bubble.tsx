import { Ionicons } from "@react-native-vector-icons/ionicons";
import { Image, Pressable, Text, View } from "react-native";

import { API_URL } from "@/src/lib/api";
import { ks } from "@/src/lib/ks";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Attachment = { id: string; kind: string; name: string; mime: string };

type Props = {
  role: "user" | "assistant";
  text: string;
  attachments?: Attachment[];
  playing?: boolean;
  speakLoading?: boolean;
  onPlay?: () => void;
};

export function ChatBubble({ role, text, attachments, playing, speakLoading, onPlay }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const isUser = role === "user";

  return (
    <View
      testID={isUser ? "chat-bubble-user" : "chat-bubble-assistant"}
      style={[styles.bubble, isUser ? styles.user : styles.assistant]}
    >
      {attachments && attachments.length > 0 ? (
        <View style={styles.attachments}>
          {attachments.map((a) =>
            a.kind === "image" ? (
              <Image key={a.id} style={styles.image} source={{ uri: `${API_URL}/files/attachment/${a.id}` }} />
            ) : (
              <View key={a.id} style={styles.fileChip}>
                <Ionicons name="document-text" size={16} color={isUser ? colors.onBrandPrimary : colors.brandPrimary} />
                <Text style={[styles.fileName, isUser ? styles.userText : styles.assistantText]} numberOfLines={1}>
                  {a.name}
                </Text>
              </View>
            ),
          )}
        </View>
      ) : null}
      {text ? (
        <Text style={[styles.text, isUser ? styles.userText : styles.assistantText]}>{text}</Text>
      ) : null}
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
          <Text style={styles.playText}>{speakLoading ? ks.transcribing : playing ? ks.stopVoice : ks.playVoice}</Text>
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
  user: { alignSelf: "flex-end", backgroundColor: colors.brandPrimary, borderBottomRightRadius: radius.sm },
  assistant: { alignSelf: "flex-start", backgroundColor: colors.surfaceSecondary, borderBottomLeftRadius: radius.sm },
  text: { fontSize: 16, lineHeight: 26, writingDirection: "rtl", textAlign: "right" },
  userText: { color: colors.onBrandPrimary },
  assistantText: { color: colors.onSurfaceSecondary },
  attachments: { gap: spacing.xs, marginBottom: spacing.xs },
  image: { width: 180, height: 180, borderRadius: radius.md },
  fileChip: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingVertical: spacing.xs },
  fileName: { fontSize: 13, flexShrink: 1 },
  playRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm, alignSelf: "flex-end", minHeight: 32 },
  playText: { color: colors.brandPrimary, fontSize: 12, fontWeight: "600", writingDirection: "rtl" },
}));
