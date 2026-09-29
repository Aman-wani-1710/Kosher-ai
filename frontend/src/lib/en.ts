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

  // main UI (app-wide English)
  tagline: "Kashmiri Voice Assistant",
  typeMessage: "Type a message…",
  startChat: "Start a conversation",
  emptyHint: "Tap the mic and speak in Kashmiri — or type",
  chooseVoice: "Choose voice",
  errorBanner: "Connection error — tap to retry",
  playVoice: "Play",
  stopVoice: "Stop",
  transcribing: "Listening…",
  tapAgainToStop: "Recording… tap again to stop",
  noNetwork: "No connection — check your internet",
  micDeniedToast: "Permission denied — mic won't work",
  micPermissionTitle: "Microphone access",
  micPermissionBody: "Allow microphone so you can speak to the assistant in Kashmiri",
  micAllow: "Allow",
  openSettings: "Open Settings",
  cancel: "Cancel",
  autospeak: "Auto-speak replies",

  // auth + history
  signIn: "Sign in with Google",
  signOut: "Sign out",
  guest: "Guest",
  historyTitle: "Chat history",
  newChat: "New chat",
  noHistory: "No chats yet",
  signInForHistory: "Sign in to save your history",

  // voice mode
  voiceMode: "Voice mode",
  listening: "Listening…",
  speaking: "Speaking…",
  processing: "Thinking…",
  voiceHint: "Tap and speak in Kashmiri",

  // attachments
  inputScript: "Script",
  scriptPerso: "Kashmiri / Urdu",
  scriptUrdu: "Urdu",
  scriptEnglish: "English",

  // remaining main-UI keys for a complete English experience
  micHint: "Tap the mic and speak in Kashmiri",
  recording: "Recording…",
  thinking: "Thinking…",
  voiceReply: "Voice reply",
  voiceReplyOn: "Voice reply on",
  voiceReplyOff: "Voice reply off",
  easterHint: "…almost there",
  remove: "Remove",
  apiKeys: "API keys",
  newChatVoice: "New voice",
  guestMode: "Continue as guest",
  deleteChat: "Delete chat",
  menu: "Menu",
  account: "Account",
  tapToSpeak: "Tap to speak",
  endVoice: "End",
  attach: "Attach file",
  attachPhoto: "Photo",
  attachPdf: "PDF / file",
  attaching: "Uploading…",
  removeAttachment: "Remove",
  changePhoto: "Change photo",

  // new shared keys (v3)
  signInApple: "Sign in with Apple",
  theme: "Theme",
  lightMode: "Light mode",
  darkMode: "Dark mode",
  languageLabel: "Language",
  generateImage: "Generate image",
  imageGenerating: "Generating image…",
  voiceChanger: "Voice changer (STS)",
  handsFree: "Hands-free",
  handsFreeOn: "Hands-free on",
  handsFreeOff: "Hands-free off",
  aiModel: "AI model",
  imagePromptHint: "Describe an image…",
  sttsKey: "ElevenLabs STS key",
  keyHelpTitle: "How to get these keys?",
};

const KS_TRANSLATE = "Switch to English";

export function devStrings(lang: DevLang): KS & { translate: string } {
  if (lang === "en") return { ...ks, ...EN } as KS & { translate: string };
  return { ...ks, translate: KS_TRANSLATE } as KS & { translate: string };
}
