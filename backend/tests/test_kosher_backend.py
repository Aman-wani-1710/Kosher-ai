"""Backend tests for Kosher AI (Kashmiri voice assistant)."""
import io
import json
import os
import re
import time

import pytest
import requests

# Use the Expo public backend URL (public preview URL) since the frontend uses it.
BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://koshur-ai-assistant.preview.emergentagent.com"
BASE = BASE.rstrip("/")
API = f"{BASE}/api"

DEV_PASSWORD = "20791"

# Kashmiri Perso-Arabic Unicode range (Arabic + Arabic supplement/extended)
ARABIC_RE = re.compile(r"[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]")


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers["Content-Type"] = "application/json"
    return s


@pytest.fixture(scope="module")
def dev_token(session):
    r = session.post(f"{API}/dev/unlock", json={"password": DEV_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


# ---------- health / config ----------
class TestHealthConfig:
    def test_health(self, session):
        r = session.get(f"{API}/health", timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j.get("ok") is True
        assert j.get("app") == "kosher-ai"

    def test_config(self, session):
        r = session.get(f"{API}/config", timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert isinstance(j["voice_models"], list)
        assert len(j["voice_models"]) == 6, f"expected 6 voice models, got {len(j['voice_models'])}"
        assert j["active_voice_model_id"]
        assert j["stt_provider"] == "sarvam"
        assert j["tts_provider"] == "sarvam"
        assert j["llm_model"]
        assert j["llm_ready"] is True
        pr = j["providers_ready"]
        for k in ("sarvam", "azure", "elevenlabs"):
            assert k in pr


# ---------- chat + history ----------
class TestChat:
    def test_clear_first(self, session):
        r = session.post(f"{API}/chat/clear", timeout=30)
        assert r.status_code == 200
        h = session.get(f"{API}/history", timeout=30).json()
        assert h == []

    def test_chat_stream_and_history(self, session):
        # POST /chat is SSE — collect frames via stream=True
        r = session.post(
            f"{API}/chat",
            data=json.dumps({"text": "سلام"}),
            headers={"Content-Type": "application/json"},
            stream=True,
            timeout=120,
        )
        assert r.status_code == 200, r.text
        delta_count = 0
        done = None
        for raw in r.iter_lines(decode_unicode=True):
            if not raw or not raw.startswith("data:"):
                continue
            try:
                ev = json.loads(raw[5:].strip())
            except Exception:
                continue
            if ev.get("type") == "delta":
                delta_count += 1
            elif ev.get("type") == "done":
                done = ev
                break
            elif ev.get("type") == "error":
                pytest.fail(f"chat error: {ev}")
        assert done is not None, "no done event received"
        assert delta_count >= 1, "expected multiple delta events"
        assert done.get("message_id")
        reply = done.get("reply", "")
        assert reply.strip(), "empty reply"
        assert ARABIC_RE.search(reply), f"reply not in Perso-Arabic: {reply!r}"

        # GET /history — should contain user + assistant chronologically
        h = session.get(f"{API}/history", timeout=30).json()
        assert len(h) >= 2
        assert h[0]["role"] == "user"
        assert h[-1]["role"] == "assistant"
        assert h[-1]["text"] == reply

    def test_clear_soft_deletes(self, session):
        r = session.post(f"{API}/chat/clear", timeout=30)
        assert r.status_code == 200
        h = session.get(f"{API}/history", timeout=30).json()
        assert h == []


# ---------- dev unlock ----------
class TestDevUnlock:
    def test_wrong_password_401(self, session):
        r = session.post(f"{API}/dev/unlock", json={"password": "00000"}, timeout=30)
        assert r.status_code == 401

    def test_right_password_ok(self, session):
        r = session.post(f"{API}/dev/unlock", json={"password": DEV_PASSWORD}, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j.get("ok") is True
        assert isinstance(j.get("token"), str) and len(j["token"]) > 16


# ---------- dev settings ----------
class TestDevSettings:
    def test_get_settings_requires_token(self, session):
        r = session.get(f"{API}/dev/settings", timeout=30)
        assert r.status_code == 401

    def test_get_settings_with_token(self, session, dev_token):
        r = session.get(f"{API}/dev/settings", headers={"X-Dev-Token": dev_token}, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert "keys" in j
        for f in ("sarvam_api_key", "azure_api_key", "elevenlabs_api_key", "openai_api_key"):
            assert f in j["keys"]
            assert "configured" in j["keys"][f]
            assert "preview" in j["keys"][f]

    def test_put_sets_key_and_config_updates(self, session, dev_token):
        # set a fake sarvam key
        fake = "sk-testFAKE12345678"
        r = session.put(
            f"{API}/dev/settings",
            headers={"X-Dev-Token": dev_token, "Content-Type": "application/json"},
            json={"keys": {"sarvam_api_key": fake}},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        view = r.json()
        info = view["keys"]["sarvam_api_key"]
        assert info["configured"] is True
        assert info["preview"] != fake  # masked, never plaintext
        assert fake not in json.dumps(view)

        # /api/config now reports sarvam ready
        cfg = session.get(f"{API}/config", timeout=30).json()
        assert cfg["providers_ready"]["sarvam"] is True

    def test_put_validation_invalid_stt(self, session, dev_token):
        r = session.put(
            f"{API}/dev/settings",
            headers={"X-Dev-Token": dev_token, "Content-Type": "application/json"},
            json={"stt_provider": "foo"},
            timeout=30,
        )
        assert r.status_code == 422, r.text

    def test_put_validation_empty_voice_models(self, session, dev_token):
        r = session.put(
            f"{API}/dev/settings",
            headers={"X-Dev-Token": dev_token, "Content-Type": "application/json"},
            json={"voice_models": []},
            timeout=30,
        )
        assert r.status_code == 422

    def test_put_validation_active_voice_not_in_list(self, session, dev_token):
        r = session.put(
            f"{API}/dev/settings",
            headers={"X-Dev-Token": dev_token, "Content-Type": "application/json"},
            json={"active_voice_model_id": "does-not-exist-xxx"},
            timeout=30,
        )
        assert r.status_code == 422

    def test_put_updates_system_prompt_and_llm(self, session, dev_token):
        r = session.put(
            f"{API}/dev/settings",
            headers={"X-Dev-Token": dev_token, "Content-Type": "application/json"},
            json={"llm_model": "gpt-5.4", "system_prompt": "Reply in Kashmiri briefly."},
            timeout=30,
        )
        assert r.status_code == 200
        j = r.json()
        assert j["llm_model"] == "gpt-5.4"
        assert "Kashmiri" in j["system_prompt"]


# ---------- STT/TTS not configured ----------
class TestSpeechNotConfigured:
    """Note: after TestDevSettings sets a fake sarvam key, /stt and /tts will
    attempt Sarvam and fail with 502 (bad key), not 400. This is expected.
    We test 'not configured' cleanly before any key is set — so this class
    runs its own reset: switch to Azure (no key configured) to trigger 400."""

    def test_stt_400_when_not_configured(self, session, dev_token):
        # Switch STT to azure and ensure no azure key
        r = session.put(
            f"{API}/dev/settings",
            headers={"X-Dev-Token": dev_token, "Content-Type": "application/json"},
            json={"stt_provider": "azure"},
            timeout=30,
        )
        assert r.status_code == 200
        # send a tiny WAV
        wav = b"RIFF$\x00\x00\x00WAVEfmt " + b"\x00" * 16 + b"data\x00\x00\x00\x00"
        r = requests.post(
            f"{API}/stt",
            files={"file": ("test.wav", io.BytesIO(wav), "audio/wav")},
            timeout=30,
        )
        assert r.status_code == 400, f"expected 400 not configured, got {r.status_code}: {r.text}"
        assert "not configured" in r.text.lower()

        # restore sarvam
        session.put(
            f"{API}/dev/settings",
            headers={"X-Dev-Token": dev_token, "Content-Type": "application/json"},
            json={"stt_provider": "sarvam"},
            timeout=30,
        )

    def test_tts_400_when_not_configured(self, session, dev_token):
        # Change active voice to azure voice (which has no azure key)
        r = session.put(
            f"{API}/dev/settings",
            headers={"X-Dev-Token": dev_token, "Content-Type": "application/json"},
            json={"active_voice_model_id": "female-azure"},
            timeout=30,
        )
        assert r.status_code == 200
        r = session.post(f"{API}/tts", json={"text": "سلام"}, timeout=30)
        assert r.status_code == 400, f"expected 400 not configured, got {r.status_code}: {r.text}"
        assert "not configured" in r.text.lower()

    def test_dev_test_tts_400_when_key_missing(self, session, dev_token):
        r = session.post(
            f"{API}/dev/test-tts",
            headers={"X-Dev-Token": dev_token, "Content-Type": "application/json"},
            json={"voice_model_id": "female-azure"},
            timeout=30,
        )
        assert r.status_code == 400
        assert "not configured" in r.text.lower()
