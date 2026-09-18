import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@react-native-vector-icons/ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { ks } from "@/src/lib/ks";
import {
  apiGet,
  apiPost,
  apiPut,
  apiUpload,
  PROVIDER_NAMES,
  type DevSettings,
  type VoiceModel,
} from "@/src/lib/api";
import { playBase64 } from "@/src/lib/player";
import { storage } from "@/src/utils/storage";
import { Toast } from "@/src/components/toast";

const DEV_TOKEN_KEY = "dev_token";

export default function DevScreen() {
  const [checked, setChecked] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    storage.secureGet(DEV_TOKEN_KEY, "").then((t) => {
      setToken(t || null);
      setChecked(true);
    });
  }, []);

  if (!checked) {
    return <Loading />;
  }
  if (!token) {
    return <PasswordGate onSuccess={(t) => { storage.secureSet(DEV_TOKEN_KEY, t); setToken(t); }} />;
  }
  return <Dashboard token={token} />;
}

function Loading() {
  const styles = useStyles();
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" />
      <Text style={styles.loadingText}>{ks.loading}</Text>
    </View>
  );
}

function PasswordGate({ onSuccess }: { onSuccess: (t: string) => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!pw.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ ok: boolean; token: string }>("/dev/unlock", { password: pw.trim() });
      setPw("");
      onSuccess(res.token);
    } catch {
      setError(ks.wrongPassword);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.gateWrap}>
      <View style={styles.gateCard}>
        <View style={styles.iconWrap}>
          <Ionicons name="lock-closed" size={22} color={colors.onBrandPrimary} />
        </View>
        <Text style={styles.gateTitle}>{ks.passwordTitle}</Text>
        <Text style={styles.gateSubtitle}>{ks.passwordSubtitle}</Text>
        <TextInput
          testID="dev-password-input"
          style={styles.input}
          value={pw}
          onChangeText={setPw}
          secureTextEntry
          keyboardType="number-pad"
          placeholder={ks.passwordPlaceholder}
          placeholderTextColor={colors.muted}
          onSubmitEditing={submit}
          autoFocus
        />
        {error ? (
          <Text testID="dev-password-error" style={styles.errorText}>
            {error}
          </Text>
        ) : null}
        <Pressable
          testID="dev-password-submit-btn"
          disabled={busy}
          style={({ pressed }) => [styles.primaryBtn, busy && { opacity: 0.6 }, pressed && { opacity: 0.85 }]}
          onPress={submit}
        >
          <Text style={styles.primaryText}>{busy ? ks.saving : ks.unlock}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

type FormState = {
  llm_model: string;
  system_prompt: string;
  stt_provider: string;
  tts_provider: string;
  active_voice_model_id: string;
  voice_models: import("@/src/lib/api").VoiceModel[];
};

