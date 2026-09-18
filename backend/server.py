"""Kosher AI — Kashmiri voice assistant backend.

Proxies Speech-to-Text (Sarvam / Azure), an LLM chat (OpenAI-compatible via
emergentintegrations) and Text-to-Speech (Sarvam / Azure / ElevenLabs).
Developer settings (API keys, system prompt, voice models, logo) live in
MongoDB; provider keys are stored AES-GCM encrypted and never returned
in plaintext.
"""

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any, Dict, List, Optional

import httpx
import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from dotenv import load_dotenv
from fastapi import (APIRouter, Depends, FastAPI, File, Header, HTTPException,
                     UploadFile)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field
from bson import ObjectId
from starlette.concurrency import run_in_threadpool
from xml.sax.saxutils import escape as xml_escape

from emergentintegrations.llm.chat import LlmChat, StreamDone, TextDelta, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
DEV_PASSWORD = os.environ["DEV_PASSWORD"]
EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]
APP_MASTER_KEY = base64.b64decode(os.environ["APP_MASTER_KEY"])

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="Kosher AI API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("kosher-ai")

DEV_TOKEN = hmac.new(APP_MASTER_KEY, DEV_PASSWORD.encode(), hashlib.sha256).hexdigest()

# ---------------------------------------------------------------------------
# MongoDB models
# ---------------------------------------------------------------------------

def _coerce_oid(v: Any) -> str:
    return str(v)

PyObjectId = Annotated[str, BeforeValidator(_coerce_oid)]


class BaseDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: PyObjectId = Field(default_factory=lambda: str(ObjectId()))

    def to_mongo(self) -> dict:
        data = self.model_dump()
        data["_id"] = data.pop("id")
        if ObjectId.is_valid(data["_id"]):
            data["_id"] = ObjectId(data["_id"])
        return data

    @classmethod
    def from_mongo(cls, doc: Optional[dict]):
        if doc is None:
            return None
        doc = dict(doc)
        doc["id"] = str(doc.pop("_id"))
        return cls.model_validate(doc)


