// English overrides for the Developer Options screen. Any key not present here
// falls back to the Kashmiri string, so this only needs the dev-facing labels.
import { ks, type KS } from "@/src/lib/ks";

export type DevLang = "ks" | "en";

const EN: Partial<KS> & { translate: string } = {
  passwordTitle: "Developer Options",
  passwordSubtitle: "Enter password to unlock",
  unlock: "Unlock",
  wrongPassword: "Wrong password — try again",

  customizeTitle: "App Design",
  appNameLabel: "App name",
  taglineLabel: "Tagline",
  logoPosition: "Logo position",
  posLeft: "Left",
  posCenter: "Center",
  posRight: "Right",
  visionModel: "Vision model (files)",

  featuresTitle: "Features",
  featVoiceMode: "Voice mode",
  featAttachments: "File attachments",
  featAutoSpeak: "Auto-speak",
  featInputSwitcher: "Script switcher",
  featShowTagline: "Show tagline",

  llmTitle: "Intelligence — LLM",
  llmModel: "LLM model",
  systemPrompt: "System prompt",
  openaiKey: "OpenAI key (optional)",

  sttTitle: "Speech-to-Text — STT",
  sttProvider: "STT provider",
  sarvamKey: "Sarvam API key",
  azureKey: "Azure Speech key",
  azureRegion: "Azure region",

  ttsTitle: "Text-to-Speech — TTS",
  ttsProvider: "TTS provider",
  elevenKey: "ElevenLabs API key",

  voicesTitle: "Voice models",
  characterPhoto: "Character photo",
  voiceLabel: "Name",
  voiceId: "Voice ID",
  language: "Language",
  modelName: "Model",
  gender: "Gender",
  provider: "Provider",
  male: "Male",
  female: "Female",
  testVoice: "Test voice",
  addVoice: "Add new voice",

  logoTitle: "App logo",
  logoUpload: "Change logo",
  logoReset: "Reset to default",
  logoUpdated: "Logo updated",
  logoResetDone: "Logo reset",

  clearChat: "Clear chat",
  cleared: "Chat cleared",
  save: "Save",
  saving: "Saving…",
  saved: "Saved",
  retry: "Retry",
  loading: "Loading…",
  errorGeneric: "Something went wrong — try again",
  keysMissing: "API key missing — add it in Developer Options",
  micBlockedBody: "Permission blocked — open Settings to allow",
  configured: "Key set",
  notConfigured: "No key",
  passwordPlaceholder: "••••••",

  translate: "کٲشُر منز کٔریو",
};

const KS_TRANSLATE = "Switch to English";

export function devStrings(lang: DevLang): KS & { translate: string } {
  if (lang === "en") return { ...ks, ...EN } as KS & { translate: string };
  return { ...ks, translate: KS_TRANSLATE } as KS & { translate: string };
}
