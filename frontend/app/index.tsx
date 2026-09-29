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

import { makeStyles, radius, spacing, useTheme, useThemeMode } from "@/src/theme";
import { useT, useLang } from "@/src/lib/i18n";
import {
  API_URL,
  apiGet,
  apiPost,
  apiUpload,
  logoSource,
  streamChat,
  type AppConfig,
  type AttachmentMeta,
  type ChatMsg,
  type VoiceModel,
} from "@/src/lib/api";
import { playBase64, stopPlayback } from "@/src/lib/player";
import { storage } from "@/src/utils/storage";
import { useAuth } from "@/src/lib/auth";
import { pickAndUploadDocument, pickAndUploadPhoto } from "@/src/lib/attachments";
import { LogoHeader } from "@/src/components/logo-header";
import { ChatBubble } from "@/src/components/chat-bubble";
import { TypingDots } from "@/src/components/typing-dots";
import { Toast } from "@/src/components/toast";
import { VoicePicker } from "@/src/components/voice-picker";
import { PasswordModal } from "@/src/components/password-modal";
import { MicPermissionModal } from "@/src/components/mic-permission-modal";
import { MenuSheet } from "@/src/components/menu-sheet";

const ACTIVE_VOICE_KEY = "active_voice_model_id";
const AUTOSPEAK_KEY = "autospeak_enabled";
const SCRIPT_KEY = "input_script";
const DEV_TOKEN_KEY = "dev_token";

type ListItem = ChatMsg & { streaming?: boolean };
type Script = "perso" | "urdu" | "english";
const SCRIPT_ORDER: Script[] = ["perso", "urdu", "english"];

