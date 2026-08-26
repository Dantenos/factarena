"""Crée des claims de jeu à partir des articles de fact-check QUI ONT une vidéo.

POURQUOI ce script : on avait 61 claims mais seulement 5 avec une vidéo. La
cause n'était pas la plateforme — le corpus référence 118 liens YouTube — mais
le fait que ces articles-là ne correspondaient pas aux claims déjà en base. On
prend donc le problème dans l'autre sens : on part des articles POUR LESQUELS
une vidéo embarquable a été trouvée, et on en fabrique des claims.

Deux fichiers se rencontrent ici :
  - data/video_candidates.tsv, produit par extract_videos.py : article -> vidéo ;
  - le corpus RAG (source='factcheck') : article -> affirmation + verdict.
La clé de jointure est l'URL de l'article.

RÈGLE D'OR (docs/CLAIMS.md §2) : le verdict vient TOUJOURS du fact-checkeur. On
le lit dans la phrase-fait déjà ingérée, et on jette tout ce qui est ambigu
plutôt que de trancher à sa place.

⚠️ FRONTIÈRE : ce script écrit dans la table Claim, qui appartient à Prisma
(Back Core). C'est un amorçage de contenu ; la voie durable reste l'importeur
de claims du back.

Lancer :
    docker compose exec ai-service python -m app.rag.claims_from_videos
"""
import re
import unicodedata
from pathlib import Path
from urllib.parse import quote

from app.db import connect

TSV = Path(__file__).resolve().parents[2] / "data" / "video_candidates.tsv"

YOUTUBE_RE = re.compile(
    r"https?://(?:www\.)?(?:youtube\.com/(?:watch\?v=|embed/|shorts/)|youtu\.be/)([\w-]{6,})",
    re.I,
)
FACEBOOK_RE = re.compile(
    r"https?://(?:www\.)?(?:facebook\.com/[\w.]+/videos/\d+|fb\.watch/[\w-]+)",
    re.I,
)

# La phrase-fait du corpus a une forme stable, produite par ingest_claimreview :
# « Affirmation : « ... » (attribuée à X). Verdict : Y — jugé par Z le date. »
AFFIRMATION_RE = re.compile(r"Affirmation\s*:\s*«\s*(.+?)\s*»", re.S)
VERDICT_RE = re.compile(r"Verdict\s*:\s*(.+?)\s*—", re.S)


def _sans_accents(t: str) -> str:
    t = t.lower()
    t = unicodedata.normalize("NFD", t)
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


# Mêmes règles que export_claims.py : l'ambigu est écarté, et seuls des LABELS
# courts sont acceptés (un verdict rédigé en prose donne des contresens).
AMBIGUS = ("moitie", "half", "mixture", "nuance", "plutot", "partiellement",
           "mostly", "en partie", "inverifiable", "unproven", "imprecis", "exagere")
FAUX = ("faux", "fausse", "fake", "false", "trompeur", "trompeuse", "manipule",
        "manipulee", "infonde", "intox", "canular", "detourne", "truque", "errone")
VRAI = ("vrai", "vraie", "true", "exact", "exacte", "correct", "avere")


def _label(verdict: str) -> str | None:
    v = _sans_accents(verdict).strip()
    if not v or len(v) > 40:
        return None
    if any(m in v for m in AMBIGUS):
        return None
    mots = set(re.findall(r"[a-z]+", v))
    if mots & set(FAUX):
        return "FALSE"
    if mots & set(VRAI):
        return "TRUE"
    return None


def _embed(blob: str) -> str | None:
    ids = YOUTUBE_RE.findall(blob)
    if ids:
        return f"https://www.youtube-nocookie.com/embed/{max(set(ids), key=ids.count)}"
    liens = FACEBOOK_RE.findall(blob)
    if liens:
        cible = max(set(liens), key=liens.count)
        return ("https://www.facebook.com/plugins/video.php?href="
                + quote(cible, safe="") + "&show_text=false")
    return None


def main() -> None:
    if not TSV.exists():
        print(f"{TSV} introuvable — lancer d'abord extract_videos.py.")
        return

    # article -> vidéo embarquable
    videos: dict[str, str] = {}
    for ligne in TSV.read_text(encoding="utf-8").splitlines()[1:]:
        colonnes = ligne.split("\t")
        if len(colonnes) < 3:
            continue
        embed = _embed(" ".join(colonnes[2:]))
        if embed:
            videos[colonnes[1].strip().rstrip("/")] = embed
    print(f"{len(videos)} articles avec une vidéo embarquable.")

    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT url, content FROM documents WHERE source = 'factcheck';")
        documents = cur.fetchall()
        cur.execute('SELECT "sourceUrl" FROM "Claim" WHERE "sourceUrl" IS NOT NULL;')
        deja = {r[0].rstrip("/") for r in cur.fetchall()}

    nouvelles = []
    vus: set[str] = set()
    for url, contenu in documents:
        cle = (url or "").rstrip("/")
        if cle in deja or cle in vus or cle not in videos:
            continue
        affirmation = AFFIRMATION_RE.search(contenu)
        verdict = VERDICT_RE.search(contenu)
        if not affirmation or not verdict:
            continue
        label = _label(verdict.group(1))
        if label is None:
            continue
        texte = affirmation.group(1).strip()
        if not (10 <= len(texte) <= 1000):
            continue
        vus.add(cle)
        # sourceKey doit respecter le motif imposé par l'importeur du back.
        import hashlib
        cle_source = "video:" + hashlib.sha1(cle.encode()).hexdigest()[:16]
        nouvelles.append((cle_source, texte, label, "viral_debunk", url, videos[cle]))

    if not nouvelles:
        print("Aucune claim nouvelle à créer.")
        return

    # ⚠️ L'identifiant doit être un CUID, pas un UUID : le back valide tous les
    # identifiants reçus contre /^c[a-z0-9]{24}$/. Un UUID passe l'insertion
    # sans broncher mais rend la claim inutilisable par l'API — elle serait
    # refusée au moment de composer une manche.
    import secrets
    import string

    alphabet = string.ascii_lowercase + string.digits
    avec_id = [
        ("c" + "".join(secrets.choice(alphabet) for _ in range(24)), *n) for n in nouvelles
    ]

    with connect() as conn, conn.cursor() as cur:
        cur.executemany(
            'INSERT INTO "Claim" (id, "sourceKey", text, "truthLabel", category, '
            '"sourceUrl", "mediaRef", "createdAt") '
            'VALUES (%s, %s, %s, %s::"ClaimTruthLabel", %s, %s, %s, now()) '
            'ON CONFLICT ("sourceKey") DO NOTHING',
            avec_id,
        )
        conn.commit()

    vrais = sum(1 for n in nouvelles if n[2] == "TRUE")
    print(f"{len(nouvelles)} claims créées avec vidéo ({vrais} vraies / {len(nouvelles) - vrais} fausses).")


if __name__ == "__main__":
    main()