class VoiceModel(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    label: str
    gender: str = "female"
    provider: str = "sarvam"
    voice_id: str
    language_code: str = "ks-IN"
    model_name: str = ""


DEFAULT_SYSTEM_PROMPT = (
    "You are Kosher AI, a warm and friendly voice assistant for the Kashmiri language.\n"
    "STRICT RULES:\n"
    "1. ALWAYS reply only in Kashmiri, written in Perso-Arabic script.\n"
    "2. Keep every reply short: 1 to 3 short sentences, because replies are spoken aloud "
    "through text-to-speech.\n"
    "3. Use a warm, respectful, conversational tone with everyday Kashmiri words.\n"
    "4. If the user writes in another language, understand it but still reply in Kashmiri.\n"
    "5. Plain text only: no emoji, no markdown, no bullet points and no romanization, only "
    "characters that a voice can read aloud.\n"
    "6. If you do not know something, say so briefly and politely in Kashmiri."
)

DEFAULT_VOICE_MODELS: List[VoiceModel] = [
    VoiceModel(id="male-1", label="مَرٕد آواز ۱", gender="male", provider="sarvam",
               voice_id="abhilash", language_code="ks-IN", model_name="bulbul:v3"),
    VoiceModel(id="female-1", label="زَنان آواز ۱", gender="female", provider="sarvam",
               voice_id="anushka", language_code="ks-IN", model_name="bulbul:v3"),
    VoiceModel(id="male-azure", label="مَرٕد آواز ۱", gender="male", provider="azure",
               voice_id="ks-IN-MaleNeural", language_code="ks-IN", model_name=""),
    VoiceModel(id="female-azure", label="زَنان آواز ۱", gender="female", provider="azure",
               voice_id="ks-IN-FemaleNeural", language_code="ks-IN", model_name=""),
    VoiceModel(id="male-el", label="مَرٕد آواز ۱", gender="male", provider="elevenlabs",
               voice_id="TxGEqnHWrfWFTfGW9XjX", language_code="ks-IN",
               model_name="eleven_multilingual_v2"),
    VoiceModel(id="female-el", label="زَنان آواز ۱", gender="female", provider="elevenlabs",
               voice_id="21m00Tcm4TlvDq8ikWAM", language_code="ks-IN",
               model_name="eleven_multilingual_v2"),
]


class Settings(BaseDocument):
    llm_model: str = "gpt-5.4"
    system_prompt: str = DEFAULT_SYSTEM_PROMPT
    stt_provider: str = "sarvam"
    tts_provider: str = "sarvam"
    voice_models: List[VoiceModel] = DEFAULT_VOICE_MODELS
    active_voice_model_id: str = "female-1"
    keys_enc: Dict[str, dict] = Field(default_factory=dict)
    logo_path: Optional[str] = None
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ChatMessage(BaseDocument):
    session_id: str = "main"
    role: str
    text: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    deleted_at: Optional[datetime] = None


SETTINGS_ID = "settings"
KEY_FIELDS = ["sarvam_api_key", "azure_api_key", "azure_region", "elevenlabs_api_key", "openai_api_key"]
TTS_PROVIDERS = {"sarvam", "azure", "elevenlabs"}
STT_PROVIDERS = {"sarvam", "azure"}


async def get_settings() -> Settings:
    doc = await db.settings.find_one({"_id": SETTINGS_ID})
    if doc is None:
        s = Settings(id=SETTINGS_ID)
        await db.settings.insert_one(s.to_mongo())
        return s
    return Settings.from_mongo(doc)  # type: ignore[return-value]


async def save_settings(s: Settings) -> None:
    s.updated_at = datetime.now(timezone.utc)
    await db.settings.update_one({"_id": SETTINGS_ID}, {"$set": s.to_mongo()}, upsert=True)


async def get_keys() -> Dict[str, Optional[str]]:
    s = await get_settings()
    out: Dict[str, Optional[str]] = {}
    for name, env in s.keys_enc.items():
        try:
            out[name] = _decrypt(env)
        except Exception:
            out[name] = None
    return out


# ---------------------------------------------------------------------------
# Secret envelope (AES-GCM) — per integration playbook
# ---------------------------------------------------------------------------

def _encrypt(value: str) -> dict:
    nonce = secrets.token_bytes(12)
    ct = AESGCM(APP_MASTER_KEY).encrypt(nonce, value.encode(), None)
    return {"n": base64.b64encode(nonce).decode(), "c": base64.b64encode(ct).decode()}


def _decrypt(env: dict) -> str:
    return AESGCM(APP_MASTER_KEY).decrypt(
        base64.b64decode(env["n"]), base64.b64decode(env["c"]), None
    ).decode()


def _mask(v: str) -> str:
    if not v:
        return ""
    if len(v) <= 8:
        return "••••"
    return f"{v[:4]}••••{v[-4:]}"


# ---------------------------------------------------------------------------
# Emergent Object Storage (logo uploads) — per integration playbook
# ---------------------------------------------------------------------------

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
STORAGE_APP = "kosher-ai"
storage_key = None


def init_storage() -> str:
    global storage_key
    if storage_key:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_LLM_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    global storage_key
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    if resp.status_code == 503 and storage_key:
        storage_key = None
        return put_object(path, data, content_type)
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    global storage_key
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    if resp.status_code == 503 and storage_key:
        storage_key = None
        return get_object(path)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "image/png")


@app.on_event("startup")
async def startup():
    try:
        await run_in_threadpool(init_storage)
        logger.info("object storage initialised")
    except Exception as e:
        logger.warning("object storage init failed: %s", e)


# ---------------------------------------------------------------------------
# Public routes
# ---------------------------------------------------------------------------

@api_router.get("/health")
async def health():
    return {"ok": True, "app": "kosher-ai", "time": datetime.now(timezone.utc).isoformat()}


