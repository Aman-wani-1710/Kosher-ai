import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@react-native-vector-icons/ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";

import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { ks } from "@/src/lib/ks";
import {
  apiGet,
  apiPost,
  apiUpload,
  logoSource,
  streamChat,
  type AppConfig,
  type ChatMsg,
  type VoiceModel,
} from "@/src/lib/api";
import { playBase64, stopPlayback } from "@/src/lib/player";
import { storage } from "@/src/utils/storage";
import { LogoHeader } from "@/src/components/logo-header";
import { ChatBubble } from "@/src/components/chat-bubble";
import { TypingDots } from "@/src/components/typing-dots";
import { Toast } from "@/src/components/toast";
import { VoicePicker } from "@/src/components/voice-picker";
import { PasswordModal } from "@/src/components/password-modal";
import { MicPermissionModal } from "@/src/components/mic-permission-modal";

const ACTIVE_VOICE_KEY = "active_voice_model_id";
const AUTOSPEAK_KEY = "autospeak_enabled";
const DEV_TOKEN_KEY = "dev_token";

type ListItem = ChatMsg & { streaming?: boolean };

export default function ChatScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [speakLoadingId, setSpeakLoadingId] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [permVisible, setPermVisible] = useState(false);
  const [permMode, setPermMode] = useState<"explain" | "blocked">("explain");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [activeVoiceId, setActiveVoiceId] = useState<string | null>(null);

  const seededRef = useRef(false);
  const autoSpeakRef = useRef(true);
  const activeVoiceRef = useRef<string | null>(null);
  const sheetRef = useRef<any>(null);

  const showToast = useCallback((msg: string) => setToastMsg(msg), []);

  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: () => apiGet<AppConfig>("/config"),
  });
  const config = configQuery.data;
  const historyQuery = useQuery({ queryKey: ["history"], queryFn: () => apiGet<ChatMsg[]>("/history") });

  useEffect(() => {
    if (historyQuery.data && !seededRef.current) {
      seededRef.current = true;
      setMessages(historyQuery.data);
    }
  }, [historyQuery.data]);

  useEffect(() => {
    storage.getItem(ACTIVE_VOICE_KEY, "").then((id) => {
      if (id) setActiveVoiceId(id);
    });
    storage.getItem(AUTOSPEAK_KEY, true).then((v) => {
      if (v !== null) {
        setAutoSpeak(v);
        autoSpeakRef.current = v;
      }
    });
  }, []);

  const activeVoice = useMemo(() => {
    const voices = config?.voice_models ?? [];
    const wanted = activeVoiceId ?? config?.active_voice_model_id;
    return (
      voices.find((v) => v.id === wanted) ??
      voices.find((v) => v.id === config?.active_voice_model_id) ??
      voices[0] ??
      null
    );
  }, [config, activeVoiceId]);

  useEffect(() => {
    activeVoiceRef.current = activeVoice?.id ?? null;
  }, [activeVoice?.id]);

  // --- recording -----------------------------------------------------------
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder);
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = recState.isRecording
      ? withRepeat(withTiming(1.1, { duration: 550, easing: Easing.inOut(Easing.quad) }), -1, true)
      : withTiming(1, { duration: 200 });
  }, [recState.isRecording, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  async function startRecording() {
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } catch {
      showToast(ks.errorGeneric);
    }
  }

  async function onMicPress() {
    if (recState.isRecording) {
      await stopAndTranscribe();
      return;
    }
    const perm = await AudioModule.getRecordingPermissionsAsync();
    if (perm.granted) {
      await startRecording();
    } else {
      setPermMode(perm.canAskAgain ? "explain" : "blocked");
      setPermVisible(true);
    }
  }

  async function requestMicPermission() {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (perm.granted) {
      setPermVisible(false);
      await startRecording();
    } else if (perm.canAskAgain) {
      setPermVisible(false);
      showToast(ks.micDeniedToast);
    } else {
      setPermMode("blocked");
    }
  }

  async function stopAndTranscribe() {
    if (transcribing) return;
    setTranscribing(true);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri;
      if (!uri) throw new Error("no recording");
      let file: any;
      if (Platform.OS === "web") {
        const blob = await (await fetch(uri)).blob();
        file = { blob, name: "recording.wav" };
      } else {
        file = { uri, name: "recording.m4a", type: "audio/m4a" };
      }
      const res = await apiUpload<{ text: string; provider: string }>("/stt", file);
      const text = (res.text ?? "").trim();
      if (!text) {
        showToast(ks.errorGeneric);
        return;
      }
      await sendMessage(text);
    } catch (e: any) {
      showToast(e?.status === 400 ? ks.keysMissing : ks.errorGeneric);
    } finally {
      setTranscribing(false);
    }
  }

  // --- chat ----------------------------------------------------------------
  const sendMessage = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || sending) return;
      Keyboard.dismiss();
      const now = new Date().toISOString();
      setMessages((m) => [...m, { id: `local-${now}`, role: "user", text: clean, created_at: now }]);
      setInput("");
      setSending(true);
      setStreamingText("");
      try {
        await streamChat(clean, (ev) => {
          if (ev.type === "delta") {
            setStreamingText((s) => (s ?? "") + ev.content);
          } else if (ev.type === "done") {
            const reply: ChatMsg = {
              id: ev.message_id,
              role: "assistant",
              text: ev.reply,
              created_at: new Date().toISOString(),
            };
            setMessages((m) => [...m, reply]);
            setStreamingText(null);
            queryClient.invalidateQueries({ queryKey: ["history"] });
            if (autoSpeakRef.current) void speakText(reply.text, reply.id);
          } else if (ev.type === "error") {
            setStreamingText(null);
            showToast(ev.detail.toLowerCase().includes("key") ? ks.keysMissing : ev.detail.slice(0, 90));
          }
        });
      } catch {
        showToast(ks.noNetwork);
      } finally {
        setSending(false);
        setStreamingText(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sending, queryClient],
  );

  async function speakText(text: string, id: string) {
    stopPlayback();
    setSpeakLoadingId(id);
    try {
      const res = await apiPost<{ mime: string; audio_base64: string; voice_model_id: string }>("/tts", {
        text,
        voice_model_id: activeVoiceRef.current ?? undefined,
      });
      setSpeakLoadingId(null);
      setSpeakingId(id);
      await playBase64(res.audio_base64, res.mime, () =>
        setSpeakingId((cur) => (cur === id ? null : cur)),
      );
    } catch (e: any) {
      showToast(e?.status === 400 ? ks.keysMissing : ks.errorGeneric);
    } finally {
      setSpeakLoadingId((cur) => (cur === id ? null : cur));
    }
  }

  const listData = useMemo<ListItem[]>(() => {
    const arr: ListItem[] = [...messages].map((m) => ({ ...m })).reverse();
    if (streamingText !== null && streamingText.length > 0) {
      arr.unshift({ id: "streaming", role: "assistant", text: streamingText, created_at: "" });
    } else if (sending) {
      arr.unshift({ id: "typing", role: "assistant", text: "", created_at: "", streaming: true });
    }
    return arr;
  }, [messages, streamingText, sending]);

  async function selectVoice(vm: VoiceModel) {
    setActiveVoiceId(vm.id);
    activeVoiceRef.current = vm.id;
    await storage.setItem(ACTIVE_VOICE_KEY, vm.id);
    sheetRef.current?.dismiss();
    queryClient.invalidateQueries({ queryKey: ["config"] });
  }

  async function clearChat() {
    try {
      await apiPost("/chat/clear");
      seededRef.current = true;
      setMessages([]);
      queryClient.invalidateQueries({ queryKey: ["history"] });
      showToast(ks.cleared);
    } catch {
      showToast(ks.noNetwork);
    }
  }

  const logoTs = useMemo(() => {
    void config?.logo_ts;
    return Date.now();
  }, [config?.logo_ts]);
  const logo = useMemo(() => logoSource(config, logoTs), [config, logoTs]);

  const recordingNow = recState.isRecording;

  return (
    <View style={styles.container}>
      <View style={[styles.headerWrap, { paddingTop: insets.top + spacing.sm }]}>
        <LogoHeader source={logo} onEasterEgg={() => setPasswordOpen(true)} onHint={() => showToast(ks.easterHint)} />
      </View>

      {configQuery.isError ? (
        <Pressable testID="config-error-retry" style={styles.errorBanner} onPress={() => configQuery.refetch()}>
          <Ionicons name="cloud-offline-outline" size={14} color={colors.onError} />
          <Text style={styles.errorBannerText}>{ks.errorBanner}</Text>
        </Pressable>
      ) : null}

      <KeyboardAvoidingView behavior="translate-with-padding" style={styles.flex}>
        <FlatList
          testID="chat-list"
          data={listData}
          inverted
          keyExtractor={(item) => item.id}
          renderItem={({ item }) =>
            item.streaming && item.text.length === 0 ? (
              <View style={styles.typingRow}>
                <TypingDots />
              </View>
            ) : (
              <ChatBubble
                role={item.role}
                text={item.text}
                streaming={item.streaming}
                playing={speakingId === item.id}
                speakLoading={speakLoadingId === item.id}
                onPlay={
                  item.role === "assistant" && !item.streaming
                    ? () => {
                        if (speakingId === item.id) {
                          stopPlayback();
                          setSpeakingId(null);
                        } else {
                          void speakText(item.text, item.id);
                        }
                      }
                    : undefined
                }
              />
            )
          }
          contentContainerStyle={styles.listContent}
          style={styles.flex}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Image style={styles.emptyLogo} source={logo} />
              <Text style={styles.emptyTitle}>{ks.startChat}</Text>
              <Text style={styles.emptyHint}>{ks.emptyHint}</Text>
            </View>
          }
        />

        <View style={[styles.dock, { paddingBottom: insets.bottom + spacing.sm }]}>
          {recordingNow ? (
            <View testID="recording-banner" style={styles.recBanner}>
              <Ionicons name="pulse" size={14} color={colors.onBrandPrimary} />
              <Text style={styles.recBannerText}>{ks.tapAgainToStop}</Text>
            </View>
          ) : null}
          {transcribing ? (
            <View testID="transcribing-banner" style={styles.recBanner}>
              <ActivityIndicator size="small" color={colors.onBrandTertiary} />
              <Text style={styles.recBannerTextTrans}>{ks.transcribing}</Text>
            </View>
          ) : null}
          <View style={styles.dockRow}>
            <TextInput
              testID="chat-input"
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder={ks.typeMessage}
              placeholderTextColor={colors.muted}
              multiline
              onSubmitEditing={() => sendMessage(input)}
            />
            <Pressable
              testID="mic-button"
              onPress={onMicPress}
              style={({ pressed }) => [styles.micBtn, pressed && { opacity: 0.85 }]}
            >
              <Animated.View style={[styles.micBtnInner, recState.isRecording ? pulseStyle : null]}>
                <Ionicons name={recordingNow ? "stop" : "mic"} size={22} color={colors.onBrandPrimary} />
              </Animated.View>
            </Pressable>
            {input.trim().length > 0 ? (
              <Pressable
                testID="send-button"
                onPress={() => sendMessage(input)}
                disabled={sending}
                style={({ pressed }) => [styles.sendBtn, sending && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
              >
                <Ionicons name="arrow-up" size={20} color={colors.onBrandPrimary} />
              </Pressable>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>

      <View style={[styles.topRight, { top: insets.top + spacing.xs }]}>
        <Pressable
          testID="clear-chat-button"
          onPress={clearChat}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="trash-outline" size={18} color={colors.muted} />
        </Pressable>
        <Pressable
          testID="voice-picker-button"
          onPress={() => sheetRef.current?.present()}
          style={({ pressed }) => [styles.voiceChip, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="musical-notes" size={16} color={colors.brandPrimary} />
          <Text style={styles.voiceChipText} numberOfLines={1}>
            {activeVoice?.label ?? ks.chooseVoice}
          </Text>
          <Ionicons name="chevron-down" size={14} color={colors.onSurfaceTertiary} />
        </Pressable>
      </View>

      <VoicePicker
        sheetRef={sheetRef}
        voices={config?.voice_models ?? []}
        activeId={activeVoice?.id ?? null}
        onSelect={selectVoice}
        autoSpeak={autoSpeak}
        onToggleAutoSpeak={(v) => {
          setAutoSpeak(v);
          autoSpeakRef.current = v;
          void storage.setItem(AUTOSPEAK_KEY, v);
          if (!v) stopPlayback();
        }}
      />

      <PasswordModal
        visible={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        onSuccess={(token) => {
          setPasswordOpen(false);
          storage.secureSet(DEV_TOKEN_KEY, token).then(() => router.push("/dev"));
        }}
      />

      <MicPermissionModal
        visible={permVisible}
        mode={permMode}
        onRequest={requestMicPermission}
        onClose={() => setPermVisible(false)}
      />

      <Toast message={toastMsg} onDone={() => setToastMsg(null)} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  headerWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  topRight: {
    position: "absolute",
    right: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
  },
  voiceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    height: 40,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary,
    maxWidth: 150,
  },
  voiceChipText: { color: colors.onBrandTertiary, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, flexGrow: 1 },
  typingRow: { alignItems: "flex-start" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 80 },
  emptyLogo: { width: 120, height: 120, borderRadius: radius.lg, marginBottom: spacing.lg },
  emptyTitle: {
    color: colors.onSurface,
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    writingDirection: "rtl",
  },
  emptyHint: {
    color: colors.muted,
    fontSize: 14,
    marginTop: spacing.sm,
    textAlign: "center",
    writingDirection: "rtl",
    paddingHorizontal: spacing.xl,
    lineHeight: 22,
  },
  dock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  dockRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 110,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceTertiary,
    color: colors.onSurface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 15,
    textAlign: "right",
    writingDirection: "rtl",
  },
  micBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  micBtnInner: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtn: {
    width: 44,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  recBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    minHeight: 36,
  },
  recBannerText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: "600", writingDirection: "rtl", textAlign: "right" },
  recBannerTextTrans: { color: colors.brandSecondary, fontSize: 13, writingDirection: "rtl", textAlign: "right" },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.error,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  errorBannerText: { color: colors.onError, fontSize: 13, writingDirection: "rtl", textAlign: "right" },
}));