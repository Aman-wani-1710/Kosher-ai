// Kosher AI API client. All calls go through the FastAPI backend (/api prefix).
import { fetch as expoFetch } from "expo/fetch";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
export const API_URL = `${BACKEND_URL}/api`;

export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let detail = `Request failed (${res.status})`;
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      detail = j.detail ?? j.error ?? text.slice(0, 200);
    } catch {
      detail = text.slice(0, 200) || detail;
    }
  } catch {}
  return new ApiError(res.status, detail);
}

export async function apiGet<T>(path: string, token?: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { "X-Dev-Token": token } : undefined,
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "X-Dev-Token": token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export async function apiPut<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "X-Dev-Token": token } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export type UploadFileInput =
  | { uri: string; name: string; type: string }
  | { blob: Blob; name: string };

export async function apiUpload<T>(path: string, file: UploadFileInput, token?: string): Promise<T> {
  const form = new FormData();
  if ("blob" in file) {
    form.append("file", file.blob, file.name);
  } else {
    form.append("file", { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
  }
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: token ? { "X-Dev-Token": token } : undefined,
    body: form,
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Chat SSE streaming (expo/fetch supports streaming bodies on native + web)
// ---------------------------------------------------------------------------

export type ChatEvent =
  | { type: "delta"; content: string }
  | { type: "done"; message_id: string; reply: string }
  | { type: "error"; detail: string };

export async function streamChat(
  text: string,
  onEvent: (ev: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await expoFetch(`${API_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw await parseError(res);
  }
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as ChatEvent);
      } catch {
        // ignore malformed frame
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VoiceModel = {
  id: string;
  label: string;
  gender: string;
  provider: string;
  voice_id: string;
  language_code: string;
  model_name: string;
};

export type AppConfig = {
  voice_models: VoiceModel[];
  active_voice_model_id: string;
  stt_provider: string;
  tts_provider: string;
  llm_model: string;
  logo_path: string | null;
  logo_ts: string;
  providers_ready: Record<string, boolean>;
  llm_ready: boolean;
};

export type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  created_at: string;
};

export type DevKeyInfo = { configured: boolean; preview: string };

export type DevSettings = {
  llm_model: string;
  system_prompt: string;
  stt_provider: string;
  tts_provider: string;
  voice_models: VoiceModel[];
  active_voice_model_id: string;
  logo_path: string | null;
  keys: Record<string, DevKeyInfo>;
};

export const PROVIDER_NAMES: Record<string, string> = {
  sarvam: "Sarvam AI",
  azure: "Azure",
  elevenlabs: "ElevenLabs",
};

export function logoSource(
  config: AppConfig | undefined,
  logoTs: number,
): { uri: string } | number {
  if (config?.logo_path) {
    return { uri: `${API_URL}${config.logo_path}?ts=${logoTs}` };
  }
  return require("../../assets/images/logo.png");
}