@api_router.get("/config")
async def config():
    s = await get_settings()
    keys = await get_keys()
    return {
        "voice_models": [vm.model_dump() for vm in s.voice_models],
        "active_voice_model_id": s.active_voice_model_id,
        "stt_provider": s.stt_provider,
        "tts_provider": s.tts_provider,
        "llm_model": s.llm_model,
        "logo_path": "/api/files/logo" if s.logo_path else None,
        "logo_ts": s.updated_at.isoformat(),
        "providers_ready": {
            "sarvam": bool(keys.get("sarvam_api_key")),
            "azure": bool(keys.get("azure_api_key")),
            "elevenlabs": bool(keys.get("elevenlabs_api_key")),
        },
        "llm_ready": True,
    }


@api_router.get("/history")
async def history(limit: int = 100):
    limit = max(1, min(limit, 200))
    docs = await db.messages.find({"deleted_at": None}).sort("created_at", -1).to_list(limit)
    docs.reverse()
    return [ChatMessage.from_mongo(d) for d in docs]


@api_router.post("/chat/clear")
async def clear_chat():
    await db.messages.update_many(
        {"deleted_at": None}, {"$set": {"deleted_at": datetime.now(timezone.utc)}}
    )
    return {"ok": True}


class ChatIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    session_id: str = "main"


@api_router.post("/chat")
async def chat(body: ChatIn):
    s = await get_settings()
    keys = await get_keys()
    text = body.text.strip()
    if not text:
        raise HTTPException(422, "text is required")

    llm_key = keys.get("openai_api_key") or EMERGENT_LLM_KEY

    history_docs = await db.messages.find(
        {"session_id": body.session_id, "deleted_at": None}
    ).sort("created_at", -1).to_list(16)
    history = [
        {"role": d["role"], "content": d["text"]}
        for d in reversed(history_docs)
        if d.get("role") in ("user", "assistant")
    ]
    messages = [{"role": "system", "content": s.system_prompt}] + history

    user_doc = ChatMessage(session_id=body.session_id, role="user", text=text)
    await db.messages.insert_one(user_doc.to_mongo())

    async def event_stream():
        parts: List[str] = []
        try:
            chat = LlmChat(
                api_key=llm_key,
                session_id=f"kosher-{uuid.uuid4().hex}",
                system_message=s.system_prompt,
                initial_messages=messages,
            ).with_model("openai", s.llm_model)
            async for ev in chat.stream_message(UserMessage(text=text)):
                if isinstance(ev, TextDelta):
                    parts.append(ev.content)
                    yield f"data: {json.dumps({'type': 'delta', 'content': ev.content}, ensure_ascii=False)}\n\n"
                elif isinstance(ev, StreamDone):
                    break
            reply = "".join(parts).strip()
            if not reply:
                raise RuntimeError("empty reply from model")
            doc = ChatMessage(session_id=body.session_id, role="assistant", text=reply)
            await db.messages.insert_one(doc.to_mongo())
            yield f"data: {json.dumps({'type': 'done', 'message_id': str(doc.id), 'reply': reply}, ensure_ascii=False)}\n\n"
        except HTTPException as e:
            yield f"data: {json.dumps({'type': 'error', 'detail': e.detail}, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.exception("chat stream failed")
            yield f"data: {json.dumps({'type': 'error', 'detail': str(e)[:300]}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Speech: STT
# ---------------------------------------------------------------------------

