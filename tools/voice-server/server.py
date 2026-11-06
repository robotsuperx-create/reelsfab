#!/usr/bin/env python3
"""
Your own voice as a narration server — an OpenAI-compatible speech endpoint for ReellllLocaL.

    POST /v1/audio/speech   {"model": "...", "input": "النص", "voice": "oussama", "response_format": "wav",
                             "language": "ar", "exaggeration": 0.5, "cfg_weight": 0.5}
    GET  /v1/models         list of voices (one per reference clip in ./voices)

Backends (VOICE_BACKEND):
    chatterbox  Chatterbox Multilingual V3 (MIT, 23 languages incl. Arabic, zero-shot cloning). pip install chatterbox-tts
    audio8      Edge0/Audio8-TTS-Realistic-0.6b (Apache-2.0, 23 languages incl. Arabic). pip install transformers soundfile
    test        a tone sized to the text — checks the plumbing without any model

Voices: drop a clean 10–20 s WAV of the speaker in ./voices/<name>.wav (Audio8 also wants ./voices/<name>.txt with the
exact transcript of that clip). The channel's "voice" field in ReellllLocaL is then <name>.

Run on any machine with a GPU (Kaggle/Colab free tier works) and point the app's "speech" provider at it:
    VOICE_BACKEND=chatterbox VOICE_API_KEY=choose-a-secret python server.py --port 8000
    baseUrl = http://<host>:8000/v1   apiKey = choose-a-secret   format = wav   extraJson = {"language":"ar"}
CPU works too (slow: minutes per scene on a laptop) — narration is cached per scene, so it only has to happen once.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import struct
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VOICES_DIR = Path(os.environ.get("VOICES_DIR", Path(__file__).parent / "voices"))
BACKEND = os.environ.get("VOICE_BACKEND", "chatterbox").lower()
API_KEY = os.environ.get("VOICE_API_KEY", "").strip()
DEFAULT_LANGUAGE = os.environ.get("VOICE_LANGUAGE", "ar")
MAX_CHUNK = int(os.environ.get("VOICE_MAX_CHUNK", "350"))  # characters per model call; long scenes are split by sentence
PAUSE_MS = int(os.environ.get("VOICE_PAUSE_MS", "220"))  # silence between chunks
_lock = threading.Lock()  # one synthesis at a time: the models use the whole GPU/CPU


# ----------------------------------------------------------------------------- audio helpers
def wav_bytes(samples, sample_rate: int) -> bytes:
    """float32/float64 mono samples (numpy array or list) -> 16-bit PCM WAV."""
    import numpy as np

    arr = np.asarray(samples, dtype=np.float32).flatten()
    arr = np.clip(arr, -1.0, 1.0)
    pcm = (arr * 32767).astype("<i2").tobytes()
    header = b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVE" + b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16) + b"data" + struct.pack("<I", len(pcm))
    return header + pcm


def split_text(text: str, limit: int) -> list[str]:
    """Sentence-aware chunks (Arabic and Latin punctuation) no longer than `limit` characters."""
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return [text] if text else []
    parts = re.split(r"(?<=[\.\!\?؟。…])\s+|(?<=[،,;:؛])\s+", text)
    chunks: list[str] = []
    cur = ""
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if len(p) > limit:  # a single very long sentence: cut on words
            words = p.split(" ")
            buf = ""
            for w in words:
                if len(buf) + len(w) + 1 > limit and buf:
                    chunks.append(buf)
                    buf = w
                else:
                    buf = f"{buf} {w}".strip()
            p = buf
        if len(cur) + len(p) + 1 > limit and cur:
            chunks.append(cur)
            cur = p
        else:
            cur = f"{cur} {p}".strip()
    if cur:
        chunks.append(cur)
    return chunks


def voices() -> dict[str, Path]:
    VOICES_DIR.mkdir(parents=True, exist_ok=True)
    return {p.stem: p for p in sorted(VOICES_DIR.glob("*.wav"))}


# ----------------------------------------------------------------------------- backends
class Backend:
    sample_rate = 24000

    def synth(self, text: str, voice_path: Path | None, language: str, opts: dict):  # -> numpy array
        raise NotImplementedError


class TestBackend(Backend):
    """A 220 Hz tone, 0.34 s per word — proves the HTTP contract and the app's cache/render path."""

    def synth(self, text, voice_path, language, opts):
        import numpy as np

        words = len([w for w in text.split() if w])
        n = int(max(1, words * 0.34) * self.sample_rate)
        t = np.arange(n) / self.sample_rate
        return 0.2 * np.sin(2 * np.pi * 220 * t)


