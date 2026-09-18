// Pick a photo or document and upload it to the backend, returning AttachmentMeta.
import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";

import { apiUpload, type AttachmentMeta } from "@/src/lib/api";

async function toUploadInput(uri: string, name: string, type: string) {
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    return { blob, name };
  }
  return { uri, name, type };
}

export async function pickAndUploadPhoto(): Promise<AttachmentMeta | null> {
  const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!req.granted) throw new Error("permission");
  }
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  const file = await toUploadInput(a.uri, a.fileName ?? "photo.jpg", a.mimeType ?? "image/jpeg");
  return apiUpload<AttachmentMeta>("/attachments/upload", file);
}

export async function pickAndUploadDocument(): Promise<AttachmentMeta | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ["application/pdf", "text/plain", "text/csv"],
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  const file = await toUploadInput(a.uri, a.name ?? "document.pdf", a.mimeType ?? "application/pdf");
  return apiUpload<AttachmentMeta>("/attachments/upload", file);
}