@api_router.post("/stt")
async def stt(file: UploadFile = File(...)):
    s = await get_settings()
    keys = await get_keys()
    data = await file.read()
    if len(data) > 25_000_000:
        raise HTTPException(413, "Audio too large")
    provider = s.stt_provider

    if provider == "sarvam":
        key = keys.get("sarvam_api_key")
        if not key:
            raise HTTPException(400, "Sarvam API key is not configured. Add it in Developer Options.")
        model = "saaras:v3"
        async with httpx.AsyncClient(timeout=120) as c:
            r = await c.post(
                "https://api.sarvam.ai/speech-to-text",
                headers={"api-subscription-key": key},
                files={"file": (file.filename or "audio.m4a", data, file.content_type or "audio/m4a")},
                data={"model": model, "language_code": "ks-IN", "mode": "transcribe"},
            )
            if r.is_error:
                detail = r.text[:300]
                # fall back to the dedicated transcription model if saaras is unavailable
                r2 = await c.post(
                    "https://api.sarvam.ai/speech-to-text",
                    headers={"api-subscription-key": key},
                    files={"file": (file.filename or "audio.m4a", data, file.content_type or "audio/m4a")},
                    data={"model": "saarika:v3", "language_code": "ks-IN", "mode": "transcribe"},
                )
                if r2.is_error:
                    raise HTTPException(502, f"Sarvam STT error: {detail}")
                r = r2
            j = r.json()
        return {"text": j.get("transcript") or j.get("text", ""), "provider": "sarvam"}

    if provider == "azure":
        key = keys.get("azure_api_key")
        if not key:
            raise HTTPException(400, "Azure Speech key is not configured. Add it in Developer Options.")
        region = keys.get("azure_region") or ""
        ct = (file.content_type or "").lower()
        if ct.startswith("audio/wav"):
            azure_ct = "audio/wav; codecs=audio/pcm; samplerate=16000"
        elif "ogg" in ct:
            azure_ct = "audio/ogg; codecs=opus"
        else:
            raise HTTPException(
                415,
                "Azure STT needs 16kHz mono WAV or OGG/OPUS audio. Switch STT provider to Sarvam in Developer Options.",
            )
        url = f"https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1"
        async with httpx.AsyncClient(timeout=120) as c:
            r = await c.post(
                url,
                params={"language": "ks-IN", "format": "detailed"},
                headers={
                    "Ocp-Apim-Subscription-Key": key,
                    "Content-Type": azure_ct,
                    "Accept": "application/json",
                },
                content=data,
            )
        if r.is_error:
            raise HTTPException(502, f"Azure STT error: {r.text[:300]}")
        j = r.json()
        return {"text": j.get("DisplayText", ""), "provider": "azure"}

    raise HTTPException(400, f"Unsupported STT provider: {provider}")


# ---------------------------------------------------------------------------
# Speech: TTS
# ---------------------------------------------------------------------------

class TtsIn(BaseModel):
    text: str = Field(min_length=1, max_length=2500)
    voice_model_id: Optional[str] = None


async def _resolve_voice_model(s: Settings, voice_model_id: Optional[str]) -> VoiceModel:
    if voice_model_id:
        for vm in s.voice_models:
            if vm.id == voice_model_id:
                return vm
        raise HTTPException(404, f"Unknown voice model: {voice_model_id}")
    for vm in s.voice_models:
        if vm.id == s.active_voice_model_id:
            return vm
    if s.voice_models:
        return s.voice_models[0]
    raise HTTPException(400, "No voice models configured")


