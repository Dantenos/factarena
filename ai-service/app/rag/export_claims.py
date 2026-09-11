"""Génère un lot de claims ÉDITORIALES pour le jeu, depuis l'API Google Fact Check.

POURQUOI ce script (et sa frontière) : la base ne contient que 4 claims, ce qui
ne permet pas une manche jouable. Ici je PRODUIS les données ; c'est le Back Core
qui les importe (`npm run claims:import`). Je ne touche pas à sa base : je sors un
fichier JSON dans MON dossier, il le récupère quand il veut.

Différence avec `ingest_claimreview.py` (à ne pas confondre) :
  - ingest_claimreview.py  -> alimente MON corpus RAG (table rag.documents, vecteurs) ;
  - export_claims.py (ici) -> alimente la table Claim du JEU (clé de réponse).
Même source d'API, deux destinations : c'est la frontière décrite dans app/rag/README.md.

RÈGLE D'OR (app/rag/README.md) : on ne qualifie JAMAIS un propos nous-mêmes. Le
`truthLabel` est TOUJOURS dérivé du verdict rendu par le fact-checkeur. Et si son
verdict est ambigu (« à nuancer », « moitié vrai », « invérifiable »), on JETTE
l'item au lieu de deviner — mieux vaut moins de claims que des claims inventées.

Le format de sortie respecte exactement le validateur du Back Core
(`backend/prisma/import-claims.js`) : sourceKey normalisé, texte de 10 à 1000
caractères, truthLabel TRUE/FALSE, sourceUrl en HTTPS obligatoire.

Lancer :
    docker compose exec ai-service python -m app.rag.export_claims
"""
import hashlib
import json
import os
import re
import time
import unicodedata
from pathlib import Path

import httpx

from app.config import settings

API = "https://factchecktools.googleapis.com/v1alpha1/claims:search"

# Thèmes balayés. Chaque terme devient une `category` côté jeu, ce qui permet
# d'équilibrer un lot (app/rag/README.md, « Équilibrage ») au lieu d'avoir 15 claims sur un sujet.
QUERIES = {
    "vidéo": "viral_debunk",
    "intelligence artificielle": "viral_debunk",
    "élection": "politique_fr",
    "gouvernement": "politique_fr",
    "immigration": "politique_fr",
    "climat": "science",
    "vaccin": "sante",
    "santé": "sante",
}
MAX_AGE_DAYS = int(os.getenv("CLAIMS_MAX_AGE_DAYS", "1825"))  # ~5 ans
PAGES_PER_QUERY = int(os.getenv("CLAIMS_PAGES", "4"))  # 4 x 50 = 200 max par terme

OUT = Path(__file__).resolve().parents[2] / "data" / "editorial-claims.generated.json"

# --- Traduction des verdicts de fact-checkeurs -> label binaire du jeu ---
# Le jeu est binaire (« good news » / « fake news ») : TRUE = l'info est fiable,
# FALSE = tout le reste (faux, trompeur, hors contexte). La nuance est conservée
# pour l'affichage à la révélation, mais le SCORE se joue sur ce booléen.
# On liste des fragments en minuscules SANS accents (le texte est normalisé avant).
FALSE_MARKERS = (
    "faux", "fausse", "fausses", "fake", "false", "incorrect", "incorrecte",
    "errone", "erronee", "trompeur", "trompeuse", "misleading", "infonde",
    "infondee", "sans fondement", "intox", "hoax", "canular", "manipule",
    "manipulee", "altered", "hors contexte", "out of context", "decontextualise",
    "satire", "parodie", "invente", "inventee", "mensonger", "mensongere",
    "pants on fire", "scam", "arnaque", "detourne", "detournee", "truque", "truquee",
)
TRUE_MARKERS = (
    "vrai", "vraie", "true", "correct", "correcte", "exact", "exacte",
    "avere", "averee", "accurate",
)
# Un verdict de fact-checkeur est un LABEL court (« Faux », « Vidéo manipulée »),
# pas un paragraphe. Au-delà de cette longueur, c'est de la prose explicative :
# on la rejette, car y chercher des mots-clés donne des contresens.
# Cas réel rencontré : « La vidéo est fausse. Elle n'a pas été diffusée par la
# BBC, a CONFIRMÉ la chaîne... » -> le mot « confirmé » faisait classer TRUE une
# claim manifestement FAUSSE. Sur la clé de réponse du jeu, c'est inacceptable.
MAX_RATING_LEN = 40
# Verdicts explicitement AMBIGUS : on les écarte plutôt que de trancher à la
# place du fact-checkeur (règle d'or). Testés EN PREMIER.
AMBIGUOUS_MARKERS = (
    "moitie", "half", "mixture", "mixte", "nuance", "a nuancer", "plutot",
    "partiellement", "partly", "mostly", "en partie", "invérifiable",
    "inverifiable", "unproven", "non prouve", "indetermine", "manque de contexte",
    "imprecis", "exagere", "depend",
)