class ChatterboxBackend(Backend):
    """Chatterbox Multilingual V3 — github.com/resemble-ai/chatterbox (MIT)."""

    def __init__(self):
        import torch
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS

        device = "cuda" if torch.cuda.is_available() else ("mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() else "cpu")
        print(f"[voice-server] loading Chatterbox Multilingual V3 on {device} …", flush=True)
        self.model = ChatterboxMultilingualTTS.from_pretrained(device=device, t3_model="v3")
        self.sample_rate = int(self.model.sr)
        self.torch = torch

    def synth(self, text, voice_path, language, opts):
        kwargs = {"language_id": language, "exaggeration": float(opts.get("exaggeration", 0.5)), "cfg_weight": float(opts.get("cfg_weight", 0.5))}
        if voice_path:
            kwargs["audio_prompt_path"] = str(voice_path)
        with self.torch.inference_mode():
            wav = self.model.generate(text, **kwargs)
        return wav.squeeze().float().cpu().numpy()


class Audio8Backend(Backend):
    """Edge0/Audio8-TTS-Realistic-0.6b — huggingface.co/Edge0/Audio8-TTS-Realistic-0.6b (Apache-2.0)."""

    def __init__(self):
        import torch
        from transformers import AutoModel, AutoProcessor

        model_id = os.environ.get("AUDIO8_MODEL", "Edge0/Audio8-TTS-Realistic-0.6b")
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.bfloat16 if self.device == "cuda" else torch.float32
        print(f"[voice-server] loading {model_id} on {self.device} …", flush=True)
        self.processor = AutoProcessor.from_pretrained(model_id, trust_remote_code=True)
        self.model = AutoModel.from_pretrained(model_id, trust_remote_code=True, dtype=dtype).eval().to(self.device)
        self.sample_rate = int(self.model.config.codec_sample_rate)
        self.torch = torch

    def synth(self, text, voice_path, language, opts):
        ref_kwargs = {}
        if voice_path:
            import soundfile as sf

            audio, sr = sf.read(str(voice_path))
            transcript_file = voice_path.with_suffix(".txt")
            if not transcript_file.exists():
                raise RuntimeError(f"Audio8 needs the exact transcript of the reference clip in {transcript_file.name}")
            ref_kwargs = {"ref_audio": audio, "ref_sampling_rate": sr, "ref_text": transcript_file.read_text(encoding="utf-8").strip()}
        inputs = self.processor(text=[text], return_tensors="pt", **ref_kwargs)
        inputs = {k: (v.to(self.device) if hasattr(v, "to") else v) for k, v in inputs.items()}
        with self.torch.inference_mode():
            out = self.model.generate(**inputs, max_new_tokens=int(opts.get("max_new_tokens", 2048)), do_sample=True, return_dict_in_generate=True)
            waveforms, lengths = self.model.decode_audio(out.codes)
        return waveforms[0, : int(lengths[0])].float().cpu().numpy()


def make_backend() -> Backend:
    if BACKEND == "test":
        return TestBackend()
    if BACKEND == "chatterbox":
        return ChatterboxBackend()
    if BACKEND == "audio8":
        return Audio8Backend()
    raise SystemExit(f"unknown VOICE_BACKEND={BACKEND} (chatterbox | audio8 | test)")


# ----------------------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    backend: Backend

    def _json(self, status: int, data: dict):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        if not API_KEY:
            return True
        auth = self.headers.get("Authorization", "")
        return auth == f"Bearer {API_KEY}"

    def log_message(self, fmt, *args):  # quieter default log
        sys.stderr.write(f"[voice-server] {self.address_string()} {fmt % args}\n")

    def do_GET(self):
        if not self._authorized():
            return self._json(401, {"error": {"message": "invalid api key"}})
        if self.path.rstrip("/") in ("/v1/models", "/models"):
            names = list(voices().keys())
            return self._json(200, {"object": "list", "data": [{"id": n, "object": "model", "owned_by": "voice-server"} for n in names] + [{"id": f"voice-server-{BACKEND}", "object": "model", "owned_by": "voice-server"}], "backend": BACKEND, "voices": names})
        if self.path.rstrip("/") in ("", "/health", "/v1/health"):
            return self._json(200, {"status": "ok", "backend": BACKEND, "voices": list(voices().keys())})
        self._json(404, {"error": {"message": "not found"}})

    def do_POST(self):
        if not self._authorized():
            return self._json(401, {"error": {"message": "invalid api key"}})
        if self.path.rstrip("/") not in ("/v1/audio/speech", "/audio/speech"):
            return self._json(404, {"error": {"message": "not found"}})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return self._json(400, {"error": {"message": "body must be JSON"}})
        text = str(req.get("input") or "").strip()
        if not text:
            return self._json(400, {"error": {"message": "input is required"}})
        if len(text) > 5000:
            return self._json(400, {"error": {"message": "input too long (max 5000 characters per request)"}})
        fmt = str(req.get("response_format") or "wav").lower()
        if fmt != "wav":
            return self._json(400, {"error": {"message": "only response_format=wav is served; the app converts locally"}})
        voice = str(req.get("voice") or "").strip()
        available = voices()
        voice_path = available.get(voice)
        if voice and not voice_path and voice not in ("default", "alloy"):
            return self._json(400, {"error": {"message": f"unknown voice '{voice}'. Put {voice}.wav in {VOICES_DIR} (10–20 s clean recording). Available: {', '.join(available) or 'none'}"}})
        language = str(req.get("language") or DEFAULT_LANGUAGE)
        opts = {k: req[k] for k in ("exaggeration", "cfg_weight", "max_new_tokens") if k in req}
        started = time.time()
        try:
            import numpy as np

            with _lock:
                pieces = []
                pause = np.zeros(int(self.backend.sample_rate * PAUSE_MS / 1000), dtype=np.float32)
                for i, chunk in enumerate(split_text(text, MAX_CHUNK)):
                    if i:
                        pieces.append(pause)
                    pieces.append(np.asarray(self.backend.synth(chunk, voice_path, language, opts), dtype=np.float32).flatten())
                audio = np.concatenate(pieces) if pieces else np.zeros(1, dtype=np.float32)
            body = wav_bytes(audio, self.backend.sample_rate)
        except Exception as e:  # surfaced to the app as a readable error
            return self._json(500, {"error": {"message": f"{type(e).__name__}: {e}"}})
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Synthesis-Seconds", f"{time.time() - started:.1f}")
        self.end_headers()
        self.wfile.write(body)


def main():
    ap = argparse.ArgumentParser(description="OpenAI-compatible voice-clone speech server for ReellllLocaL")
    ap.add_argument("--host", default=os.environ.get("VOICE_HOST", "0.0.0.0"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("VOICE_PORT", "8000")))
    args = ap.parse_args()
    Handler.backend = make_backend()
    names = list(voices().keys())
    print(f"[voice-server] backend={BACKEND} voices={names or 'none (add voices/<name>.wav)'} key={'set' if API_KEY else 'open'}", flush=True)
    print(f"[voice-server] listening on http://{args.host}:{args.port}/v1  — ReellllLocaL speech provider: baseUrl=http://<this-host>:{args.port}/v1", flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
