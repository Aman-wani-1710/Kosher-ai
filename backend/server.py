"""Kosher AI — Kashmiri voice assistant backend.

Features: streaming Kashmiri LLM chat, Speech-to-Text (Sarvam/Azure),
Text-to-Speech (Sarvam/Azure/ElevenLabs), Gemini-powered photo/PDF
attachments, Google (Emergent) auth + guest mode, per-user conversations,
and a password-protected Developer dashboard with full layout control.
"""

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Any, Dict, List, Optional
from xml.sax.saxutils import escape as xml_escape

import httpx
import requests
from bson import ObjectId
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from dotenv import load_dotenv
from fastapi import (APIRouter, Depends, FastAPI, File, Form, Header,
                     HTTPException, UploadFile)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from emergentintegrations.llm.chat import (FileContentWithMimeType, ImageContent,
                                           LlmChat, StreamDone, TextDelta,
                                           UserMessage)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
DEV_PASSWORD = os.environ["DEV_PASSWORD"]
EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]
APP_MASTER_KEY = base64.b64decode(os.environ["APP_MASTER_KEY"])
EMERGENT_AUTH_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"

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
    avatar_path: Optional[str] = None  # object-storage path for the character photo


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
    "6. If you do not know something, say so briefly and politely in Kashmiri.\n"
    "7. If the user attaches a photo or PDF, look at it carefully and answer their question "
    "about it in Kashmiri."
)

DEFAULT_VOICE_MODELS: List[VoiceModel] = [
    VoiceModel(id="male-1", label="مَرٕد آواز ۱", gender="male", provider="sarvam",
               voice_id="abhilash", language_code="ks-IN", model_name="bulbul:v3"),
    VoiceModel(id="female-1", label="زَنان آواز ۱", gender="female", provider="sarvam",
               voice_id="anushka", language_code="ks-IN", model_name="bulbul:v3"),
    VoiceModel(id="male-azure", label="مَرٕد آواز ۲", gender="male", provider="azure",
               voice_id="ks-IN-MaleNeural", language_code="ks-IN", model_name=""),
    VoiceModel(id="female-azure", label="زَنان آواز ۲", gender="female", provider="azure",
               voice_id="ks-IN-FemaleNeural", language_code="ks-IN", model_name=""),
    VoiceModel(id="male-el", label="مَرٕد آواز ۳", gender="male", provider="elevenlabs",
               voice_id="TxGEqnHWrfWFTfGW9XjX", language_code="ks-IN",
               model_name="eleven_multilingual_v2"),
    VoiceModel(id="female-el", label="زَنان آواز ۳", gender="female", provider="elevenlabs",
               voice_id="21m00Tcm4TlvDq8ikWAM", language_code="ks-IN",
               model_name="eleven_multilingual_v2"),
]

DEFAULT_FEATURES = {
    "voice_mode": True,
    "attachments": True,
    "auto_speak": True,
    "input_switcher": True,
    "show_tagline": True,
}


class Settings(BaseDocument):
    app_name: str = "Kosher AI"
    tagline: str = "کٲشُر ؤاژ ایسِسٹینٹ"
    logo_position: str = "left"  # left | center | right
    llm_model: str = "gpt-5.4"
    vision_model: str = "gemini-2.5-flash"  # used when attachments are present
    system_prompt: str = DEFAULT_SYSTEM_PROMPT
    stt_provider: str = "sarvam"
    tts_provider: str = "sarvam"
    voice_models: List[VoiceModel] = DEFAULT_VOICE_MODELS
    active_voice_model_id: str = "female-1"
    features: Dict[str, bool] = Field(default_factory=lambda: dict(DEFAULT_FEATURES))
    keys_enc: Dict[str, dict] = Field(default_factory=dict)
    logo_path: Optional[str] = None
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Attachment(BaseModel):
    id: str
    kind: str  # image | pdf | file
    name: str
    mime: str
    storage_path: str


