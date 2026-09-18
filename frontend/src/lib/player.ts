// TTS playback helper: base64 audio from the backend -> local cache file -> expo-audio.
import { Platform } from "react-native";

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import * as FS from "expo-file-system/legacy";

let player: AudioPlayer | null = null;
let audioModeReady = false;

function extFor(mime: string): string {
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("ogg")) return "ogg";
  return "m4a";
}

export async function playBase64(
  base64: string,
  mime: string,
  onEnd?: () => void,
): Promise<void> {
  if (Platform.OS === "web") {
    const el = new Audio(`data:${mime};base64,${base64}`);
    if (onEnd) el.onended = onEnd;
    try {
      await el.play();
    } catch {
      // autoplay guard — user gesture already happened via button press
    }
    return;
  }
  if (!audioModeReady) {
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
    audioModeReady = true;
  }
  player?.release();
  const path = `${FS.cacheDirectory}tts-${Date.now()}.${extFor(mime)}`;
  await FS.writeAsStringAsync(path, base64, { encoding: FS.EncodingType.Base64 });
  player = createAudioPlayer({ uri: path });
  if (onEnd) {
    player.addListener("playbackStatusUpdate", (status: any) => {
      if (status?.didJustFinish) onEnd();
    });
  }
  player.play();
}

export function stopPlayback(): void {
  try {
    player?.pause();
  } catch {}
}