def _strip(text: str) -> str:
    """Minuscule sans accents — pour comparer des verdicts écrits librement."""
    text = text.lower()
    text = unicodedata.normalize("NFD", text)
    return "".join(c for c in text if unicodedata.category(c) != "Mn")


def map_verdict(rating: str) -> str | None:
    """Verdict libre du fact-checkeur -> 'TRUE' / 'FALSE' / None (= à jeter).

    L'ordre compte : on écarte d'abord l'ambigu, sinon « plutôt faux » serait
    capté par le marqueur « faux » alors que le fact-checkeur a justement nuancé.
    """
    r = _strip(rating or "").strip()
    if not r or len(r) > MAX_RATING_LEN:
        return None  # vide, ou prose explicative -> non exploitable
    if any(m in r for m in AMBIGUOUS_MARKERS):
        return None
    # Comparaison au MOT ENTIER : « faux » ne doit pas matcher « fauxbourg »,
    # et surtout on évite les sous-chaînes accidentelles dans un label composé.
    mots = set(re.findall(r"[a-z]+", r))
    if mots & set(FALSE_MARKERS) or any(m in r for m in FALSE_MARKERS if " " in m):
        return "FALSE"
    if mots & set(TRUE_MARKERS):
        return "TRUE"
    return None  # verdict inconnu -> on ne devine pas


def make_source_key(publisher: str, url: str) -> str:
    """Clé stable et rejouable, au format exigé par l'importeur du Back Core.

    Motif imposé : ^[a-z0-9][a-z0-9:._-]{2,127}$. On préfixe par l'éditeur (pour
    la lisibilité en base) et on suffixe par un hash de l'URL (pour l'unicité et
    l'idempotence : réimporter le même article ne crée pas de doublon).
    """
    slug = re.sub(r"[^a-z0-9]+", "-", _strip(publisher)).strip("-")[:40] or "factcheck"
    digest = hashlib.sha1(url.encode()).hexdigest()[:12]
    key = f"{slug}:{digest}"
    return key if re.match(r"^[a-z0-9][a-z0-9:._-]{2,127}$", key) else f"fc:{digest}"


# Mots vides : on ne veut pas « dans », « pour »... comme mots-thèmes.
STOP = {
    "dans", "pour", "avec", "sans", "sur", "sous", "chez", "vers", "cette", "cet",
    "les", "des", "une", "aux", "que", "qui", "quoi", "dont", "est", "sont", "ete",
    "avoir", "etre", "plus", "moins", "tres", "tout", "tous", "toute", "toutes",
    "leur", "leurs", "nous", "vous", "ils", "elles", "son", "sa", "ses", "par",
    "pas", "ne", "en", "au", "du", "de", "la", "le", "un", "et", "ou", "il", "elle",
}


def theme_tags(text: str, limit: int = 6) -> list[str]:
    """Mots-thèmes CANDIDATS pour le garde-fou anti-spoil (cf. guardrail.py).

    ⚠️ Ce sont des candidats automatiques, à RELIRE : app/rag/README.md prévoit une
    curation humaine. On prend les mots longs et rares, hors mots vides. Ce champ
    est ignoré par l'importeur actuel (la colonne themeTags n'existe pas encore) :
    il sert à préparer le terrain.
    """
    mots = re.findall(r"[a-zA-ZÀ-ÿ']{4,}", text)
    vus, out = set(), []
    for m in mots:
        n = _strip(m)
        if n in STOP or n in vus:
            continue
        vus.add(n)
        out.append(n)
        if len(out) >= limit:
            break
    return out