class ChatMessage(BaseDocument):
    user_id: Optional[str] = None
    conversation_id: str = "guest"
    session_id: str = "main"
    role: str
    text: str
    attachments: List[Attachment] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    deleted_at: Optional[datetime] = None


class Conversation(BaseDocument):
    user_id: Optional[str] = None
    title: str = "نۆو گٲپھ"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    deleted_at: Optional[datetime] = None


class User(BaseModel):
    user_id: str
    email: str
    name: str = ""
    picture: str = ""


SETTINGS_ID = "settings"
KEY_FIELDS = ["sarvam_api_key", "azure_api_key", "azure_region", "elevenlabs_api_key", "openai_api_key"]
TTS_PROVIDERS = {"sarvam", "azure", "elevenlabs"}
STT_PROVIDERS = {"sarvam", "azure"}
STORAGE_APP = "kosher-ai"


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
# Secret envelope (AES-GCM)
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
# Emergent Object Storage
# ---------------------------------------------------------------------------

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
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
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


@app.on_event("startup")
async def startup():
    try:
        await run_in_threadpool(init_storage)
        logger.info("object storage initialised")
    except Exception as e:
        logger.warning("object storage init failed: %s", e)
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("user_id", unique=True)
        await db.user_sessions.create_index("session_token", unique=True)
        await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    except Exception as e:
        logger.warning("index setup failed: %s", e)


# ---------------------------------------------------------------------------
# Auth (Emergent Google) + optional-user dependency
# ---------------------------------------------------------------------------

async def _user_from_token(token: str) -> Optional[User]:
    if not token:
        return None
    sess = await db.user_sessions.find_one({"session_token": token})
    if not sess:
        return None
    exp = sess.get("expires_at")
    if exp is not None:
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < datetime.now(timezone.utc):
            return None
    doc = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
    if not doc:
        return None
    return User(**doc)


def _bearer(authorization: str) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return ""


async def optional_user(authorization: str = Header(default="")) -> Optional[User]:
    return await _user_from_token(_bearer(authorization))


async def require_user(authorization: str = Header(default="")) -> User:
    user = await _user_from_token(_bearer(authorization))
    if not user:
        raise HTTPException(401, "Not authenticated")
    return user


class SessionIn(BaseModel):
    session_id: str = Field(min_length=1, max_length=500)


@api_router.post("/auth/session")
async def auth_session(body: SessionIn):
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(EMERGENT_AUTH_URL, headers={"X-Session-ID": body.session_id})
    if r.status_code != 200:
        raise HTTPException(401, "Invalid or expired session")
    data = r.json()
    email = (data.get("email") or "").lower()
    if not email:
        raise HTTPException(401, "No email in session data")
    session_token = data["session_token"]
    existing = await db.users.find_one({"email": email})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": data.get("name", existing.get("name", "")),
                      "picture": data.get("picture", existing.get("picture", ""))}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": data.get("name", ""),
            "picture": data.get("picture", ""),
            "created_at": datetime.now(timezone.utc),
        })
    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
    })
    doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"session_token": session_token, "user": User(**doc).model_dump()}


@api_router.get("/auth/me")
async def auth_me(user: User = Depends(require_user)):
    return user.model_dump()


@api_router.post("/auth/logout")
async def auth_logout(authorization: str = Header(default="")):
    token = _bearer(authorization)
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Public config
# ---------------------------------------------------------------------------

def _public_voice(vm: VoiceModel) -> dict:
    d = vm.model_dump()
    d["avatar_url"] = f"/api/files/voice/{vm.id}" if vm.avatar_path else None
    return d


@api_router.get("/health")
async def health():
    return {"ok": True, "app": "kosher-ai", "time": datetime.now(timezone.utc).isoformat()}