async def _tts(text: str, vm: VoiceModel, keys: Dict[str, Optional[str]]) -> Dict[str, Any]:
    if vm.provider == "sarvam":
        key = keys.get("sarvam_api_key")
        if not key:
            raise HTTPException(400, "Sarvam API key is not configured. Add it in Developer Options.")
        async with httpx.AsyncClient(timeout=120) as c:
            r = await c.post(
                "https://api.sarvam.ai/text-to-speech",
                headers={"api-subscription-key": key},
                json={
                    "text": text,
                    "language_code": vm.language_code,
                    "speaker": vm.voice_id,
                    "model": vm.model_name or "bulbul:v3",
                    "speech_sample_rate": 24000,
                    "output_audio_codec": "wav",
                    "temperature": 0.6,
                },
            )
        if r.is_error:
            raise HTTPException(502, f"Sarvam TTS error: {r.text[:300]}")
        j = r.json()
        audios = j.get("audios") or []
        if not audios:
            raise HTTPException(502, "Sarvam TTS returned no audio")
        return {"mime": "audio/wav", "audio_base64": audios[0], "voice_model_id": vm.id}

    if vm.provider == "elevenlabs":
        key = keys.get("elevenlabs_api_key")
        if not key:
            raise HTTPException(400, "ElevenLabs API key is not configured. Add it in Developer Options.")
        async with httpx.AsyncClient(timeout=120) as c:
            r = await c.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{vm.voice_id}",
                params={"output_format": "mp3_44100_128"},
                headers={"xi-api-key": key, "Content-Type": "application/json"},
                json={"text": text, "model_id": vm.model_name or "eleven_multilingual_v2"},
            )
        if r.is_error:
            raise HTTPException(502, f"ElevenLabs TTS error: {r.text[:300]}")
        return {
            "mime": "audio/mpeg",
            "audio_base64": base64.b64encode(r.content).decode(),
            "voice_model_id": vm.id,
        }

    if vm.provider == "azure":
        key = keys.get("azure_api_key")
        if not key:
            raise HTTPException(400, "Azure Speech key is not configured. Add it in Developer Options.")
        region = keys.get("azure_region") or ""
        endpoint = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
        ssml = (
            f'<speak version="1.0" xml:lang="{vm.language_code}">'
            f'<voice name="{xml_escape(vm.voice_id)}">{xml_escape(text)}</voice></speak>'
        )
        async with httpx.AsyncClient(timeout=120) as c:
            r = await c.post(
                endpoint,
                headers={
                    "Ocp-Apim-Subscription-Key": key,
                    "Content-Type": "application/ssml+xml",
                    "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
                },
                content=ssml.encode(),
            )
        if r.is_error:
            raise HTTPException(502, f"Azure TTS error: {r.text[:300]}")
        return {
            "mime": "audio/mpeg",
            "audio_base64": base64.b64encode(r.content).decode(),
            "voice_model_id": vm.id,
        }

    raise HTTPException(400, f"Unsupported TTS provider: {vm.provider}")


@api_router.post("/tts")
async def tts(body: TtsIn):
    s = await get_settings()
    keys = await get_keys()
    vm = await _resolve_voice_model(s, body.voice_model_id)
    return await _tts(body.text, vm, keys)


# ---------------------------------------------------------------------------
# Developer options (password 20791 easter egg)
# ---------------------------------------------------------------------------

async def require_dev(x_dev_token: str = Header(default="")):
    if not x_dev_token or not hmac.compare_digest(x_dev_token, DEV_TOKEN):
        raise HTTPException(401, "Invalid developer token")


class UnlockIn(BaseModel):
    password: str = Field(min_length=1, max_length=64)


@api_router.post("/dev/unlock")
async def dev_unlock(body: UnlockIn):
    if hmac.compare_digest(body.password, DEV_PASSWORD):
        return {"ok": True, "token": DEV_TOKEN}
    raise HTTPException(401, "Wrong password")


class DevKeyInfo(BaseModel):
    configured: bool
    preview: str


class DevSettingsView(BaseModel):
    llm_model: str
    system_prompt: str
    stt_provider: str
    tts_provider: str
    voice_models: List[VoiceModel]
    active_voice_model_id: str
    logo_path: Optional[str]
    keys: Dict[str, DevKeyInfo]


async def _dev_view(s: Settings) -> DevSettingsView:
    keys = await get_keys()
    return DevSettingsView(
        llm_model=s.llm_model,
        system_prompt=s.system_prompt,
        stt_provider=s.stt_provider,
        tts_provider=s.tts_provider,
        voice_models=s.voice_models,
        active_voice_model_id=s.active_voice_model_id,
        logo_path=s.logo_path,
        keys={
            name: DevKeyInfo(configured=bool(v), preview=_mask(v or ""))
            for name, v in ((f, keys.get(f) or "") for f in KEY_FIELDS)
        },
    )