export default function ChatScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, signInWithGoogle } = useAuth();
  const t = useT();
  const { toggle: toggleLang, lang } = useLang();
  const { mode, toggle: toggleTheme } = useThemeMode();

  const [conversationId, setConversationId] = useState("guest");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [attaching, setAttaching] = useState(false);
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
  const [script, setScript] = useState<Script>("perso");
  const [generatingImage, setGeneratingImage] = useState(false);

  const autoSpeakRef = useRef(true);
  const activeVoiceRef = useRef<string | null>(null);
  const sheetRef = useRef<any>(null);
  const menuRef = useRef<any>(null);

  const showToast = useCallback((msg: string) => setToastMsg(msg), []);

  const configQuery = useQuery({ queryKey: ["config"], queryFn: () => apiGet<AppConfig>("/config") });
  const config = configQuery.data;
  const features = config?.features;

  const historyQuery = useQuery({
    queryKey: ["history", conversationId],
    queryFn: () => apiGet<ChatMsg[]>(`/history?conversation_id=${conversationId}`),
  });

  useEffect(() => {
    if (historyQuery.data) setMessages(historyQuery.data);
  }, [historyQuery.data]);

  useEffect(() => {
    storage.getItem(ACTIVE_VOICE_KEY, "").then((id) => id && setActiveVoiceId(id));
    storage.getItem(AUTOSPEAK_KEY, true).then((v) => {
      if (v !== null) {
        setAutoSpeak(v);
        autoSpeakRef.current = v;
      }
    });
    storage.getItem<Script>(SCRIPT_KEY, "perso").then((v) => v && setScript(v));
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

  // recording
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
      showToast(t.errorGeneric);
    }
  }

  async function onMicPress() {
    if (recState.isRecording) return stopAndTranscribe();
    const perm = await AudioModule.getRecordingPermissionsAsync();
    if (perm.granted) await startRecording();
    else {
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
      showToast(t.micDeniedToast);
    } else setPermMode("blocked");
  }

  async function stopAndTranscribe() {
    if (transcribing) return;
    setTranscribing(true);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri;
      if (!uri) throw new Error("no recording");
      const file: any =
        Platform.OS === "web"
          ? { blob: await (await fetch(uri)).blob(), name: "recording.wav" }
          : { uri, name: "recording.m4a", type: "audio/m4a" };
      const res = await apiUpload<{ text: string }>("/stt", file);
      const text = (res.text ?? "").trim();
      if (!text) return showToast(t.errorGeneric);
      await sendMessage(text);
    } catch (e: any) {
      showToast(e?.status === 400 ? t.keysMissing : t.errorGeneric);
    } finally {
      setTranscribing(false);
    }
  }

  const sendMessage = useCallback(
    async (text: string) => {
      const clean = text.trim();
      const atts = attachments;
      if ((!clean && atts.length === 0) || sending) return;
      Keyboard.dismiss();
      const now = new Date().toISOString();
      setMessages((m) => [
        ...m,
        {
          id: `local-${now}`,
          role: "user",
          text: clean,
          attachments: atts.map((a) => ({ id: a.id, kind: a.kind, name: a.name, mime: a.mime })),
          created_at: now,
        },
      ]);
      setInput("");
      setAttachments([]);
      setSending(true);
      setStreamingText("");
      try {
        await streamChat(
          { text: clean, conversation_id: conversationId, attachment_ids: atts.map((a) => a.id) },
          (ev) => {
            if (ev.type === "delta") setStreamingText((s) => (s ?? "") + ev.content);
            else if (ev.type === "done") {
              const reply: ChatMsg = { id: ev.message_id, role: "assistant", text: ev.reply, created_at: new Date().toISOString() };
              setMessages((m) => [...m, reply]);
              setStreamingText(null);
              queryClient.invalidateQueries({ queryKey: ["history", conversationId] });
              queryClient.invalidateQueries({ queryKey: ["conversations"] });
              if (autoSpeakRef.current) void speakText(reply.text, reply.id);
            } else if (ev.type === "error") {
              setStreamingText(null);
              showToast(ev.detail.toLowerCase().includes("key") ? t.keysMissing : ev.detail.slice(0, 90));
            }
          },
        );
      } catch {
        showToast(t.noNetwork);
      } finally {
        setSending(false);
        setStreamingText(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sending, queryClient, conversationId, attachments],
  );

  async function speakText(text: string, id: string) {
    stopPlayback();
    setSpeakLoadingId(id);
    try {
      const res = await apiPost<{ mime: string; audio_base64: string }>("/tts", {
        text,
        voice_model_id: activeVoiceRef.current ?? undefined,
      });
      setSpeakLoadingId(null);
      setSpeakingId(id);
      await playBase64(res.audio_base64, res.mime, () => setSpeakingId((c) => (c === id ? null : c)));
    } catch (e: any) {
      showToast(e?.status === 400 ? t.keysMissing : t.errorGeneric);
    } finally {
      setSpeakLoadingId((c) => (c === id ? null : c));
    }
  }

  const listData = useMemo<ListItem[]>(() => {
    const arr: ListItem[] = [...messages].map((m) => ({ ...m })).reverse();
    if (streamingText !== null && streamingText.length > 0)
      arr.unshift({ id: "streaming", role: "assistant", text: streamingText, created_at: "" });
    else if (sending) arr.unshift({ id: "typing", role: "assistant", text: "", created_at: "", streaming: true });
    return arr;
  }, [messages, streamingText, sending]);

  async function selectVoice(vm: VoiceModel) {
    setActiveVoiceId(vm.id);
    activeVoiceRef.current = vm.id;
    await storage.setItem(ACTIVE_VOICE_KEY, vm.id);
    sheetRef.current?.dismiss();
  }

  async function clearChat() {
    try {
      await apiPost(`/chat/clear?conversation_id=${conversationId}`);
      setMessages([]);
      queryClient.invalidateQueries({ queryKey: ["history", conversationId] });
      showToast(t.cleared);
    } catch {
      showToast(t.noNetwork);
    }
  }

  async function addPhoto() {
    if (attaching) return;
    setAttaching(true);
    try {
      const a = await pickAndUploadPhoto();
      if (a) setAttachments((p) => [...p, a]);
    } catch (e: any) {
      showToast(e?.message === "permission" ? t.micBlockedBody : t.errorGeneric);
    } finally {
      setAttaching(false);
    }
  }

  async function addDocument() {
    if (attaching) return;
    setAttaching(true);
    try {
      const a = await pickAndUploadDocument();
      if (a) setAttachments((p) => [...p, a]);
    } catch {
      showToast(t.errorGeneric);
    } finally {
      setAttaching(false);
    }
  }

  async function generateImage() {
    const clean = input.trim();
    if (!clean || generatingImage || sending) return;
    Keyboard.dismiss();
    setGeneratingImage(true);
    const now = new Date().toISOString();
    setMessages((m) => [...m, { id: `local-${now}`, role: "user", text: clean, created_at: now }]);
    setInput("");
    try {
      const res = await apiPost<{ message_id: string; attachment: AttachmentMeta }>(
        "/generate-image",
        { prompt: clean, conversation_id: conversationId },
      );
      setMessages((m) => [
        ...m,
        {
          id: res.message_id,
          role: "assistant",
          text: "",
          attachments: [{ id: res.attachment.id, kind: "image", name: res.attachment.name, mime: res.attachment.mime }],
          created_at: new Date().toISOString(),
        },
      ]);
      queryClient.invalidateQueries({ queryKey: ["history", conversationId] });
    } catch (e: any) {
      showToast(e?.detail?.slice(0, 90) || t.errorGeneric);
    } finally {
      setGeneratingImage(false);
    }
  }

  function cycleScript() {
    const next = SCRIPT_ORDER[(SCRIPT_ORDER.indexOf(script) + 1) % SCRIPT_ORDER.length];
    setScript(next);
    void storage.setItem(SCRIPT_KEY, next);
  }

  const logoTs = useMemo(() => {
    void config?.logo_ts;
    return Date.now();
  }, [config?.logo_ts]);
  const logo = useMemo(() => logoSource(config, logoTs), [config, logoTs]);
  const isRtl = script !== "english";
  const recordingNow = recState.isRecording;
  const canSend = input.trim().length > 0 || attachments.length > 0;
  const scriptLabel = (s: Script) =>
    s === "perso" ? t.scriptPerso : s === "urdu" ? t.scriptUrdu : t.scriptEnglish;

  return (
    <View style={styles.container}>
      <View style={[styles.headerWrap, { paddingTop: insets.top + spacing.sm }]}>
        <LogoHeader
          source={logo}
          appName={config?.app_name ?? t.appName}
          tagline={config?.tagline ?? t.tagline}
          showTagline={features?.show_tagline ?? true}
          position={config?.logo_position ?? "left"}
          onEasterEgg={() => setPasswordOpen(true)}
          onHint={() => showToast(t.easterHint)}
          onLogoTap={() => menuRef.current?.present()}
          onMenu={() => menuRef.current?.present()}
        />
        <View style={styles.headerActions}>
          {user ? (
            <Pressable testID="account-chip" onPress={() => menuRef.current?.present()} style={({ pressed }) => [styles.accountChip, pressed && { opacity: 0.85 }]}>
              {user.picture ? (
                <Image style={styles.accountAvatarSm} source={{ uri: user.picture }} />
              ) : (
                <Ionicons name="person-circle" size={20} color={colors.brandPrimary} />
              )}
              <Text style={styles.accountChipText} numberOfLines={1}>{user.name || user.email}</Text>
            </Pressable>
          ) : (
            <Pressable testID="signin-chip" onPress={signInWithGoogle} style={({ pressed }) => [styles.signinChip, pressed && { opacity: 0.85 }]}>
              <Ionicons name="log-in-outline" size={16} color={colors.onBrandPrimary} />
              <Text style={styles.signinChipText} numberOfLines={1}>{t.signIn}</Text>
            </Pressable>
          )}
          <Pressable testID="lang-toggle" onPress={toggleLang} style={({ pressed }) => [styles.actionChip, pressed && { opacity: 0.7 }]}>
            <Ionicons name="language" size={16} color={colors.brandPrimary} />
          </Pressable>
          <Pressable testID="theme-toggle" onPress={toggleTheme} style={({ pressed }) => [styles.actionChip, pressed && { opacity: 0.7 }]}>
            <Ionicons name={mode === "dark" ? "sunny" : "moon"} size={16} color={colors.brandPrimary} />
          </Pressable>
          {features?.voice_mode ? (
            <Pressable testID="voice-mode-button" onPress={() => router.push("/voice")} style={({ pressed }) => [styles.actionChip, pressed && { opacity: 0.8 }]}>
              <Ionicons name="mic-circle" size={18} color={colors.brandPrimary} />
            </Pressable>
          ) : null}
          <Pressable testID="clear-chat-button" onPress={clearChat} style={({ pressed }) => [styles.actionChip, pressed && { opacity: 0.7 }]}>
            <Ionicons name="trash-outline" size={16} color={colors.muted} />
          </Pressable>
          <Pressable testID="voice-picker-button" onPress={() => sheetRef.current?.present()} style={({ pressed }) => [styles.voiceChip, pressed && { opacity: 0.85 }]}>
            <Ionicons name="musical-notes" size={15} color={colors.brandPrimary} />
            <Text style={styles.voiceChipText} numberOfLines={1}>{activeVoice?.label ?? t.chooseVoice}</Text>
          </Pressable>
        </View>
      </View>

      {configQuery.isError ? (
        <Pressable testID="config-error-retry" style={styles.errorBanner} onPress={() => configQuery.refetch()}>
          <Ionicons name="cloud-offline-outline" size={14} color={colors.onError} />
          <Text style={styles.errorBannerText}>{t.errorBanner}</Text>
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
              <View style={styles.typingRow}><TypingDots /></View>
            ) : (
              <ChatBubble
                role={item.role}
                text={item.text}
                attachments={item.attachments}
                playing={speakingId === item.id}
                speakLoading={speakLoadingId === item.id}
                onPlay={
                  item.role === "assistant" && !item.streaming
                    ? () => {
                        if (speakingId === item.id) {
                          stopPlayback();
                          setSpeakingId(null);
                        } else void speakText(item.text, item.id);
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
              <Text style={styles.emptyTitle}>{t.startChat}</Text>
              <Text style={styles.emptyHint}>{t.emptyHint}</Text>
            </View>
          }
        />

        <View style={[styles.dock, { paddingBottom: insets.bottom + spacing.sm }]}>
          {recordingNow ? (
            <View testID="recording-banner" style={styles.recBanner}>
              <Ionicons name="pulse" size={14} color={colors.onBrandPrimary} />
              <Text style={styles.recBannerText}>{t.tapAgainToStop}</Text>
            </View>
          ) : null}
          {transcribing ? (
            <View testID="transcribing-banner" style={styles.recBanner}>
              <ActivityIndicator size="small" color={colors.onBrandPrimary} />
              <Text style={styles.recBannerText}>{t.transcribing}</Text>
            </View>
          ) : null}
          {generatingImage ? (
            <View testID="image-generating-banner" style={styles.recBanner}>
              <ActivityIndicator size="small" color={colors.onBrandPrimary} />
              <Text style={styles.recBannerText}>{t.imageGenerating}</Text>
            </View>
          ) : null}

          {attachments.length > 0 ? (
            <View style={styles.attachRow}>
              {attachments.map((a) => (
                <View key={a.id} testID={`attachment-chip-${a.id}`} style={styles.attachChip}>
                  {a.kind === "image" ? (
                    <Image style={styles.attachThumb} source={{ uri: `${API_URL}${a.url.replace(API_URL, "")}` }} />
                  ) : (
                    <Ionicons name="document-text" size={18} color={colors.brandPrimary} />
                  )}
                  <Text style={styles.attachName} numberOfLines={1}>{a.name}</Text>
                  <Pressable testID={`attachment-remove-${a.id}`} onPress={() => setAttachments((p) => p.filter((x) => x.id !== a.id))} hitSlop={8}>
                    <Ionicons name="close-circle" size={16} color={colors.muted} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.dockRow}>
            {features?.attachments ? (
              <Pressable testID="attach-photo-button" onPress={addPhoto} disabled={attaching} style={({ pressed }) => [styles.toolBtn, pressed && { opacity: 0.7 }]}>
                <Ionicons name={attaching ? "hourglass-outline" : "image-outline"} size={20} color={colors.muted} />
              </Pressable>
            ) : null}
            {features?.attachments ? (
              <Pressable testID="attach-doc-button" onPress={addDocument} disabled={attaching} style={({ pressed }) => [styles.toolBtn, pressed && { opacity: 0.7 }]}>
                <Ionicons name="document-attach-outline" size={20} color={colors.muted} />
              </Pressable>
            ) : null}
            <Pressable
              testID="generate-image-button"
              onPress={generateImage}
              disabled={generatingImage || !input.trim()}
              style={({ pressed }) => [styles.toolBtn, pressed && { opacity: 0.7 }]}
            >
              <Ionicons
                name={generatingImage ? "hourglass-outline" : "sparkles-outline"}
                size={20}
                color={input.trim() ? colors.brandPrimary : colors.muted}
              />
            </Pressable>
            <TextInput
              testID="chat-input"
              style={[styles.input, { textAlign: isRtl ? "right" : "left", writingDirection: isRtl ? "rtl" : "ltr" }]}
              value={input}
              onChangeText={setInput}
              placeholder={isRtl ? t.typeMessage : "Type a message…"}
              placeholderTextColor={colors.muted}
              multiline
              onSubmitEditing={() => sendMessage(input)}
            />
            {canSend && !sending ? (
              <Pressable testID="send-button" onPress={() => sendMessage(input)} style={({ pressed }) => [styles.sendBtn, pressed && { opacity: 0.85 }]}>
                <Ionicons name="arrow-up" size={20} color={colors.onBrandPrimary} />
              </Pressable>
            ) : sending ? (
              <View testID="sending-indicator" style={styles.sendBtn}><ActivityIndicator size="small" color={colors.onBrandPrimary} /></View>
            ) : (
              <Pressable testID="mic-button" onPress={onMicPress} style={({ pressed }) => [styles.micBtn, pressed && { opacity: 0.85 }]}>
                <Animated.View style={[styles.micBtnInner, recState.isRecording ? pulseStyle : null]}>
                  <Ionicons name={recordingNow ? "stop" : "mic"} size={22} color={colors.onBrandPrimary} />
                </Animated.View>
              </Pressable>
            )}
          </View>

          {features?.input_switcher ? (
            <Pressable testID="script-switch-button" onPress={cycleScript} style={styles.scriptSwitch}>
              <Ionicons name="language-outline" size={13} color={colors.muted} />
              <Text style={styles.scriptSwitchText}>{t.inputScript}: {scriptLabel(script)}</Text>
            </Pressable>
          ) : null}
        </View>
      </KeyboardAvoidingView>

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

      <MenuSheet
        ref={menuRef}
        activeConversationId={conversationId}
        onSelectConversation={(id) => {
          setConversationId(id);
          menuRef.current?.dismiss();
        }}
        onNewChat={(id) => {
          setConversationId(id);
          setMessages([]);
          menuRef.current?.dismiss();
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

      <MicPermissionModal visible={permVisible} mode={permMode} onRequest={requestMicPermission} onClose={() => setPermVisible(false)} />
      <Toast message={toastMsg} onDone={() => setToastMsg(null)} style={{ top: insets.top + 60 }} />
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
    gap: spacing.sm,
  },
  headerActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", gap: spacing.sm },
  accountChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    height: 36,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    maxWidth: 150,
  },
  accountChipText: { color: colors.onSurface, fontSize: 12, fontWeight: "700", flexShrink: 1 },
  accountAvatarSm: { width: 22, height: 22, borderRadius: radius.pill },
  signinChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    maxWidth: 170,
  },
  signinChipText: { color: colors.onBrandPrimary, fontSize: 12, fontWeight: "700", flexShrink: 1 },
  actionChip: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
  },
  voiceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary,
    maxWidth: 160,
  },
  voiceChipText: { color: colors.onBrandTertiary, fontSize: 12, fontWeight: "600", flexShrink: 1 },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, flexGrow: 1 },
  typingRow: { alignItems: "flex-start" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 80 },
  emptyLogo: { width: 120, height: 120, borderRadius: radius.lg, marginBottom: spacing.lg },
  emptyTitle: { color: colors.onSurface, fontSize: 20, fontWeight: "700", textAlign: "center", writingDirection: "rtl" },
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
  toolBtn: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
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
  },
  micBtn: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  micBtnInner: { width: 48, height: 48, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  sendBtn: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  attachRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  attachChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    maxWidth: 180,
  },
  attachThumb: { width: 28, height: 28, borderRadius: radius.sm },
  attachName: { color: colors.onSurfaceSecondary, fontSize: 12, flexShrink: 1 },
  scriptSwitch: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, marginTop: spacing.sm },
  scriptSwitchText: { color: colors.muted, fontSize: 12, fontWeight: "600" },
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