function Dashboard({ token }: { token: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ["devSettings"],
    queryFn: () => apiGet<DevSettings>("/dev/settings", token),
  });

  const data = settingsQuery.data;
  const [form, setForm] = useState<FormState | null>(null);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [logoTs, setLogoTs] = useState<number>(Date.now());
  const [testingId, setTestingId] = useState<string | null>(null);

  useEffect(() => {
    if (data && !form) {
      setForm({
        llm_model: data.llm_model,
        system_prompt: data.system_prompt,
        stt_provider: data.stt_provider,
        tts_provider: data.tts_provider,
        active_voice_model_id: data.active_voice_model_id,
        voice_models: data.voice_models,
      });
      setLogoTs(Date.now());
    }
  }, [data, form]);

  if (settingsQuery.isLoading) return <Loading />;
  if (settingsQuery.isError || !form) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{ks.errorGeneric}</Text>
        <Pressable testID="dev-load-retry" style={styles.secondaryBtn} onPress={() => settingsQuery.refetch()}>
          <Text style={styles.secondaryText}>{ks.retry}</Text>
        </Pressable>
      </View>
    );
  }

  const showToast = (m: string) => {
    setToastMsg(m);
  };

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await apiPut<DevSettings>(
        "/dev/settings",
        {
          llm_model: form!.llm_model,
          system_prompt: form!.system_prompt,
          stt_provider: form!.stt_provider,
          tts_provider: form!.tts_provider,
          active_voice_model_id: form!.active_voice_model_id,
          voice_models: form!.voice_models,
          keys: Object.fromEntries(Object.entries(keyInputs).filter(([, v]) => v && v.trim())),
        },
        token,
      );
      setKeyInputs({});
      queryClient.invalidateQueries({ queryKey: ["devSettings"] });
      queryClient.invalidateQueries({ queryKey: ["config"] });
      showToast(ks.saved);
    } catch (e: any) {
      showToast(e?.detail?.slice(0, 90) || ks.errorGeneric);
    } finally {
      setSaving(false);
    }
  }

  async function pickLogo() {
    try {
      const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (!perm.granted && !perm.canAskAgain) {
        showToast(ks.micBlockedBody);
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
        allowsEditing: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      const file: any =
        Platform.OS === "web"
          ? { blob: await (await fetch(asset.uri)).blob(), name: "logo.png" }
          : { uri: asset.uri, name: "logo.png", type: asset.mimeType ?? "image/png" };
      await apiUpload("/dev/logo", file, token);
      setLogoTs(Date.now());
      queryClient.invalidateQueries({ queryKey: ["config"] });
      queryClient.invalidateQueries({ queryKey: ["devSettings"] });
      showToast(ks.logoUpdated);
    } catch (e: any) {
      showToast(e?.detail?.slice(0, 90) || ks.errorGeneric);
    }
  }

  async function resetLogo() {
    try {
      await apiPost("/dev/logo/reset", {}, token);
      queryClient.invalidateQueries({ queryKey: ["config"] });
      queryClient.invalidateQueries({ queryKey: ["devSettings"] });
      showToast(ks.logoResetDone);
    } catch {
      showToast(ks.errorGeneric);
    }
  }

  async function testVoice(vmId: string) {
    if (testingId) return;
    setTestingId(vmId);
    try {
      const res = await apiPost<{ mime: string; audio_base64: string }>("/dev/test-tts", { voice_model_id: vmId }, token);
      await playBase64(res.audio_base64, res.mime);
    } catch (e: any) {
      showToast(e?.status === 400 ? ks.keysMissing : e?.detail?.slice(0, 90) || ks.errorGeneric);
    } finally {
      setTestingId(null);
    }
  }

  function updateVoice(id: string, patch: Partial<VoiceModel>) {
    setForm((f) =>
      f ? { ...f, voice_models: f.voice_models.map((vm) => (vm.id === id ? { ...vm, ...patch } : vm)) } : f,
    );
  }

  function removeVoice(id: string) {
    setForm((f) => {
      if (!f) return f;
      const next = f.voice_models.filter((vm) => vm.id !== id);
      const active = f.active_voice_model_id === id ? next[0]?.id ?? "" : f.active_voice_model_id;
      return { ...f, voice_models: next, active_voice_model_id: active };
    });
  }

  function addVoice() {
    setForm((f) =>
      f
        ? {
            ...f,
            voice_models: [
              ...f.voice_models,
              {
                id: `vm-${Date.now()}`,
                label: ks.newChatVoice,
                gender: "female",
                provider: "sarvam",
                voice_id: "",
                language_code: "ks-IN",
                model_name: "bulbul:v3",
              },
            ],
          }
        : f,
    );
  }

  const keyField = (field: string, label: string) => {
    const info = data!.keys[field];
    return (
      <View style={styles.fieldWrap}>
        <View style={styles.labelWrap}>
          <Text style={styles.label}>{label}</Text>
          <View style={styles.keyState}>
            <View style={[styles.dot, { backgroundColor: info?.configured ? colors.success : colors.error }]} />
            <Text style={styles.keyStateText}>{info?.configured ? ks.configured : ks.notConfigured}</Text>
          </View>
        </View>
        <TextInput
          testID={`dev-key-${field}`}
          style={styles.input}
          value={keyInputs[field] ?? ""}
          onChangeText={(v) => setKeyInputs((k) => ({ ...k, [field]: v }))}
          placeholder={info?.preview || ks.passwordPlaceholder}
          placeholderTextColor={colors.muted}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
    );
  };

  const logoUri = data!.logo_path
    ? { uri: `${apiBaseForImages()}${data!.logo_path}?ts=${logoTs}` }
    : require("../assets/images/logo.png");

  return (
    <View style={[styles.dashWrap, { paddingBottom: insets.bottom }]}>
      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingBottom: 120 }}
        bottomOffset={120}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.dashHeader}>
          <Text style={styles.dashTitle}>{ks.passwordTitle}</Text>
        </View>

        {/* LLM */}
        <Section title={ks.llmTitle}>
          <Field label={ks.llmModel}>
            <TextInput
              testID="dev-llm-model-input"
              style={styles.inputLtr}
              value={form.llm_model}
              onChangeText={(v) => setForm((f) => f && { ...f, llm_model: v })}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>
          <Field label={ks.systemPrompt}>
            <TextInput
              testID="dev-system-prompt-input"
              style={[styles.inputLtr, styles.multiline]}
              value={form.system_prompt}
              onChangeText={(v) => setForm((f) => f && { ...f, system_prompt: v })}
              multiline
              textAlignVertical="top"
            />
          </Field>
          {keyField("openai_api_key", ks.openaiKey)}
        </Section>

        {/* STT */}
        <Section title={ks.sttTitle}>
          <ChipRow
            testPrefix="stt-chip"
            options={["sarvam", "azure"]}
            value={form.stt_provider}
            onChange={(v) => setForm((f) => f && { ...f, stt_provider: v })}
          />
          {keyField("sarvam_api_key", ks.sarvamKey)}
          {keyField("azure_api_key", ks.azureKey)}
          <Field label={ks.azureRegion}>
            <TextInput
              testID="dev-azure-region-input"
              style={styles.inputLtr}
              value={keyInputs["azure_region"] ?? ""}
              onChangeText={(v) => setKeyInputs((k) => ({ ...k, azure_region: v }))}
              placeholder={data!.keys["azure_region"]?.preview || "westeurope"}
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>
        </Section>

        {/* TTS default provider */}
        <Section title={ks.ttsTitle}>
          <ChipRow
            testPrefix="tts-chip"
            options={["sarvam", "azure", "elevenlabs"]}
            value={form.tts_provider}
            onChange={(v) => setForm((f) => f && { ...f, tts_provider: v })}
          />
          {keyField("elevenlabs_api_key", ks.elevenKey)}
        </Section>

        {/* Voice models */}
        <Section title={ks.voicesTitle}>
          {form.voice_models.map((vm) => {
            const active = form.active_voice_model_id === vm.id;
            return (
              <View key={vm.id} style={[styles.voiceCard, active && styles.voiceCardActive]}>
                <View style={styles.voiceCardHead}>
                  <Pressable
                    testID={`voice-active-${vm.id}`}
                    onPress={() => setForm((f) => f && { ...f, active_voice_model_id: vm.id })}
                    style={[styles.voiceActiveChip, active && styles.voiceActiveChipOn]}
                  >
                    <Ionicons name={active ? "checkmark-circle" : "ellipse-outline"} size={16} color={active ? colors.onBrandPrimary : colors.muted} />
                    <Text style={[styles.voiceActiveText, active && { color: colors.onBrandPrimary }]}>
                      {active ? "آواز آن چھُ" : "آواز بنیو"}
                    </Text>
                  </Pressable>
                  <Pressable testID={`voice-delete-${vm.id}`} onPress={() => removeVoice(vm.id)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                  </Pressable>
                </View>
                <Field label={ks.voiceLabel}>
                  <TextInput
                    testID={`voice-label-${vm.id}`}
                    style={styles.input}
                    value={vm.label}
                    onChangeText={(v) => updateVoice(vm.id, { label: v })}
                  />
                </Field>
                <Field label={ks.voiceId}>
                  <TextInput
                    testID={`voice-id-${vm.id}`}
                    style={styles.inputLtr}
                    value={vm.voice_id}
                    onChangeText={(v) => updateVoice(vm.id, { voice_id: v })}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </Field>
                <Field label={ks.language}>
                  <TextInput
                    testID={`voice-lang-${vm.id}`}
                    style={styles.inputLtr}
                    value={vm.language_code}
                    onChangeText={(v) => updateVoice(vm.id, { language_code: v })}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </Field>
                <Field label={ks.modelName}>
                  <TextInput
                    testID={`voice-model-${vm.id}`}
                    style={styles.inputLtr}
                    value={vm.model_name}
                    onChangeText={(v) => updateVoice(vm.id, { model_name: v })}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </Field>
                <View style={styles.chipWrap}>
                  <Text style={styles.label}>{ks.gender}</Text>
                  <ChipRow
                    testPrefix={`voice-gender-${vm.id}`}
                    options={[
                      { id: "male", label: ks.male },
                      { id: "female", label: ks.female },
                    ]}
                    value={vm.gender}
                    onChange={(v) => updateVoice(vm.id, { gender: v })}
                  />
                </View>
                <View style={styles.chipWrap}>
                  <Text style={styles.label}>{ks.provider}</Text>
                  <ChipRow
                    testPrefix={`voice-provider-${vm.id}`}
                    options={["sarvam", "azure", "elevenlabs"]}
                    value={vm.provider}
                    onChange={(v) => updateVoice(vm.id, { provider: v })}
                  />
                </View>
                <Pressable
                  testID={`voice-test-${vm.id}`}
                  disabled={testingId !== null}
                  onPress={() => testVoice(vm.id)}
                  style={({ pressed }) => [styles.testBtn, pressed && { opacity: 0.8 }]}
                >
                  {testingId === vm.id ? (
                    <ActivityIndicator size="small" color={colors.onBrandTertiary} />
                  ) : (
                    <Ionicons name="play-circle-outline" size={18} color={colors.brandPrimary} />
                  )}
                  <Text style={styles.voiceTestText}>{ks.testVoice}</Text>
                </Pressable>
              </View>
            );
          })}
          <Pressable testID="add-voice-button" style={styles.addBtn} onPress={addVoice}>
            <Ionicons name="add-circle-outline" size={20} color={colors.brandPrimary} />
            <Text style={styles.addBtnText}>{ks.addVoice}</Text>
          </Pressable>
        </Section>

        {/* Logo */}
        <Section title={ks.logoTitle}>
          <View style={styles.logoRow}>
            <Image style={styles.logoPreview} source={logoUri} />
            <View style={styles.logoBtns}>
              <Pressable testID="dev-logo-upload-btn" style={styles.primaryBtn} onPress={pickLogo}>
                <Text style={styles.primaryText}>{ks.logoUpload}</Text>
              </Pressable>
              <Pressable testID="dev-logo-reset-btn" style={styles.secondaryBtn} onPress={resetLogo}>
                <Text style={styles.secondaryText}>{ks.logoReset}</Text>
              </Pressable>
            </View>
          </View>
        </Section>

        {/* Clear chat */}
        <Pressable
          testID="dev-clear-chat-btn"
          style={styles.clearBtn}
          onPress={async () => {
            try {
              await apiPost("/chat/clear");
              queryClient.invalidateQueries({ queryKey: ["history"] });
              showToast(ks.cleared);
            } catch {
              showToast(ks.errorGeneric);
            }
          }}
        >
          <Ionicons name="trash-outline" size={18} color={colors.onError} />
          <Text style={styles.clearBtnText}>{ks.clearChat}</Text>
        </Pressable>
      </KeyboardAwareScrollView>

      <KeyboardStickyView offset={{ closed: insets.bottom + 12, opened: spacing.sm }} style={styles.saveSticky}>
        <Pressable
          testID="dev-save-button"
          disabled={saving}
          style={({ pressed }) => [styles.saveBtn, saving && { opacity: 0.6 }, pressed && { opacity: 0.85 }]}
          onPress={save}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.onBrandPrimary} />
          ) : (
            <Ionicons name="checkmark" size={20} color={colors.onBrandPrimary} />
          )}
          <Text style={styles.primaryText}>{saving ? ks.saving : ks.save}</Text>
        </Pressable>
      </KeyboardStickyView>

      <Toast message={toastMsg} onDone={() => setToastMsg(null)} style={{ top: insets.top + spacing.sm }} />
    </View>
  );
}