@api_router.get("/config")
async def config():
    s = await get_settings()
    keys = await get_keys()
    return {
        "app_name": s.app_name,
        "tagline": s.tagline,
        "logo_position": s.logo_position,
        "features": {**DEFAULT_FEATURES, **s.features},
        "voice_models": [_public_voice(vm) for vm in s.voice_models],
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


# ---------------------------------------------------------------------------
# Conversations + history
# ---------------------------------------------------------------------------

def _scope(user: Optional[User], conversation_id: str) -> dict:
    q: dict = {"deleted_at": None, "conversation_id": conversation_id}
    q["user_id"] = user.user_id if user else None
    return q


@api_router.get("/conversations")
async def list_conversations(user: User = Depends(require_user)):
    docs = await db.conversations.find(
        {"user_id": user.user_id, "deleted_at": None}
    ).sort("updated_at", -1).to_list(100)
    return [Conversation.from_mongo(d) for d in docs]


@api_router.post("/conversations")
async def create_conversation(user: User = Depends(require_user)):
    conv = Conversation(user_id=user.user_id)
    await db.conversations.insert_one(conv.to_mongo())
    return Conversation.from_mongo(await db.conversations.find_one({"_id": ObjectId(conv.id)}))


@api_router.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, user: User = Depends(require_user)):
    now = datetime.now(timezone.utc)
    await db.conversations.update_one(
        {"_id": ObjectId(conversation_id), "user_id": user.user_id}, {"$set": {"deleted_at": now}}
    )
    await db.messages.update_many(
        {"conversation_id": conversation_id, "user_id": user.user_id}, {"$set": {"deleted_at": now}}
    )
    return {"ok": True}


@api_router.get("/history")
async def history(conversation_id: str = "guest", limit: int = 200,
                  user: Optional[User] = Depends(optional_user)):
    limit = max(1, min(limit, 300))
    docs = await db.messages.find(_scope(user, conversation_id)).sort("created_at", -1).to_list(limit)
    docs.reverse()
    return [ChatMessage.from_mongo(d) for d in docs]


