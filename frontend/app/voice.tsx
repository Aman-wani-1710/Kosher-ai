import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Platform, Pressable, Text, View } from "react-native";
import { Ionicons } from "@react-native-vector-icons/ionicons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";

import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { useT } from "@/src/lib/i18n";
import { API_URL, apiGet, apiPost, apiUpload, streamChat, type AppConfig, type VoiceModel } from "@/src/lib/api";
import { playBase64, stopPlayback } from "@/src/lib/player";
import { storage } from "@/src/utils/storage";
import { Toast } from "@/src/components/toast";
import { MicPermissionModal } from "@/src/components/mic-permission-modal";

const ACTIVE_VOICE_KEY = "active_voice_model_id";
const HANDS_FREE_KEY = "voice_hands_free";
type Phase = "idle" | "listening" | "processing" | "speaking";

export default function VoiceScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();

  const [phase, setPhase] = useState<Phase>("idle");
  const [lastUser, setLastUser] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [permVisible, setPermVisible] = useState(false);
  const [permMode, setPermMode] = useState<"explain" | "blocked">("explain");
  const [activeVoiceId, setActiveVoiceId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [mode, setMode] = useState<"assistant" | "sts">("assistant");
  const handsFreeRef = useRef(false);

  const config = useQuery({ queryKey: ["config"], queryFn: () => apiGet<AppConfig>("/config") }).data;

  useEffect(() => {
    storage.getItem(ACTIVE_VOICE_KEY, "").then((id) => id && setActiveVoiceId(id));
    storage.getItem(HANDS_FREE_KEY, false).then((v) => {
      if (v) {
        setHandsFree(true);
        handsFreeRef.current = true;
      }
    });
  }, []);

  const activeVoice = useMemo(() => {
    const voices = config?.voice_models ?? [];
    const wanted = activeVoiceId ?? config?.active_voice_model_id;
    return voices.find((v) => v.id === wanted) ?? voices.find((v) => v.id === config?.active_voice_model_id) ?? voices[0] ?? null;
  }, [config, activeVoiceId]);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder);

  const scale = useSharedValue(1);
  useEffect(() => {
    if (phase === "listening") scale.value = withRepeat(withTiming(1.18, { duration: 700, easing: Easing.inOut(Easing.quad) }), -1, true);
    else if (phase === "speaking") scale.value = withRepeat(withTiming(1.1, { duration: 450, easing: Easing.inOut(Easing.quad) }), -1, true);
    else scale.value = withTiming(1, { duration: 250 });
  }, [phase, scale]);
  const orbStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const showToast = useCallback((m: string) => setToastMsg(m), []);

  async function beginListening() {
    const perm = await AudioModule.getRecordingPermissionsAsync();
    if (!perm.granted) {
      setPermMode(perm.canAskAgain ? "explain" : "blocked");
      setPermVisible(true);
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      setPhase("listening");
    } catch {
      showToast(t.errorGeneric);
    }
  }

  async function requestMic() {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (perm.granted) {
      setPermVisible(false);
      await beginListening();
    } else if (perm.canAskAgain) {
      setPermVisible(false);
    } else setPermMode("blocked");
  }

  const onSpeakEnd = useCallback(() => {
    setPhase("idle");
    if (handsFreeRef.current) {
      setTimeout(() => {
        if (handsFreeRef.current) void beginListening();
      }, 700);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function stopAndRun() {
    setPhase("processing");
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri;
      if (!uri) throw new Error("no rec");

      if (mode === "sts") {
        // Speech-to-Speech: re-voice the user's own words in the chosen character voice.
        const form = new FormData();
        if (Platform.OS === "web") {
          const blob = await (await fetch(uri)).blob();
          form.append("file", blob, "rec.wav");
        } else {
          form.append("file", { uri, name: "rec.m4a", type: "audio/m4a" } as any);
        }
        form.append("voice_model_id", activeVoice?.id ?? "");
        const res = await fetch(`${API_URL}/sts`, { method: "POST", body: form });
        if (!res.ok) {
          setPhase("idle");
          return showToast(res.status === 400 ? t.keysMissing : t.errorGeneric);
        }
        const data = await res.json();
        setLastUser(t.voiceChanger);
        setLastReply("");
        setPhase("speaking");
        await playBase64(data.audio_base64, data.mime, onSpeakEnd);
        return;
      }

      const file: any = Platform.OS === "web"
        ? { blob: await (await fetch(uri)).blob(), name: "rec.wav" }
        : { uri, name: "rec.m4a", type: "audio/m4a" };
      const stt = await apiUpload<{ text: string }>("/stt", file);
      const text = (stt.text ?? "").trim();
      if (!text) {
        setPhase("idle");
        return showToast(t.errorGeneric);
      }
      setLastUser(text);
      let reply = "";
      await streamChat({ text, conversation_id: "voice" }, (ev) => {
        if (ev.type === "delta") { reply += ev.content; setLastReply(reply); }
        else if (ev.type === "done") reply = ev.reply;
        else if (ev.type === "error") showToast(ev.detail.toLowerCase().includes("key") ? t.keysMissing : ev.detail.slice(0, 80));
      });
      if (!reply.trim()) {
        setPhase("idle");
        return;
      }
      setLastReply(reply);
      setPhase("speaking");
      const tts = await apiPost<{ mime: string; audio_base64: string }>("/tts", {
        text: reply,
        voice_model_id: activeVoice?.id,
      });
      await playBase64(tts.audio_base64, tts.mime, onSpeakEnd);
    } catch (e: any) {
      showToast(e?.status === 400 ? t.keysMissing : t.errorGeneric);
      setPhase("idle");
    }
  }

  function toggleHandsFree() {
    setHandsFree((v) => {
      const next = !v;
      handsFreeRef.current = next;
      void storage.setItem(HANDS_FREE_KEY, next);
      return next;
    });
  }

  function onOrbPress() {
    if (phase === "listening") return stopAndRun();
    if (phase === "idle") return beginListening();
    if (phase === "speaking") {
      stopPlayback();
      setPhase("idle");
    }
  }

  const statusText = phase === "listening" ? t.listening : phase === "processing" ? t.processing : phase === "speaking" ? t.speaking : t.voiceHint;

  const avatarUrl = activeVoice?.avatar_url ? { uri: `${API_URL}${activeVoice.avatar_url}` } : null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable testID="voice-close-button" onPress={() => { stopPlayback(); router.back(); }} style={styles.closeBtn}>
          <Ionicons name="chevron-down" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={styles.topRight}>
          <Pressable testID="voice-handsfree-toggle" onPress={toggleHandsFree} style={[styles.toggleBtn, handsFree && styles.toggleBtnOn]}>
            <Ionicons name="infinite" size={16} color={handsFree ? colors.onBrandPrimary : colors.onSurface} />
          </Pressable>
          <Pressable testID="voice-mode-toggle" onPress={() => setMode((m) => (m === "sts" ? "assistant" : "sts"))} style={[styles.toggleBtn, mode === "sts" && styles.toggleBtnOn]}>
            <Ionicons name="swap-horizontal" size={16} color={mode === "sts" ? colors.onBrandPrimary : colors.onSurface} />
          </Pressable>
          <Pressable testID="voice-select-button" onPress={() => setPickerOpen((v) => !v)} style={styles.voiceSel}>
            <Ionicons name={activeVoice?.gender === "male" ? "man" : "woman"} size={16} color={colors.brandPrimary} />
            <Text style={styles.voiceSelText} numberOfLines={1}>{activeVoice?.label ?? t.chooseVoice}</Text>
            <Ionicons name="chevron-down" size={14} color={colors.muted} />
          </Pressable>
        </View>
      </View>

      {pickerOpen ? (
        <View testID="voice-character-list" style={styles.charList}>
          {(config?.voice_models ?? []).map((vm: VoiceModel) => {
            const active = vm.id === activeVoice?.id;
            const url = vm.avatar_url ? { uri: `${API_URL}${vm.avatar_url}` } : null;
            return (
              <Pressable
                key={vm.id}
                testID={`voice-char-${vm.id}`}
                onPress={() => {
                  setActiveVoiceId(vm.id);
                  void storage.setItem(ACTIVE_VOICE_KEY, vm.id);
                  setPickerOpen(false);
                }}
                style={[styles.charItem, active && styles.charItemActive]}
              >
                {url ? (
                  <Image style={styles.charAvatar} source={url} />
                ) : (
                  <View style={[styles.charAvatar, styles.charAvatarFallback]}>
                    <Ionicons name={vm.gender === "male" ? "man" : "woman"} size={22} color={colors.onBrandPrimary} />
                  </View>
                )}
                <Text style={[styles.charName, active && { color: colors.brandPrimary }]} numberOfLines={1}>{vm.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={styles.center}>
        <Pressable testID="voice-orb-button" onPress={onOrbPress} style={styles.orbPress}>
          <Animated.View style={[styles.orb, orbStyle]}>
            {avatarUrl ? (
              <Image style={styles.orbAvatar} source={avatarUrl} />
            ) : (
              <Ionicons name={phase === "speaking" ? "volume-high" : "mic"} size={64} color={colors.onBrandPrimary} />
            )}
          </Animated.View>
        </Pressable>
        <Text testID="voice-status" style={styles.status}>{statusText}</Text>
        {lastUser ? <Text style={styles.transcriptUser} numberOfLines={2}>{lastUser}</Text> : null}
        {lastReply ? <Text style={styles.transcriptReply} numberOfLines={4}>{lastReply}</Text> : null}
      </View>

      <MicPermissionModal visible={permVisible} mode={permMode} onRequest={requestMic} onClose={() => setPermVisible(false)} />
      <Toast message={toastMsg} onDone={() => setToastMsg(null)} style={{ top: insets.top + 60 }} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surfaceInverse },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  closeBtn: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  topRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  toggleBtn: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  toggleBtnOn: { backgroundColor: colors.brandPrimary },
  voiceSel: { flexDirection: "row", alignItems: "center", gap: spacing.xs, height: 40, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface, maxWidth: 200 },
  voiceSelText: { color: colors.onSurface, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  charList: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, justifyContent: "center" },
  charItem: { alignItems: "center", gap: spacing.xs, width: 84, padding: spacing.sm, borderRadius: radius.md },
  charItemActive: { backgroundColor: colors.surface },
  charAvatar: { width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.brandSecondary },
  charAvatarFallback: { alignItems: "center", justifyContent: "center", backgroundColor: colors.brandPrimary },
  charName: { color: colors.onSurfaceInverse, fontSize: 11, textAlign: "center", writingDirection: "rtl" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl, gap: spacing.lg },
  orbPress: { alignItems: "center", justifyContent: "center" },
  orb: { width: 200, height: 200, borderRadius: 120, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  orbAvatar: { width: 200, height: 200, borderRadius: 120 },
  status: { color: colors.onSurfaceInverse, fontSize: 18, fontWeight: "700", textAlign: "center", writingDirection: "rtl", marginTop: spacing.lg },
  transcriptUser: { color: colors.brandTertiary, fontSize: 14, textAlign: "center", writingDirection: "rtl" },
  transcriptReply: { color: colors.onSurfaceInverse, fontSize: 16, lineHeight: 26, textAlign: "center", writingDirection: "rtl", opacity: 0.9 },
}));