def _get(client: httpx.Client, params: dict) -> dict:
    """Appel API avec réessais sur 429 (quota) et pépins réseau."""
    for attempt in range(3):
        try:
            resp = client.get(API, params=params, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code != 429 or attempt == 2:
                raise
            time.sleep(2 ** attempt)
        except (httpx.TransportError, json.JSONDecodeError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)
    return {}


def collect() -> tuple[list[dict], dict]:
    """Interroge l'API pour chaque thème et renvoie (claims valides, statistiques)."""
    seen: set[str] = set()
    claims: list[dict] = []
    stats = {"vus": 0, "verdict_ambigu": 0, "url_non_https": 0, "texte_hors_bornes": 0, "doublon": 0}

    with httpx.Client() as client:
        for query, category in QUERIES.items():
            page_token = None
            for _ in range(PAGES_PER_QUERY):
                params = {
                    "query": query, "languageCode": "fr",
                    "maxAgeDays": MAX_AGE_DAYS, "pageSize": 50,
                    "key": settings.google_api_key,
                }
                if page_token:
                    params["pageToken"] = page_token
                data = _get(client, params)

                for claim in data.get("claims", []):
                    stats["vus"] += 1
                    reviews = claim.get("claimReview") or []
                    if not reviews:
                        continue
                    review = reviews[0]
                    url = (review.get("url") or "").strip()
                    text = (claim.get("text") or "").strip()

                    # 1. Le verdict doit être NET (sinon on jette, règle d'or).
                    label = map_verdict(review.get("textualRating", ""))
                    if label is None:
                        stats["verdict_ambigu"] += 1
                        continue
                    # 2. L'importeur du Back Core EXIGE du HTTPS.
                    if not url.startswith("https://"):
                        stats["url_non_https"] += 1
                        continue
                    # 3. Bornes de texte imposées par le validateur.
                    if not (10 <= len(text) <= 1000):
                        stats["texte_hors_bornes"] += 1
                        continue

                    key = make_source_key((review.get("publisher") or {}).get("name", ""), url)
                    if key in seen:
                        stats["doublon"] += 1
                        continue
                    seen.add(key)

                    claims.append({
                        "sourceKey": key,
                        "text": text,
                        "truthLabel": label,
                        "category": category,
                        "sourceUrl": url,
                        # Champs EXTRA (ignorés par l'importeur actuel) : ils
                        # documentent la provenance et préparent themeTags.
                        "_publisher": (review.get("publisher") or {}).get("name", ""),
                        "_rating": review.get("textualRating", ""),
                        "_reviewDate": (review.get("reviewDate") or "")[:10],
                        "themeTags": theme_tags(text),
                    })

                page_token = data.get("nextPageToken")
                if not page_token:
                    break
    return claims, stats


def main() -> None:
    if not settings.google_api_key:
        print("GOOGLE_API_KEY manquante dans .env — impossible d'interroger l'API.")
        return

    print("Interrogation de l'API Google Fact Check...")
    claims, stats = collect()

    if not claims:
        print("Aucune claim exploitable récupérée.")
        return

    # --- Équilibrage (app/rag/README.md) ---
    # Les fact-checkeurs publient très peu de « c'est vrai » : on récupère donc
    # ~95 % de FALSE. Tel quel, le jeu serait cassé — répondre « fake » à tout
    # suffirait à gagner. On plafonne donc les FALSE à 1,5x les TRUE (≈ 60/40).
    # On PERD du volume, mais un lot jouable vaut mieux qu'un gros lot biaisé.
    vrais_l = [c for c in claims if c["truthLabel"] == "TRUE"]
    faux_l = [c for c in claims if c["truthLabel"] == "FALSE"]
    total_brut = len(claims)
    if vrais_l:
        faux_l = faux_l[: int(len(vrais_l) * 1.5)]
    claims = vrais_l + faux_l

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(claims, ensure_ascii=False, indent=2), encoding="utf-8")

    vrais = len(vrais_l)
    faux = len(faux_l)
    print(f"  (équilibrage : {total_brut} claims collectées -> {len(claims)} retenues)")
    print(f"\n{len(claims)} claims écrites dans {OUT}")
    print(f"  répartition : {vrais} TRUE / {faux} FALSE")
    print(f"  par catégorie : ", {c: sum(1 for x in claims if x['category'] == c) for c in set(x['category'] for x in claims)})
    print(f"  écartées : {stats}")
    print("\nCôté Back Core, pour importer :")
    print("  cp ai-service/data/editorial-claims.generated.json backend/prisma/data/editorial-claims.json")
    print("  docker compose exec backend npm run claims:import")


if __name__ == "__main__":
    main()
