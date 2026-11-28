"""Narration for cinema reels with free neural voices (Microsoft Edge, edge-tts), with word timings.

stdin: {"voice": "...", "rate": "+0%", "pitch": "-4Hz", "lines": ["...", ...], "out": "dir"}
writes out/line<i>.mp3 and prints JSON [{"words": [{"w","s","d"}...]}...] on stdout.
"""
import asyncio, json, os, sys

async def main():
    import edge_tts
    job = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    out = []
    for i, text in enumerate(job["lines"]):
        c = edge_tts.Communicate(text, job.get("voice") or "ar-SA-HamedNeural", rate=job.get("rate", "+0%"), pitch=job.get("pitch", "-4Hz"), boundary="WordBoundary")
        words = []
        with open(os.path.join(job["out"], f"line{i}.mp3"), "wb") as f:
            async for ch in c.stream():
                if ch["type"] == "audio":
                    f.write(ch["data"])
                elif ch["type"] == "WordBoundary":
                    words.append({"w": ch["text"], "s": round(ch["offset"] / 1e7, 3), "d": round(ch["duration"] / 1e7, 3)})
        out.append({"words": words})
    sys.stdout.buffer.write(json.dumps(out, ensure_ascii=False).encode("utf-8"))

asyncio.run(main())
