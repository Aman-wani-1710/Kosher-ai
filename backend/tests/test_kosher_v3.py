"""Kosher AI v3 backend tests.

Covers new session features:
- /api/config providers_ready.openai + Emergent voice models
- Emergent OpenAI TTS (gpt-4o-mini-tts)
- OpenAI gpt-image-1 image generation
- Apple sign-in (negative)
- Register-push structured error handling
- AI model dropdown (llm_model switch: gpt-5.4, then back to gemini-3.1-pro-preview)
- /api/sts graceful error handling with invalid audio
"""
import base64
import json
import os

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Accept": "application/json"})
    return s


@pytest.fixture(scope="module")
def dev_token(api):
    r = api.post(f"{BASE_URL}/api/dev/unlock", json={"password": "20791"}, timeout=30)
    assert r.status_code == 200, r.text
    tok = r.json()["token"]
    assert tok
    return tok


# --------------------------- config --------------------------- #
class TestConfig:
    def test_config_openai_ready_and_voices(self, api):
        r = api.get(f"{BASE_URL}/api/config", timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["providers_ready"]["openai"] is True, j["providers_ready"]
        voices = j["voice_models"]
        openai_voices = [v for v in voices if v.get("provider") == "openai"]
        ids = {v["id"] for v in openai_voices}
        assert "emergent-female" in ids, ids
        assert "emergent-male" in ids, ids
        for v in openai_voices:
            assert v["model_name"] == "gpt-4o-mini-tts"


# --------------------------- TTS (Emergent) --------------------------- #
class TestEmergentTTS:
    def test_tts_emergent_female(self, api):
        r = api.post(
            f"{BASE_URL}/api/tts",
            json={"text": "آسلام، تُہٕنٛدؠ کیا نٲو چھُ؟", "voice_model_id": "emergent-female"},
            timeout=120,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["mime"] == "audio/mpeg", j
        assert isinstance(j["audio_base64"], str) and len(j["audio_base64"]) > 100
        # Verify decodes to actual bytes
        raw = base64.b64decode(j["audio_base64"])
        assert len(raw) > 500


# --------------------------- Image generation --------------------------- #
class TestImageGeneration:
    def test_generate_image_and_fetch(self, api):
        r = api.post(
            f"{BASE_URL}/api/generate-image",
            json={"prompt": "a snowy Kashmiri village at sunset", "conversation_id": "guest"},
            timeout=180,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("message_id")
        att = j["attachment"]
        assert att["kind"] == "image"
        assert att["mime"] == "image/png"
        url = att["url"]
        assert url.startswith("/api/files/attachment/")
        # Download
        r2 = api.get(f"{BASE_URL}{url}", timeout=60)
        assert r2.status_code == 200
        assert r2.content[:8] == b"\x89PNG\r\n\x1a\n", "PNG magic mismatch"


# --------------------------- Apple sign-in (negative) --------------------------- #
class TestAppleAuth:
    def test_apple_invalid_token(self, api):
        r = api.post(f"{BASE_URL}/api/auth/apple", json={"identity_token": "bad.token.value"}, timeout=30)
        # Should NOT crash (500) — must be 401
        assert r.status_code == 401, r.text


# --------------------------- Push registration (upstream failure) --------------------------- #
class TestRegisterPush:
    def test_register_push_graceful_error(self, api):
        r = api.post(
            f"{BASE_URL}/api/register-push",
            json={"user_id": "test", "platform": "ios", "device_token": "x"},
            timeout=30,
        )
        # placeholder key -> upstream should reject; must be structured (not 200, not 5xx crash HTML)
        assert r.status_code in (400, 401, 500, 502), r.text
        # Ensure valid JSON
        try:
            j = r.json()
            assert "detail" in j
        except ValueError:
            pytest.fail("Non-JSON response body from /api/register-push")


# --------------------------- AI model dropdown --------------------------- #
class TestAiModelDropdown:
    def _put_model(self, api, token, model):
        r = api.put(
            f"{BASE_URL}/api/dev/settings",
            headers={"X-Dev-Token": token},
            json={"llm_model": model},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json()["llm_model"] == model

    def _chat_stream(self, api, text):
        with api.post(
            f"{BASE_URL}/api/chat",
            json={"text": text, "conversation_id": "guest"},
            stream=True,
            timeout=120,
        ) as r:
            assert r.status_code == 200, r.text
            saw_delta = False
            saw_done = False
            for line in r.iter_lines(decode_unicode=True):
                if not line or not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if not payload:
                    continue
                try:
                    evt = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                if evt.get("type") == "delta":
                    saw_delta = True
                elif evt.get("type") == "done":
                    saw_done = True
                    break
                elif evt.get("type") == "error":
                    pytest.fail(f"chat stream error: {evt.get('detail')}")
            assert saw_delta, "no delta events"
            assert saw_done, "no done event"

    def test_gpt54_then_gemini(self, api, dev_token):
        try:
            self._put_model(api, dev_token, "gpt-5.4")
            self._chat_stream(api, "assalam")
        finally:
            # restore
            self._put_model(api, dev_token, "gemini-3.1-pro-preview")
        # verify gemini still streams
        self._chat_stream(api, "assalam")


# --------------------------- STS graceful error --------------------------- #
class TestSTS:
    def test_sts_invalid_audio_graceful(self, api):
        # send tiny non-audio bytes; ElevenLabs should reject
        r = api.post(
            f"{BASE_URL}/api/sts",
            files={"audio": ("bad.m4a", b"not-audio", "audio/m4a")},
            data={"voice_model_id": "female-el"},
            timeout=60,
        )
        # Note: server declares `file=File(...)` field name — try correct field
        if r.status_code == 422:
            r = api.post(
                f"{BASE_URL}/api/sts",
                files={"file": ("bad.m4a", b"not-audio", "audio/m4a")},
                data={"voice_model_id": "female-el"},
                timeout=60,
            )
        # Must be a graceful 4xx/502, not a crash
        assert r.status_code in (400, 415, 422, 502), r.text
        try:
            j = r.json()
            assert "detail" in j
        except ValueError:
            pytest.fail("Non-JSON response body from /api/sts")