function apiBaseForImages(): string {
  const base = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
  return `${base}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function ChipRow({
  options,
  value,
  onChange,
  testPrefix,
}: {
  options: (string | { id: string; label: string })[];
  value: string;
  onChange: (id: string) => void;
  testPrefix: string;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
    >
      {options.map((opt) => {
        const o = typeof opt === "string" ? { id: opt, label: PROVIDER_NAMES[opt] ?? opt } : opt;
        const active = o.id === value;
        return (
          <Pressable
            key={o.id}
            testID={`${testPrefix}-${o.id}`}
            onPress={() => onChange(o.id)}
            style={[
              styles.chip,
              active && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
            ]}
          >
            <Text style={[styles.chipText, active && { color: colors.onBrandPrimary }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, gap: spacing.md },
  loadingText: { color: colors.muted, fontSize: 14, marginTop: spacing.md, writingDirection: "rtl" },
  gateWrap: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, padding: spacing.xl },
  gateCard: { width: "100%", alignItems: "center" },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  gateTitle: { color: colors.onSurface, fontSize: 20, fontWeight: "800", textAlign: "center", writingDirection: "rtl" },
  gateSubtitle: {
    color: colors.muted,
    fontSize: 13,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    textAlign: "center",
    writingDirection: "rtl",
  },
  dashWrap: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  dashHeader: { paddingHorizontal: spacing.lg },
  dashTitle: {
    color: colors.onSurface,
    fontSize: 22,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  section: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  sectionTitle: {
    color: colors.onSurface,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
  label: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600", writingDirection: "rtl", textAlign: "right" },
  fieldWrap: { gap: spacing.xs },
  labelWrap: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  keyState: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: radius.sm },
  keyStateText: { color: colors.muted, fontSize: 11 },
  input: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.onSurface,
    paddingHorizontal: spacing.md,
    fontSize: 14,
    textAlign: "right",
    writingDirection: "rtl",
  },
  inputLtr: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.onSurface,
    paddingHorizontal: spacing.md,
    fontSize: 14,
  },
  multiline: { minHeight: 120, textAlignVertical: "top" },
  chipRow: { flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    height: 36,
    flexShrink: 0,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "600" },
  voiceCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  voiceCardActive: { borderColor: colors.brandPrimary, borderWidth: 1.5 },
  chipWrap: { gap: spacing.xs },
  testBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 40,
    borderRadius: radius.md,
    backgroundColor: colors.brandTertiary,
  },
  voiceTestText: { color: colors.onBrandTertiary, fontSize: 13, fontWeight: "600", writingDirection: "rtl" },
  voiceCardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  voiceActiveChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    height: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
  },
  voiceActiveChipOn: { backgroundColor: colors.brandPrimary },
  voiceActiveText: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "600", writingDirection: "rtl" },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
    borderStyle: "dashed",
  },
  addBtnText: { color: colors.brandPrimary, fontSize: 14, fontWeight: "700", writingDirection: "rtl" },
  logoRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  logoPreview: { width: 96, height: 96, borderRadius: radius.lg, backgroundColor: colors.surfaceTertiary },
  logoBtns: { flex: 1, gap: spacing.sm },
  primaryBtn: {
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  primaryText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: "700" },
  secondaryBtn: {
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  secondaryText: { color: colors.onSurfaceTertiary, fontSize: 14, fontWeight: "600" },
  errorText: { color: colors.error, fontSize: 13, marginTop: spacing.sm, textAlign: "center", writingDirection: "rtl" },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.error,
    marginHorizontal: spacing.lg,
  },
  clearBtnText: { color: colors.onError, fontSize: 14, fontWeight: "700", writingDirection: "rtl" },
  saveSticky: { paddingHorizontal: spacing.lg },
  saveBtn: {
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
}));