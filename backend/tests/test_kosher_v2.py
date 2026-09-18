"""Kosher AI v2 backend tests — auth (guest + negative), attachments, vision,
dev layout controls (app_name, tagline, logo_position, features, vision_model),
voice avatars, and speech 'not configured' paths.

Base URL is always taken from EXPO_PUBLIC_BACKEND_URL — no hardcoded fallback.
"""
import base64
import io
import json
import os
import re
import struct
import zlib

import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

DEV_PASSWORD = "20791"
ARABIC_RE = re.compile(r"[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]")


def _tiny_png_bytes() -> bytes:
    """Build a valid 2x2 red PNG in-memory (no external deps)."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0)
    raw = b"\x00" + b"\xff\x00\x00\xff\x00\x00" + b"\x00" + b"\xff\x00\x00\xff\x00\x00"
    idat = zlib.compress(raw)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def _tiny_pdf_bytes() -> bytes:
    return (b"%PDF-1.1\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n"
            b"2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n"
            b"3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>endobj\n"
            b"xref\n0 4\n0000000000 65535 f \n"
            b"trailer<< /Size 4 /Root 1 0 R >>\nstartxref\n0\n%%EOF")


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    return s


@pytest.fixture(scope="module")
def dev_token(session):
    r = session.post(f"{API}/dev/unlock", json={"password": DEV_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


# ------------------------------------------------------------------
# 1. /api/config — new fields
# ------------------------------------------------------------------
class TestConfigV2:
    def test_config_has_new_fields(self, session):
        r = session.get(f"{API}/config", timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert "app_name" in j and isinstance(j["app_name"], str)
        assert "tagline" in j and isinstance(j["tagline"], str)
        assert j["logo_position"] in ("left", "center", "right")
        feats = j["features"]
        for k in ("voice_mode", "attachments", "auto_speak", "input_switcher", "show_tagline"):
            assert k in feats, f"missing feature flag: {k}"
        vms = j["voice_models"]
        assert isinstance(vms, list) and len(vms) >= 1
        for vm in vms:
            assert "avatar_url" in vm  # null by default OR a /api/files/voice/... url
        # previous fields still present
        assert j["llm_ready"] is True
        assert "providers_ready" in j


# ------------------------------------------------------------------
# 2. Auth negative paths (no real Google OAuth)
# ------------------------------------------------------------------
class TestAuthNegative:
    def test_session_invalid_returns_401(self, session):
        r = session.post(f"{API}/auth/session",
                         json={"session_id": "invalid"}, timeout=30)
        assert r.status_code == 401, r.text

    def test_me_without_auth_401(self, session):
        r = session.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 401

    def test_conversations_without_auth_401(self, session):
        r = session.get(f"{API}/conversations", timeout=30)
        assert r.status_code == 401


# ------------------------------------------------------------------
# 3. Guest optional-auth endpoints
# ------------------------------------------------------------------
class TestGuestFlow:
    def test_history_guest_empty_after_clear(self, session):
        r = session.post(f"{API}/chat/clear?conversation_id=guest", timeout=30)
        assert r.status_code == 200
        h = session.get(f"{API}/history?conversation_id=guest", timeout=30).json()
        assert h == []

    def test_chat_streams_and_saves_as_guest(self, session):
        r = session.post(
            f"{API}/chat",
            data=json.dumps({"text": "سلام", "conversation_id": "guest"}),
            headers={"Content-Type": "application/json"},
            stream=True, timeout=120,
        )
        assert r.status_code == 200
        delta = 0
        done = None
        for raw in r.iter_lines(decode_unicode=True):
            if not raw or not raw.startswith("data:"):
                continue
            ev = json.loads(raw[5:].strip())
            if ev.get("type") == "delta":
                delta += 1
            elif ev.get("type") == "done":
                done = ev
                break
            elif ev.get("type") == "error":
                pytest.fail(f"chat error: {ev}")
        assert done is not None
        assert delta >= 1
        assert done.get("message_id")
        assert ARABIC_RE.search(done["reply"])
        # saved under user_id=null (guest)
        h = session.get(f"{API}/history?conversation_id=guest", timeout=30).json()
        assert len(h) >= 2
        assert h[0]["role"] == "user"
        assert h[-1]["role"] == "assistant"

    def test_clear_guest_ok(self, session):
        r = session.post(f"{API}/chat/clear?conversation_id=guest", timeout=30)
        assert r.status_code == 200
        assert r.json().get("ok") is True


# ------------------------------------------------------------------
# 4. Attachments upload + serve + unsupported
# ------------------------------------------------------------------
class TestAttachments:
    IMG_ID: str = ""
    PDF_ID: str = ""

    def test_upload_png_image(self, session):
        png = _tiny_png_bytes()
        r = requests.post(
            f"{API}/attachments/upload",
            files={"file": ("t.png", io.BytesIO(png), "image/png")},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["kind"] == "image"
        assert j["mime"] == "image/png"
        assert j["url"].startswith("/api/files/attachment/")
        assert j["id"]
        TestAttachments.IMG_ID = j["id"]
        # fetch bytes
        r2 = requests.get(f"{BASE}{j['url']}", timeout=60)
        assert r2.status_code == 200
        assert r2.content[:8] == b"\x89PNG\r\n\x1a\n"

    def test_upload_pdf(self, session):
        pdf = _tiny_pdf_bytes()
        r = requests.post(
            f"{API}/attachments/upload",
            files={"file": ("t.pdf", io.BytesIO(pdf), "application/pdf")},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["kind"] == "pdf"
        assert j["mime"] == "application/pdf"
        TestAttachments.PDF_ID = j["id"]

    def test_upload_unsupported_415(self, session):
        r = requests.post(
            f"{API}/attachments/upload",
            files={"file": ("bad.mp3", io.BytesIO(b"\x00\x01\x02"), "audio/mpeg")},
            timeout=30,
        )
        assert r.status_code == 415, r.text

    def test_vision_chat_with_image(self, session):
        assert TestAttachments.IMG_ID, "image upload must succeed first"
        # clear guest first for cleanliness
        session.post(f"{API}/chat/clear?conversation_id=guest", timeout=30)
        payload = {
            "text": "یِہ کیا چھُ؟",
            "conversation_id": "guest",
            "attachment_ids": [TestAttachments.IMG_ID],
        }
        r = session.post(
            f"{API}/chat",
            data=json.dumps(payload),
            headers={"Content-Type": "application/json"},
            stream=True, timeout=180,
        )
        assert r.status_code == 200, r.text
        done = None
        errored = None
        for raw in r.iter_lines(decode_unicode=True):
            if not raw or not raw.startswith("data:"):
                continue
            ev = json.loads(raw[5:].strip())
            if ev.get("type") == "done":
                done = ev
                break
            if ev.get("type") == "error":
                errored = ev
                break
        assert errored is None, f"vision chat errored: {errored}"
        assert done is not None
        assert done.get("reply", "").strip()


# ------------------------------------------------------------------
# 5. Dev unlock + settings
# ------------------------------------------------------------------
class TestDevAuth:
    def test_unlock_wrong_401(self, session):
        r = session.post(f"{API}/dev/unlock", json={"password": "00000"}, timeout=30)
        assert r.status_code == 401

    def test_unlock_ok(self, session):
        r = session.post(f"{API}/dev/unlock", json={"password": DEV_PASSWORD}, timeout=30)
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_get_settings_needs_token(self, session):
        r = session.get(f"{API}/dev/settings", timeout=30)
        assert r.status_code == 401

    def test_get_settings_has_v2_fields(self, session, dev_token):
        r = session.get(f"{API}/dev/settings",
                        headers={"X-Dev-Token": dev_token}, timeout=30)
        assert r.status_code == 200
        j = r.json()
        for k in ("app_name", "tagline", "logo_position", "features",
                  "vision_model", "voice_models"):
            assert k in j
        # masked keys
        for f in ("sarvam_api_key", "azure_api_key", "elevenlabs_api_key", "openai_api_key"):
            assert f in j["keys"]
            assert "preview" in j["keys"][f]


# ------------------------------------------------------------------
# 6. Dev layout controls PUT + reflect in /api/config
# ------------------------------------------------------------------
class TestDevLayoutControls:
    def test_put_layout_updates(self, session, dev_token):
        prev = session.get(f"{API}/dev/settings",
                           headers={"X-Dev-Token": dev_token}, timeout=30).json()
        prev_pos = prev["logo_position"]

        # 1. valid update
        r = session.put(
            f"{API}/dev/settings",
            headers={"X-Dev-Token": dev_token, "Content-Type": "application/json"},
            json={
                "app_name": "Kosher AI",
                "tagline": "کٲشُر ؤاژ ایسِسٹینٹ",
                "logo_position": "center",
                "features": {"voice_mode": False},
                "vision_model": "gemini-2.5-flash",
            },
            timeout=30,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["logo_position"] == "center"
        assert j["vision_model"] == "gemini-2.5-flash"
        assert j["features"]["voice_mode"] is False
        # other feature flags preserved
        for k in ("attachments", "auto_speak", "input_switcher", "show_tagline"):
            assert k in j["features"]

        # reflects in /api/config
        cfg = session.get(f"{API}/config", timeout=30).json()
        assert cfg["logo_position"] == "center"
        assert cfg["features"]["voice_mode"] is False
        assert cfg["app_name"] == "Kosher AI"

        # 2. invalid logo_position ignored (stays at 'center')
        r2 = session.put(
            f"{API}/dev/settings",
            headers={"X-Dev-Token": dev_token, "Content-Type": "application/json"},
            json={"logo_position": "banana"},
            timeout=30,
        )
        assert r2.status_code == 200
        assert r2.json()["logo_position"] == "center"

        # 3. restore
        session.put(
            f"{API}/dev/settings",
            headers={"X-Dev-Token": dev_token, "Content-Type": "application/json"},
            json={"logo_position": prev_pos, "features": {"voice_mode": True}},
            timeout=30,
        )

    def test_put_invalid_stt_422(self, session, dev_token):
        r = session.put(
            f"{API}/dev/settings",
            headers={"X-Dev-Token": dev_token, "Content-Type": "application/json"},
            json={"stt_provider": "foo"},
            timeout=30,
        )
        assert r.status_code == 422

    def test_put_empty_voice_models_422(self, session, dev_token):
        r = session.put(
            f"{API}/dev/settings",
            headers={"X-Dev-Token": dev_token, "Content-Type": "application/json"},
            json={"voice_models": []},
            timeout=30,
        )
        assert r.status_code == 422


# ------------------------------------------------------------------
# 7. Voice avatar upload + persist across settings PUT
# ------------------------------------------------------------------
class TestVoiceAvatar:
    VOICE_ID = "female-1"

    def test_upload_and_persist(self, session, dev_token):
        png = _tiny_png_bytes()
        # upload avatar
        r = requests.post(
            f"{API}/dev/voice/{self.VOICE_ID}/avatar",
            headers={"X-Dev-Token": dev_token},
            files={"file": ("a.png", io.BytesIO(png), "image/png")},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        assert r.json()["avatar_url"] == f"/api/files/voice/{self.VOICE_ID}"

        # /api/config reflects it
        cfg = session.get(f"{API}/config", timeout=30).json()
        matched = [vm for vm in cfg["voice_models"] if vm["id"] == self.VOICE_ID]
        assert matched, "voice id not found in config"
        assert matched[0]["avatar_url"] == f"/api/files/voice/{self.VOICE_ID}"

        # /api/files/voice/{id} returns image bytes
        r2 = requests.get(f"{API}/files/voice/{self.VOICE_ID}", timeout=30)
        assert r2.status_code == 200
        assert r2.content[:8] == b"\x89PNG\r\n\x1a\n"

        # Now PUT settings with voice_models list that OMITS avatar_path
        current = session.get(f"{API}/dev/settings",
                              headers={"X-Dev-Token": dev_token}, timeout=30).json()
        # strip avatar_url/avatar_path from each voice_model to simulate frontend
        payload_voices = []
        for vm in current["voice_models"]:
            payload_voices.append({
                "id": vm["id"], "label": vm["label"], "gender": vm["gender"],
                "provider": vm["provider"], "voice_id": vm["voice_id"],
                "language_code": vm["language_code"], "model_name": vm.get("model_name", ""),
            })
        r3 = session.put(
            f"{API}/dev/settings",
            headers={"X-Dev-Token": dev_token, "Content-Type": "application/json"},
            json={"voice_models": payload_voices},
            timeout=30,
        )
        assert r3.status_code == 200

        # avatar should still be there
        cfg2 = session.get(f"{API}/config", timeout=30).json()
        m2 = [vm for vm in cfg2["voice_models"] if vm["id"] == self.VOICE_ID]
        assert m2 and m2[0]["avatar_url"] == f"/api/files/voice/{self.VOICE_ID}", \
            "avatar_url did NOT persist after settings PUT that omitted avatar_path"


# ------------------------------------------------------------------
# 8. STT / TTS / test-tts — not configured
# ------------------------------------------------------------------
class TestSpeechNotConfigured:
    def test_stt_400(self, session, dev_token):
        # ensure sarvam has no key: clear it by wiping settings doc? we cannot easily,
        # but the app starts with no keys set. Switch STT to azure to force 'not configured'.
        session.put(
            f"{API}/dev/settings",
            headers={"X-Dev-Token": dev_token, "Content-Type": "application/json"},
            json={"stt_provider": "azure"},
            timeout=30,
        )
        wav = b"RIFF$\x00\x00\x00WAVEfmt " + b"\x00" * 16 + b"data\x00\x00\x00\x00"
        r = requests.post(
            f"{API}/stt",
            files={"file": ("t.wav", io.BytesIO(wav), "audio/wav")},
            timeout=30,
        )
        assert r.status_code == 400
        assert "not configured" in r.text.lower()
        session.put(
            f"{API}/dev/settings",
            headers={"X-Dev-Token": dev_token, "Content-Type": "application/json"},
            json={"stt_provider": "sarvam"},
            timeout=30,
        )

    def test_tts_400(self, session, dev_token):
        session.put(
            f"{API}/dev/settings",
            headers={"X-Dev-Token": dev_token, "Content-Type": "application/json"},
            json={"active_voice_model_id": "female-azure"},
            timeout=30,
        )
        r = session.post(f"{API}/tts", json={"text": "سلام"}, timeout=30)
        assert r.status_code == 400
        assert "not configured" in r.text.lower()

    def test_dev_test_tts_400(self, session, dev_token):
        r = session.post(
            f"{API}/dev/test-tts",
            headers={"X-Dev-Token": dev_token, "Content-Type": "application/json"},
            json={"voice_model_id": "female-azure"},
            timeout=30,
        )
        assert r.status_code == 400
        assert "not configured" in r.text.lower()
        # restore
        session.put(
            f"{API}/dev/settings",
            headers={"X-Dev-Token": dev_token, "Content-Type": "application/json"},
            json={"active_voice_model_id": "female-1"},
            timeout=30,
        )
