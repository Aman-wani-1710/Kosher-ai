# Kosher AI — Product Requirements Document

## Original Problem Statement
Build a Chatbot + AI Voice Assistant for the **Kashmiri language**. Modern chat interface (type or speak), a prominent microphone button, a voice-model picker (Male/Female voices), external-API architecture (Sarvam / Azure / ElevenLabs for STT & TTS, an LLM instructed to reply in Kashmiri). Hidden developer easter egg: tapping the app logo >10 times opens a password modal (password **20791**) that reveals a Developer Options dashboard for API keys, system prompt, voice model IDs, and a logo uploader.

## User Choices
- Speech providers: all three (Sarvam AI, Azure, ElevenLabs), switchable in Developer Options.
- Keys shipped empty — entered later via the hidden Developer Dashboard.
- Chat LLM: Emergent Universal LLM key (OpenAI gpt-5.4), streaming.
- UI fully in Kashmiri (Perso-Arabic script, RTL).
- Default voice models: Male Voice 1 + Female Voice 1, editable in Developer Options.
- Logo: AI-generated Kashmiri man in a pheran holding a kangri (earthen fire pot).

## Architecture
- **Frontend:** Expo Router (React Native), TanStack Query, react-native-keyboard-controller, @gorhom/bottom-sheet, expo-audio (record + play), expo-image-picker (logo). Theme tokens in `src/theme.ts` (Editorial Light — warm ceramic & saffron). Kashmiri strings in `src/lib/ks.ts`. API client + SSE streaming in `src/lib/api.ts`, TTS playback in `src/lib/player.ts`.
- **Backend:** FastAPI (`/api` prefix) + MongoDB (motor). LLM via emergentintegrations `LlmChat.stream_message` (SSE). Provider API keys stored **AES-GCM encrypted** in the `settings` doc, never returned in plaintext (masked previews only). Dev auth = HMAC token from the 20791 password, sent as `X-Dev-Token`. Logo stored in Emergent Object Storage, served via `/api/files/logo`.

## User Personas
- **Kashmiri speaker** — chats with the assistant by voice or text and hears spoken replies.
- **Owner/developer** — uses the hidden dashboard to add speech API keys, tune the system prompt, manage voice models, and set the logo.

## Core Requirements (static)
1. Kashmiri RTL chat UI with streaming AI replies.
2. Voice input (STT) and spoken output (TTS), provider-switchable.
3. Voice-model picker + auto-speak toggle.
4. Hidden dev easter egg (11 logo taps → 20791 → dashboard).
5. Dev dashboard: keys, system prompt, STT/TTS providers, voice models CRUD, logo upload, test-voice, clear chat.
6. Secrets never leave the backend in plaintext.

## Implemented (2026-06)
- [x] v1: streaming Kashmiri chat, STT/TTS (Sarvam/Azure/ElevenLabs), voice picker, easter-egg dev dashboard, encrypted keys, AI logo.

## Implemented (v2 upgrades)
- [x] Google sign-in (Emergent-managed) + guest mode (sign-in optional); token in secure storage, in-memory mirror.
- [x] Per-user conversations + chat history; tap logo / menu sheet to browse, create, delete chats.
- [x] Gemini-style attachments: photo + PDF/TXT/CSV upload (object storage), AI reads them and replies in Kashmiri (routes to Gemini vision model).
- [x] Kashmiri voice-conversation mode (full-screen orb: tap → listen → transcribe → reply → speak) with selectable voice characters.
- [x] Voice characters with uploadable avatar photos (Developer Options + shown in voice mode).
- [x] Full layout control in Developer Options: app name, tagline, logo position (left/center/right), feature toggles, vision model.
- [x] Input-script switcher (Kashmiri/Urdu Perso-Arabic ↔ English) with RTL/LTR + placeholder swap.
- [x] Developer Options one-tap English ↔ Kashmiri language toggle (persisted).
- [x] Verified: 22/22 backend tests; Google sign-in reaches Google OAuth; English toggle + script switcher confirmed via screenshots.

## Implemented (v3 upgrades — 2026-06)
- [x] Emergent-managed OpenAI TTS (gpt-4o-mini-tts, steerable `instructions`) as a new voice provider; default `emergent-female` (coral) + `emergent-male` (onyx). No user key needed.
- [x] Apple Sign-In: `POST /api/auth/apple` (Apple JWKS verify) alongside Google; native button in menu (iOS). Testable only on a real iOS build.
- [x] Emergent-managed push notifications plumbing: `/api/register-push`, `send_push()`, dev `/api/dev/push-test` daily reminder; module-scope handlers + registration in `_layout.tsx`. Works only after Publish + build; Android needs `google-services.json`.
- [x] ElevenLabs Speech-to-Speech (`/api/sts`) voice-changer mode in Voice screen + dedicated STS key field in Dev Options.
- [x] OpenAI gpt-image-1 image generation in chat (`/api/generate-image`) via the sparkles button.
- [x] App-wide English ↔ Kashmiri translate toggle (global LanguageContext + `useT()`); globe icon in top bar + menu.
- [x] Light/Dark theme toggle (ThemeProvider + dark palette); sun/moon icon in top bar + menu.
- [x] Prominent top-bar sign-in chip (avatar + name when signed in) + Apple button in menu.
- [x] Hands-free voice mode (auto re-listen after the AI finishes speaking).
- [x] AI model dropdown in Dev Options: Gemini 3.1 Pro, Gemini 3 Flash, GPT-5.4, Claude Sonnet 4.6.
- [x] In-app key-help links (Sarvam / Azure / ElevenLabs) in Dev Options.
- [x] Verified: 13/13 v3 checks pass (backend pytest + frontend). Fixed duplicate system-prompt in `/api/chat`.

### v3 notes / build-only
- Apple Sign-In and push notifications require a real iOS/Android build (not Expo Go). Android push also needs a Firebase `google-services.json`.
- OpenAI TTS voices are English-trained, so Kashmiri carries an English accent; ElevenLabs multilingual / Sarvam give a more native accent.

## Backlog (prioritized)
- **P1:** Streaming TTS (speak as tokens arrive) for lower latency in voice mode.
- **P1:** Continuous hands-free voice mode (auto re-listen after reply).
- **P2:** Waveform/level meter while recording; message copy/share.
- **P2:** Light/dark theme toggle; drag-to-reorder voice models in Developer Options.

## Next Tasks
- Await user's attachment-UI reference screenshot to refine the attach flow.
- Await Sarvam/Azure/ElevenLabs keys to validate real STT/TTS + voice mode on a device.