@api_router.post("/chat/clear")
async def clear_chat(conversation_id: str = "guest", user: Optional[User] = Depends(optional_user)):
    await db.messages.update_many(
        _scope(user, conversation_id), {"$set": {"deleted_at": datetime.now(timezone.utc)}}
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Attachments
# ---------------------------------------------------------------------------

def _kind_for(mime: str) -> str:
    if mime.startswith("image/"):
        return "image"
    if mime == "application/pdf":
        return "pdf"
    return "file"


@api_router.post("/attachments/upload")
async def upload_attachment(file: UploadFile = File(...),
                            user: Optional[User] = Depends(optional_user)):
    data = await file.read()
    if len(data) > 15_000_000:
        raise HTTPException(413, "File too large (max 15MB)")
    mime = file.content_type or "application/octet-stream"
    kind = _kind_for(mime)
    if kind == "file" and mime != "text/plain" and mime != "text/csv":
        raise HTTPException(415, "Only images, PDF, TXT or CSV files are supported")
    ext = (file.filename or "file").split(".")[-1][:8] if "." in (file.filename or "") else "bin"
    owner = user.user_id if user else "guest"
    path = f"{STORAGE_APP}/uploads/{owner}/{uuid.uuid4().hex}.{ext}"
    await run_in_threadpool(put_object, path, data, mime)
    att = Attachment(id=uuid.uuid4().hex, kind=kind, name=file.filename or "file",
                     mime=mime, storage_path=path)
    await db.attachments.insert_one({**att.model_dump(), "owner": owner,
                                     "created_at": datetime.now(timezone.utc)})
    return {**att.model_dump(), "url": f"/api/files/attachment/{att.id}"}


@api_router.get("/files/attachment/{attachment_id}")
async def file_attachment(attachment_id: str):
    doc = await db.attachments.find_one({"id": attachment_id})
    if not doc:
        raise HTTPException(404, "Attachment not found")
    try:
        data, ct = await run_in_threadpool(get_object, doc["storage_path"])
    except Exception:
        raise HTTPException(404, "Attachment not found")
    return Response(content=data, media_type=ct)


# ---------------------------------------------------------------------------
# Chat (streaming)
# ---------------------------------------------------------------------------

class ChatIn(BaseModel):
    text: str = Field(default="", max_length=6000)
    conversation_id: str = "guest"
    attachment_ids: List[str] = Field(default_factory=list)


@api_router.post("/chat")
async def chat(body: ChatIn, user: Optional[User] = Depends(optional_user)):
    s = await get_settings()
    keys = await get_keys()
    text = body.text.strip()

    att_docs: List[dict] = []
    if body.attachment_ids:
        att_docs = await db.attachments.find({"id": {"$in": body.attachment_ids}}).to_list(10)
    if not text and not att_docs:
        raise HTTPException(422, "text or an attachment is required")

    has_attachments = len(att_docs) > 0
    llm_key = keys.get("openai_api_key") or EMERGENT_LLM_KEY
    if has_attachments:
        provider, model_name = "gemini", s.vision_model
        llm_key = EMERGENT_LLM_KEY  # vision routed through the universal key
    else:
        provider, model_name = "openai", s.llm_model

    history_docs = await db.messages.find(
        _scope(user, body.conversation_id)
    ).sort("created_at", -1).to_list(16)
    history = [
        {"role": d["role"], "content": d["text"]}
        for d in reversed(history_docs)
        if d.get("role") in ("user", "assistant") and d.get("text")
    ]
    messages = [{"role": "system", "content": s.system_prompt}] + history

    attachments_meta = [
        Attachment(id=d["id"], kind=d["kind"], name=d["name"], mime=d["mime"],
                   storage_path=d["storage_path"])
        for d in att_docs
    ]

    user_doc = ChatMessage(user_id=user.user_id if user else None,
                           conversation_id=body.conversation_id,
                           role="user", text=text, attachments=attachments_meta)
    await db.messages.insert_one(user_doc.to_mongo())
    if user:
        await db.conversations.update_one(
            {"_id": ObjectId(body.conversation_id)} if ObjectId.is_valid(body.conversation_id) else {"_id": None},
            {"$set": {"updated_at": datetime.now(timezone.utc)},
             "$setOnInsert": {"title": text[:40] or "نۆو گٲپھ"}},
        )

    # build file contents (download to temp files for the SDK)
    tmp_paths: List[str] = []
    file_contents: List[Any] = []
    for d in att_docs:
        try:
            raw, ct = await run_in_threadpool(get_object, d["storage_path"])
            suffix = "." + (d["name"].split(".")[-1] if "." in d["name"] else "bin")
            fd, tmp = tempfile.mkstemp(suffix=suffix)
            with os.fdopen(fd, "wb") as fh:
                fh.write(raw)
            tmp_paths.append(tmp)
            if d["kind"] == "image":
                file_contents.append(ImageContent(image_base64=base64.b64encode(raw).decode()))
            else:
                file_contents.append(FileContentWithMimeType(file_path=tmp, mime_type=d["mime"]))
        except Exception:
            logger.exception("attachment load failed")

    async def event_stream():
        parts: List[str] = []
        try:
            chat_obj = LlmChat(
                api_key=llm_key,
                session_id=f"kosher-{uuid.uuid4().hex}",
                system_message=s.system_prompt,
                initial_messages=messages,
            ).with_model(provider, model_name)
            um = UserMessage(text=text or "یہٕ فایل چھِ وُچھِتھ کٲشُر منز جواب دِیو۔",
                             file_contents=file_contents or None)
            async for ev in chat_obj.stream_message(um):
                if isinstance(ev, TextDelta):
                    parts.append(ev.content)
                    yield f"data: {json.dumps({'type': 'delta', 'content': ev.content}, ensure_ascii=False)}\n\n"
                elif isinstance(ev, StreamDone):
                    break
            reply = "".join(parts).strip()
            if not reply:
                raise RuntimeError("empty reply from model")
            doc = ChatMessage(user_id=user.user_id if user else None,
                              conversation_id=body.conversation_id, role="assistant", text=reply)
            await db.messages.insert_one(doc.to_mongo())
            yield f"data: {json.dumps({'type': 'done', 'message_id': str(doc.id), 'reply': reply}, ensure_ascii=False)}\n\n"
        except HTTPException as e:
            yield f"data: {json.dumps({'type': 'error', 'detail': e.detail}, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.exception("chat stream failed")
            yield f"data: {json.dumps({'type': 'error', 'detail': str(e)[:300]}, ensure_ascii=False)}\n\n"
        finally:
            for p in tmp_paths:
                try:
                    os.unlink(p)
                except Exception:
                    pass

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# STT
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
        async with httpx.AsyncClient(timeout=120) as c:
            r = await c.post(
                "https://api.sarvam.ai/speech-to-text",
                headers={"api-subscription-key": key},
                files={"file": (file.filename or "audio.m4a", data, file.content_type or "audio/m4a")},
                data={"model": "saaras:v3", "language_code": "ks-IN", "mode": "transcribe"},
            )
            if r.is_error:
                detail = r.text[:300]
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
            raise HTTPException(415, "Azure STT needs 16kHz mono WAV or OGG/OPUS audio. Use Sarvam in Developer Options.")
        url = f"https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1"
        async with httpx.AsyncClient(timeout=120) as c:
            r = await c.post(
                url,
                params={"language": "ks-IN", "format": "detailed"},
                headers={"Ocp-Apim-Subscription-Key": key, "Content-Type": azure_ct, "Accept": "application/json"},
                content=data,
            )
        if r.is_error:
            raise HTTPException(502, f"Azure STT error: {r.text[:300]}")
        j = r.json()
        return {"text": j.get("DisplayText", ""), "provider": "azure"}

    raise HTTPException(400, f"Unsupported STT provider: {provider}")


# ---------------------------------------------------------------------------
# TTS
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
                json={"text": text, "language_code": vm.language_code, "speaker": vm.voice_id,
                      "model": vm.model_name or "bulbul:v3", "speech_sample_rate": 24000,
                      "output_audio_codec": "wav", "temperature": 0.6},
            )
        if r.is_error:
            raise HTTPException(502, f"Sarvam TTS error: {r.text[:300]}")
        audios = r.json().get("audios") or []
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
        return {"mime": "audio/mpeg", "audio_base64": base64.b64encode(r.content).decode(), "voice_model_id": vm.id}

    if vm.provider == "azure":
        key = keys.get("azure_api_key")
        if not key:
            raise HTTPException(400, "Azure Speech key is not configured. Add it in Developer Options.")
        region = keys.get("azure_region") or ""
        endpoint = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
        ssml = (f'<speak version="1.0" xml:lang="{vm.language_code}">'
                f'<voice name="{xml_escape(vm.voice_id)}">{xml_escape(text)}</voice></speak>')
        async with httpx.AsyncClient(timeout=120) as c:
            r = await c.post(endpoint, headers={
                "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3"}, content=ssml.encode())
        if r.is_error:
            raise HTTPException(502, f"Azure TTS error: {r.text[:300]}")
        return {"mime": "audio/mpeg", "audio_base64": base64.b64encode(r.content).decode(), "voice_model_id": vm.id}

    raise HTTPException(400, f"Unsupported TTS provider: {vm.provider}")