@api_router.get("/dev/settings", dependencies=[Depends(require_dev)])
async def dev_get_settings():
    s = await get_settings()
    return await _dev_view(s)


class DevSettingsIn(BaseModel):
    llm_model: Optional[str] = None
    system_prompt: Optional[str] = None
    stt_provider: Optional[str] = None
    tts_provider: Optional[str] = None
    active_voice_model_id: Optional[str] = None
    voice_models: Optional[List[VoiceModel]] = None
    keys: Optional[Dict[str, str]] = None


@api_router.put("/dev/settings", dependencies=[Depends(require_dev)])
async def dev_put_settings(body: DevSettingsIn):
    s = await get_settings()
    if body.llm_model:
        s.llm_model = body.llm_model.strip()
    if body.system_prompt is not None and body.system_prompt.strip():
        s.system_prompt = body.system_prompt.strip()
    if body.stt_provider:
        if body.stt_provider not in STT_PROVIDERS:
            raise HTTPException(422, f"stt_provider must be one of {sorted(STT_PROVIDERS)}")
        s.stt_provider = body.stt_provider
    if body.tts_provider:
        if body.tts_provider not in TTS_PROVIDERS:
            raise HTTPException(422, f"tts_provider must be one of {sorted(TTS_PROVIDERS)}")
        s.tts_provider = body.tts_provider
    if body.voice_models is not None:
        if not body.voice_models:
            raise HTTPException(422, "At least one voice model is required")
        s.voice_models = body.voice_models
    if body.active_voice_model_id:
        if not any(vm.id == body.active_voice_model_id for vm in s.voice_models):
            raise HTTPException(422, "active_voice_model_id not found in voice_models")
        s.active_voice_model_id = body.active_voice_model_id
    if body.keys:
        for name, value in body.keys.items():
            if name in KEY_FIELDS and value and value.strip():
                s.keys_enc[name] = _encrypt(value.strip())
    await save_settings(s)
    return await _dev_view(s)


class TestTtsIn(BaseModel):
    voice_model_id: str


@api_router.post("/dev/test-tts", dependencies=[Depends(require_dev)])
async def dev_test_tts(body: TestTtsIn):
    s = await get_settings()
    keys = await get_keys()
    vm = await _resolve_voice_model(s, body.voice_model_id)
    result = await _tts("آسلام! یِہ چھِ کوشَر اے آءی."[:120], vm, keys)
    return result


@api_router.post("/dev/logo", dependencies=[Depends(require_dev)])
async def dev_upload_logo(file: UploadFile = File(...)):
    ct = file.content_type or "image/png"
    if not ct.startswith("image/"):
        raise HTTPException(415, "Only image files are allowed")
    data = await file.read()
    if len(data) > 5_000_000:
        raise HTTPException(413, "Logo image too large (max 5MB)")
    ext = "png" if "png" in ct else "jpg"
    path = f"{STORAGE_APP}/uploads/logo/{uuid.uuid4().hex}.{ext}"
    await run_in_threadpool(put_object, path, data, ct)
    s = await get_settings()
    s.logo_path = path
    await save_settings(s)
    return {"ok": True, "logo_path": "/api/files/logo"}


@api_router.post("/dev/logo/reset", dependencies=[Depends(require_dev)])
async def dev_reset_logo():
    s = await get_settings()
    s.logo_path = None
    await save_settings(s)
    return {"ok": True, "logo_path": None}


@api_router.get("/files/logo")
async def logo_file():
    s = await get_settings()
    if not s.logo_path:
        raise HTTPException(404, "No custom logo set")
    try:
        data, ct = await run_in_threadpool(get_object, s.logo_path)
    except Exception:
        logger.exception("logo download failed")
        raise HTTPException(404, "Logo not found")
    return Response(content=data, media_type=ct, headers={"Cache-Control": "no-store"})


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()