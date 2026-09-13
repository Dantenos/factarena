import { useEffect, useState } from "react";

interface ClipProgressBarProps {
  totalClips: number;
  currentClipIndex: number;
  clipDuration: number;
  onClipComplete?: () => void;
}

export default function ClipProgressBar({
  totalClips,
  currentClipIndex,
  clipDuration,
  onClipComplete,
}: ClipProgressBarProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(0);
  }, [currentClipIndex]);

  useEffect(() => {
    if (elapsed >= clipDuration) {
      onClipComplete?.();
      return;
    }
    const interval = setInterval(() => {
      setElapsed((prev) => Math.min(prev + 0.1, clipDuration));
    }, 100);
    return () => clearInterval(interval);
  }, [elapsed, clipDuration, onClipComplete]);

  const currentProgress = clipDuration > 0 ? (elapsed / clipDuration) * 100 : 0;

  return (
    <div
      className="flex gap-1 w-full"
      role="progressbar"
      aria-valuenow={currentClipIndex + 1}
      aria-valuemax={totalClips}
      aria-label={`Clip ${currentClipIndex + 1} sur ${totalClips}`}
    >
      {Array.from({ length: totalClips }).map((_, i) => (
        <div key={i} className="flex-1 h-1.5 rounded-full bg-white/20 overflow-hidden">
          <div
            className="h-full bg-bleu-krystal"
            style={{
              width: i < currentClipIndex ? "100%" : i === currentClipIndex ? `${currentProgress}%` : "0%",
              transition: i === currentClipIndex ? "width 100ms linear" : "none",
            }}
          />
        </div>
      ))}
    </div>
  );
}
