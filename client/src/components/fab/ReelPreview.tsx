import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { audioBufferToWav } from "@/lib/render/audio";
import { drawFrame, ensureFonts, makeFrameCache, type BgSource } from "@/lib/render/draw";
import type { PreparedReel } from "@/lib/render/prepare";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Timecode } from "./common";

export default function ReelPreview({ prepared }: { prepared: PreparedReel }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const cache = useMemo(() => makeFrameCache(prepared.spec), [prepared]);
  const audioUrl = useMemo(() => URL.createObjectURL(audioBufferToWav(prepared.audio)), [prepared]);
  const videoUrl = useMemo(() => (prepared.videoBlob ? URL.createObjectURL(prepared.videoBlob) : null), [prepared]);

  useEffect(
    () => () => {
      URL.revokeObjectURL(audioUrl);
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    },
    [audioUrl, videoUrl],
  );

  const draw = (time: number) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    let video: BgSource | null = null;
    const v = videoRef.current;
    if (v && v.readyState >= 2) video = { source: v, w: v.videoWidth, h: v.videoHeight };
    drawFrame(ctx, prepared.spec, time, cache, prepared.images, video);
  };

  useEffect(() => {
    let cancelled = false;
    ensureFonts(prepared.spec.look.font).then(() => !cancelled && draw(0));
    if (videoUrl) {
      const v = document.createElement("video");
      v.src = videoUrl;
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      v.addEventListener("loadeddata", () => draw(audioRef.current?.currentTime ?? 0));
      v.addEventListener("seeked", () => draw(audioRef.current?.currentTime ?? 0));
      videoRef.current = v;
    } else videoRef.current = null;
    setT(0);
    setPlaying(false);
    return () => {
      cancelled = true;
      videoRef.current?.pause();
    };
  }, [prepared]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = audioRef.current;
      if (!a) return;
      const time = a.currentTime;
      const v = videoRef.current;
      if (v && prepared.spec.bg.kind === "video") {
        const vd = prepared.spec.bg.videoDuration;
        if (time < vd - 0.05) {
          if (v.paused) void v.play().catch(() => undefined);
          if (Math.abs(v.currentTime - time) > 0.2) v.currentTime = time;
        } else if (!v.paused) v.pause();
      }
      draw(time);
      setT(time);
      if (a.ended || time >= prepared.spec.duration) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, prepared]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      videoRef.current?.pause();
      setPlaying(false);
    } else {
      if (a.currentTime >= prepared.spec.duration - 0.05) a.currentTime = 0;
      await a.play();
      setPlaying(true);
    }
  };

  const seek = (time: number) => {
    const a = audioRef.current;
    if (a) a.currentTime = time;
    const v = videoRef.current;
    if (v && prepared.spec.bg.kind === "video") v.currentTime = Math.min(time, Math.max(0, prepared.spec.bg.videoDuration - 0.05));
    setT(time);
    draw(time);
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-full max-w-[300px] overflow-hidden rounded-[18px] border-[6px] border-black bg-black shadow-2xl">
        <canvas ref={canvasRef} width={prepared.spec.width} height={prepared.spec.height} className="block aspect-[9/16] w-full" />
      </div>
      <audio ref={audioRef} src={audioUrl} preload="auto" onEnded={() => setPlaying(false)} />
      <div className="flex w-full max-w-[300px] items-center gap-2">
        <Button size="icon-sm" onClick={toggle} aria-label="تشغيل / إيقاف">
          {playing ? <Pause /> : <Play />}
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => seek(0)} aria-label="من البداية">
          <RotateCcw />
        </Button>
        <Slider value={[t]} min={0} max={prepared.spec.duration} step={1 / 30} onValueChange={v => seek(v[0])} className="flex-1" dir="ltr" />
        <span className="text-[11px] text-muted-foreground">
          <Timecode seconds={t} />
        </span>
      </div>
    </div>
  );
}
