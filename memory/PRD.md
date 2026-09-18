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
- [x] Backend: `/api/health`, `/api/config`, `/api/chat` (SSE streaming, Kashmiri), `/api/history`, `/api/chat/clear`.
- [x] Backend: `/api/stt` (Sarvam + Azure), `/api/tts` (Sarvam/Azure/ElevenLabs), `/api/dev/*` (unlock, settings GET/PUT, test-tts, logo upload/reset), `/api/files/logo`.
- [x] AES-GCM encrypted key storage + masked previews; HMAC dev token auth; provider validation (422s).
- [x] Frontend chat screen: streaming, typing dots, per-message play button, auto-speak, mic recording w/ permission flow, voice picker bottom sheet, clear chat, toasts, RTL bubbles.
- [x] Easter-egg logo header (tap counter + haptics) and password modal.
- [x] Developer dashboard screen with all fields, voice-model editor, provider chip rows, test-voice, logo picker.
- [x] AI-generated app/splash/adaptive logo.
- [x] Verified: 17/17 backend tests + frontend flows via testing agent.

## Backlog (prioritized)
- **P1:** Persist per-conversation sessions / multiple chat threads.
- **P1:** Waveform/level meter while recording.
- **P2:** Message reactions, copy-to-clipboard, share transcript.
- **P2:** Streaming TTS (speak as tokens arrive) for lower latency.
- **P2:** Light/dark theme toggle.

## Next Tasks
- Await user-provided Sarvam/Azure/ElevenLabs keys to validate real STT/TTS end-to-end on a device.