@api_router.post("/tts")
async def tts(body: TtsIn):
    s = await get_settings()
    keys = await get_keys()
    vm = await _resolve_voice_model(s, body.voice_model_id)
    return await _tts(body.text, vm, keys)


# ---------------------------------------------------------------------------
# Developer options
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


async def _dev_view(s: Settings) -> dict:
    keys = await get_keys()
    return {
        "app_name": s.app_name,
        "tagline": s.tagline,
        "logo_position": s.logo_position,
        "features": {**DEFAULT_FEATURES, **s.features},
        "llm_model": s.llm_model,
        "vision_model": s.vision_model,
        "system_prompt": s.system_prompt,
        "stt_provider": s.stt_provider,
        "tts_provider": s.tts_provider,
        "voice_models": [_public_voice(vm) for vm in s.voice_models],
        "active_voice_model_id": s.active_voice_model_id,
        "logo_path": "/api/files/logo" if s.logo_path else None,
        "keys": {name: DevKeyInfo(configured=bool(keys.get(name)),
                                  preview=_mask(keys.get(name) or "")).model_dump()
                 for name in KEY_FIELDS},
    }


@api_router.get("/dev/settings", dependencies=[Depends(require_dev)])
async def dev_get_settings():
    return await _dev_view(await get_settings())


