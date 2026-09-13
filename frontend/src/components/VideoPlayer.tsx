import { useEffect, useRef, useState } from "react";

interface VideoPlayerProps {
  src: string;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number) => void;
}

function estEmbarquable(url: string): boolean {
  return (
    /(?:youtube-nocookie\.com|youtube\.com)\/embed\//i.test(url) ||
    /facebook\.com\/plugins\/video\.php/i.test(url)
  );
}

export default function VideoPlayer({ src, onEnded, onTimeUpdate }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideControlsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [enErreur, setEnErreur] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    return () => {
      if (hideControlsTimeout.current) clearTimeout(hideControlsTimeout.current);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(0);
    setDuration(0);
    setAspectRatio(null);
    setIsPlaying(false);
    setIsBuffering(false);
    setShowControls(true);
    setEnErreur(false);
    video.load();
  }, [src]);

  function handleLoadedMetadata(e: React.SyntheticEvent<HTMLVideoElement>) {
    const video = e.currentTarget;
    setDuration(video.duration);
    setAspectRatio(video.videoWidth / video.videoHeight);
  }

  function togglePlay() {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
  }

  function toggleFullscreen() {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  function handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (videoRef.current) videoRef.current.volume = newVolume;
    setIsMuted(newVolume === 0);
  }

  function toggleMute() {
    if (!videoRef.current) return;
    const newMuted = !isMuted;
    videoRef.current.muted = newMuted;
    setIsMuted(newMuted);
    if (!newMuted && volume === 0) {
      setVolume(1);
      if (videoRef.current) videoRef.current.volume = 1;
    }
  }

  function adjustVolume(delta: number) {
    if (!videoRef.current) return;
    const newVolume = Math.min(1, Math.max(0, volume + delta));
    setVolume(newVolume);
    videoRef.current.volume = newVolume;
    setIsMuted(newVolume === 0);
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    if (!videoRef.current || duration === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    videoRef.current.currentTime = percentage * duration;
  }

  function skipTime(delta: number) {
    if (!videoRef.current) return;
    const newTime = Math.min(duration, Math.max(0, currentTime + delta));
    videoRef.current.currentTime = newTime;
  }

  function revealControls() {
    setShowControls(true);
    if (hideControlsTimeout.current) clearTimeout(hideControlsTimeout.current);
    hideControlsTimeout.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 2500);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    revealControls();

    switch (e.key) {
      case " ":
        e.preventDefault();
        togglePlay();
        break;
      case "ArrowRight":
        e.preventDefault();
        skipTime(5);
        break;
      case "ArrowLeft":
        e.preventDefault();
        skipTime(-5);
        break;
      case "ArrowUp":
        e.preventDefault();
        adjustVolume(0.1);
        break;
      case "ArrowDown":
        e.preventDefault();
        adjustVolume(-0.1);
        break;
      case "m":
      case "M":
        toggleMute();
        break;
      case "f":
      case "F":
        toggleFullscreen();
        break;
    }
  }

  function handleMouseMove() {
    revealControls();
  }

  function handleMouseLeave() {
    if (hideControlsTimeout.current) clearTimeout(hideControlsTimeout.current);
    if (isPlaying) setShowControls(false);
  }

  function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;
  const isVertical = aspectRatio !== null && aspectRatio < 1;

  if (estEmbarquable(src)) {
    return (
      <div className="relative w-full mx-auto rounded-lg overflow-hidden bg-black aspect-video">
        <iframe
          src={src}
          title="Extrait vidéo à vérifier"
          className="w-full h-full"
          allow="encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="relative w-full mx-auto rounded-lg overflow-hidden bg-black outline-none"
      style={{
        aspectRatio: aspectRatio ?? 16 / 9,
        maxWidth: isVertical ? "28rem" : "42rem",
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full object-cover cursor-pointer"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={(e) => {
          setCurrentTime(e.currentTarget.currentTime);
          onTimeUpdate?.(e.currentTarget.currentTime);
        }}
        onEnded={onEnded}
        onError={() => setEnErreur(true)}
      />

      {enErreur && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 text-center px-4">
          <p className="text-white/80 text-sm">Cette vidéo n'est plus disponible.</p>
          <p className="text-white/40 text-xs">Signale-la pour qu'on la retire de la partie.</p>
        </div>
      )}

      {isBuffering && !enErreur && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      )}

      <div
        className={`absolute bottom-0 left-0 right-0 bg-black/60 p-3 flex items-center gap-3 transition-opacity duration-300 ${
          showControls ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <button
          onClick={togglePlay}
          className="text-white text-xl w-8 h-8 flex items-center justify-center shrink-0"
          aria-label={isPlaying ? "Pause" : "Lecture"}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>

        <div
          onClick={handleSeek}
          role="slider"
          tabIndex={0}
          aria-label="Progression de la vidéo"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={currentTime}
          aria-valuetext={`${formatTime(currentTime)} sur ${formatTime(duration)}`}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") {
              e.preventDefault();
              skipTime(5);
            }
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              skipTime(-5);
            }
          }}
          className="flex-1 h-2 bg-white/30 rounded cursor-pointer relative"
        >
          <div
            className="h-full bg-white rounded"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>

        <span className="text-white text-sm whitespace-nowrap shrink-0">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={toggleMute}
            className="text-white text-lg"
            aria-label={isMuted ? "Réactiver le son" : "Couper le son"}
          >
            {isMuted || volume === 0 ? "🔇" : "🔊"}
          </button>
          <input
            id="volume"
            name="volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="w-16"
            aria-label="Volume"
          />
        </div>

        <button
          onClick={toggleFullscreen}
          className="text-white text-lg shrink-0"
          aria-label={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
        >
          {isFullscreen ? "⤡" : "⤢"}
        </button>
      </div>
    </div>
  );
}
