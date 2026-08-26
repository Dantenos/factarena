// Lecteur vidéo du salon, avec contrôles custom (pas le "controls" natif du
// navigateur) pour pouvoir styliser librement. S'adapte automatiquement au
// format de la vidéo (large 16:9 ou vertical façon TikTok/Instagram 9:16) en
// détectant le ratio réel au chargement des métadonnées, plutôt que de le
// figer en dur. La synchronisation multi-joueurs (plusieurs clients sur le
// même timecode) reste à faire une fois le protocole WebSocket fixé avec le
// Back Core.
//
// Props :
// - src          : URL de la vidéo à lire (mock pour l'instant, cf mocks/gameData.ts)
// - onEnded      : callback déclenché à la fin de la vidéo
// - onTimeUpdate : callback déclenché en continu pendant la lecture
import { useEffect, useRef, useState } from "react";

interface VideoPlayerProps {
  src: string;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number) => void;
}

// Reconnaît une URL à embarquer dans une iframe (lecteur de la plateforme)
// plutôt qu'à lire avec la balise <video>.
//
// POURQUOI DEUX MODES : on n'héberge aucune vidéo, les extraits restent chez
// leur plateforme d'origine. YouTube s'embarque dans une iframe PURE — le bruit
// console qu'elle produit est attribué aux domaines Google, jamais au nôtre, ce
// qui protège la contrainte « zéro erreur console » du sujet. La balise <video>
// et ses contrôles custom (tout le code plus bas) restent utiles pour un fichier
// vidéo direct, en développement ou si on héberge un jour un extrait.
//
// ⚠️ Ne pas étendre ça à X, Instagram ou TikTok : ces plateformes exigent de
// charger LEUR script dans notre page, et une erreur de leur code deviendrait
// une erreur sous notre domaine — éliminatoire.
function estEmbarquable(url: string): boolean {
  return (
    /(?:youtube-nocookie\.com|youtube\.com)\/embed\//i.test(url) ||
    // Facebook via plugins/video.php : iframe pure elle aussi, donc même
    // garantie côté console. Beaucoup d'articles de l'AFP renvoient vers
    // Facebook, d'où son intérêt pour la couverture des extraits.
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
  // Ratio largeur/hauteur réel de la vidéo, calculé au chargement des
  // métadonnées. null tant que la vidéo n'a pas encore chargé (on utilise
  // alors un ratio par défaut pour éviter un conteneur qui saute visuellement).
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);

  // Garde isFullscreen synchronisé même si l'utilisateur sort du plein écran
  // avec Échap plutôt qu'avec notre bouton (le navigateur déclenche cet event
  // dans tous les cas, quelle que soit la manière de sortir).
  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Nettoie le timer d'auto-hide si le composant est démonté pendant qu'il
  // est en cours, pour éviter un warning React sur un setState après démontage.
  useEffect(() => {
    return () => {
      if (hideControlsTimeout.current) clearTimeout(hideControlsTimeout.current);
    };
  }, []);

  // Récupère la durée ET le ratio réel de la vidéo dès que ses métadonnées
  // sont disponibles. Le ratio sert à adapter dynamiquement le conteneur
  // (format large ou vertical) sans avoir à le connaître à l'avance.
  function handleLoadedMetadata(e: React.SyntheticEvent<HTMLVideoElement>) {
    const video = e.currentTarget;
    setDuration(video.duration);
    setAspectRatio(video.videoWidth / video.videoHeight);
  }

  // Lance ou met en pause la vidéo selon son état actuel.
  // Appelée par le bouton play/pause, le clic sur la vidéo, et la touche Espace.
  function togglePlay() {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
  }

  // Bascule le lecteur en plein écran (sur le conteneur, pas juste la balise
  // <video>, pour garder nos contrôles custom visibles en plein écran).
  // Appelée par le bouton dédié, la touche F, et le double-clic sur la vidéo.
  function toggleFullscreen() {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  // Applique le volume choisi via le slider à l'élément vidéo, et démute
  // automatiquement si l'utilisateur remonte le volume depuis 0.
  function handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (videoRef.current) videoRef.current.volume = newVolume;
    setIsMuted(newVolume === 0);
  }

  // Coupe ou réactive le son. Si on démute alors que le volume était à 0
  // (cas : l'utilisateur avait baissé le slider jusqu'au bout), on remonte
  // à un volume par défaut pour éviter un démute "silencieux" et confus.
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

  // Change de volume par pas fixe (utilisé par les raccourcis clavier
  // flèche haut/bas). `delta` est positif ou négatif.
  function adjustVolume(delta: number) {
    if (!videoRef.current) return;
    const newVolume = Math.min(1, Math.max(0, volume + delta));
    setVolume(newVolume);
    videoRef.current.volume = newVolume;
    setIsMuted(newVolume === 0);
  }

  // Déplace la lecture au point cliqué sur la barre de progression.
  // Calcule la position du clic en pourcentage de la largeur de la barre,
  // puis convertit ce pourcentage en secondes selon la durée totale.
  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    if (!videoRef.current || duration === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    videoRef.current.currentTime = percentage * duration;
  }

  // Avance ou recule la lecture d'un nombre de secondes fixe (utilisé par
  // les raccourcis clavier flèche gauche/droite, et par la navigation
  // clavier propre à la barre de progression). `delta` est positif ou négatif.
  function skipTime(delta: number) {
    if (!videoRef.current) return;
    const newTime = Math.min(duration, Math.max(0, currentTime + delta));
    videoRef.current.currentTime = newTime;
  }

  // Affiche les contrôles et relance le timer d'auto-hide (2.5s). Appelée à
  // chaque mouvement de souris ET à chaque raccourci clavier, pour que
  // l'utilisateur voie toujours le résultat de son action même si les
  // contrôles étaient cachés.
  function revealControls() {
    setShowControls(true);
    if (hideControlsTimeout.current) clearTimeout(hideControlsTimeout.current);
    hideControlsTimeout.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 2500);
  }

  // Raccourcis clavier, actifs uniquement quand le lecteur a le focus (pas
  // globalement sur la page) pour ne pas interférer avec d'autres zones,
  // comme le champ de saisie du chat.
  // Espace : play/pause · ← / → : ±5s · ↑ / ↓ : volume · M : mute · F : plein écran
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

  // Relance l'affichage des contrôles à chaque mouvement de souris sur le lecteur.
  function handleMouseMove() {
    revealControls();
  }

  // Cache immédiatement les contrôles quand la souris quitte le lecteur,
  // sauf si la vidéo est en pause (l'utilisateur doit toujours pouvoir
  // relancer la lecture facilement).
  function handleMouseLeave() {
    if (hideControlsTimeout.current) clearTimeout(hideControlsTimeout.current);
    if (isPlaying) setShowControls(false);
  }

  // Convertit un nombre de secondes en format affichable "M:SS".
  // Retourne "0:00" si la valeur n'est pas encore disponible (NaN/Infinity),
  // ce qui évite un affichage cassé pendant le chargement de la vidéo.
  function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;
  // Format vertical si le ratio est < 1 (plus haut que large). Sert à
  // ajuster la largeur max du conteneur pour un rendu correct dans les deux cas.
  const isVertical = aspectRatio !== null && aspectRatio < 1;

  // Lecteur de la plateforme : on délègue tout à l'iframe. Ce retour est placé
  // APRÈS tous les hooks, sinon React interdirait l'appel conditionnel.
  //
  // Les contrôles custom ne s'appliquent pas ici : le lecteur YouTube a les
  // siens, et une page tierce ne se pilote pas depuis la nôtre. Les callbacks
  // onEnded/onTimeUpdate ne sont donc pas déclenchés dans ce mode — il faudrait
  // l'API IFrame Player de YouTube, à ajouter seulement si la mécanique de jeu
  // en a réellement besoin.
  if (estEmbarquable(src)) {
    return (
      <div className="relative w-full mx-auto rounded-lg overflow-hidden bg-black aspect-video">
        <iframe
          src={src}
          // title est OBLIGATOIRE pour l'accessibilité : sans lui, un lecteur
          // d'écran annonce une iframe anonyme (et le sujet demande une
          // interface accessible).
          title="Extrait vidéo à vérifier"
          className="w-full h-full"
          // On n'autorise QUE ce dont le lecteur a besoin. Pas d'autoplay :
          // Chrome le bloque avec du son et cela génère un avertissement en
          // console — que le sujet interdit.
          // ⚠️ On déclare le plein écran UNIQUEMENT via `allow`. Cumuler avec
          // l'attribut hérité `allowFullScreen` fait écrire à Chrome « Allow
          // attribute will take precedence over allowfullscreen » — un
          // avertissement attribué à NOTRE bundle, donc à notre domaine, ce que
          // le sujet interdit.
          allow="encrypted-media; picture-in-picture; fullscreen"
          // Empêche la page embarquée de connaître l'URL d'où elle est appelée.
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
        // Ratio par défaut (16:9) tant que les métadonnées ne sont pas
        // chargées, pour éviter un conteneur à hauteur 0 ou un saut visuel
        // une fois la vidéo prête.
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
        // Évite qu'une vidéo manquante ne génère une erreur console non gérée
        // (règle du projet : console toujours propre).
        onError={() => console.warn("Vidéo indisponible")}
      />

      {/* Spinner affiché pendant le buffering (chargement en cours de lecture) */}
      {isBuffering && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* Barre de contrôles custom — cachée après inactivité si la vidéo joue */}
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

        {/* Barre de progression cliquable pour seek, navigable au clavier
            (flèches gauche/droite) une fois focus dessus, avec attributs ARIA
            pour les lecteurs d'écran. */}
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

        {/* Volume */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={toggleMute}
            className="text-white text-lg"
            aria-label={isMuted ? "Réactiver le son" : "Couper le son"}
          >
            {isMuted || volume === 0 ? "🔇" : "🔊"}
          </button>
          <input
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

        {/* Plein écran */}
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