class DevSettingsIn(BaseModel):
    app_name: Optional[str] = None
    tagline: Optional[str] = None
    logo_position: Optional[str] = None
    llm_model: Optional[str] = None
    vision_model: Optional[str] = None
    system_prompt: Optional[str] = None
    stt_provider: Optional[str] = None
    tts_provider: Optional[str] = None
    active_voice_model_id: Optional[str] = None
    voice_models: Optional[List[VoiceModel]] = None
    features: Optional[Dict[str, bool]] = None
    keys: Optional[Dict[str, str]] = None


@api_router.put("/dev/settings", dependencies=[Depends(require_dev)])
async def dev_put_settings(body: DevSettingsIn):
    s = await get_settings()
    if body.app_name is not None and body.app_name.strip():
        s.app_name = body.app_name.strip()
    if body.tagline is not None:
        s.tagline = body.tagline.strip()
    if body.logo_position in ("left", "center", "right"):
        s.logo_position = body.logo_position
    if body.llm_model:
        s.llm_model = body.llm_model.strip()
    if body.vision_model:
        s.vision_model = body.vision_model.strip()
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
        # preserve avatar_path from existing models when the client omits it
        existing = {vm.id: vm.avatar_path for vm in s.voice_models}
        for vm in body.voice_models:
            if vm.avatar_path is None and vm.id in existing:
                vm.avatar_path = existing[vm.id]
        s.voice_models = body.voice_models
    if body.active_voice_model_id:
        if not any(vm.id == body.active_voice_model_id for vm in s.voice_models):
            raise HTTPException(422, "active_voice_model_id not found in voice_models")
        s.active_voice_model_id = body.active_voice_model_id
    if body.features is not None:
        s.features = {**DEFAULT_FEATURES, **s.features, **body.features}
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
    return await _tts("آسلام! یِہ چھِ کوشَر اے آءی."[:120], vm, keys)


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


@api_router.post("/dev/voice/{voice_id}/avatar", dependencies=[Depends(require_dev)])
async def dev_upload_voice_avatar(voice_id: str, file: UploadFile = File(...)):
    ct = file.content_type or "image/png"
    if not ct.startswith("image/"):
        raise HTTPException(415, "Only image files are allowed")
    data = await file.read()
    if len(data) > 5_000_000:
        raise HTTPException(413, "Image too large (max 5MB)")
    s = await get_settings()
    vm = next((v for v in s.voice_models if v.id == voice_id), None)
    if not vm:
        raise HTTPException(404, "Voice model not found")
    ext = "png" if "png" in ct else "jpg"
    path = f"{STORAGE_APP}/uploads/voice/{voice_id}/{uuid.uuid4().hex}.{ext}"
    await run_in_threadpool(put_object, path, data, ct)
    vm.avatar_path = path
    await save_settings(s)
    return {"ok": True, "avatar_url": f"/api/files/voice/{voice_id}"}


@api_router.get("/files/logo")
async def logo_file():
    s = await get_settings()
    if not s.logo_path:
        raise HTTPException(404, "No custom logo set")
    try:
        data, ct = await run_in_threadpool(get_object, s.logo_path)
    except Exception:
        raise HTTPException(404, "Logo not found")
    return Response(content=data, media_type=ct, headers={"Cache-Control": "no-store"})


@api_router.get("/files/voice/{voice_id}")
async def voice_avatar_file(voice_id: str):
    s = await get_settings()
    vm = next((v for v in s.voice_models if v.id == voice_id), None)
    if not vm or not vm.avatar_path:
        raise HTTPException(404, "No avatar set")
    try:
        data, ct = await run_in_threadpool(get_object, vm.avatar_path)
    except Exception:
        raise HTTPException(404, "Avatar not found")
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