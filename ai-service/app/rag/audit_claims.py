"""Audite les claims du jeu pour ne relire à la main que les plus douteuses.

POURQUOI : relire 83 vidéos une par une est intenable, alors que la plupart des
défauts sont détectables automatiquement. Ce script attribue à chaque claim un
score de suspicion et produit un classement — on relit du plus douteux au plus
sain, et on s'arrête quand c'est propre.

Deux contrôles, tous deux appuyés sur des briques qu'on a déjà.

1. JUGE LLM sur le texte. Une affirmation ne doit jamais annoncer sa propre
   réponse. Mes filtres par expressions régulières attrapaient « alors que c'est
   faux » mais rataient les tournures ironiques et les cadrages de
   fact-checkeur. Un modèle lit ça bien mieux. Effet de bord utile : c'est une
   utilisation supplémentaire et démontrable du module LLM.

2. SIMILARITÉ affirmation / titre de la vidéo, par embeddings. C'est le cas
   « Battlestar Galactica » : l'affirmation parlait d'une attaque nucléaire
   russe, la vidéo s'intitulait « The Cylons Attack the Colonies ». Un article
   de fact-check embarque souvent DEUX vidéos — celle qui circule et celle qui
   prouve le trucage — et rien dans le HTML ne les distingue. Un cosinus entre
   l'affirmation et le titre fait ressortir le décalage.

Le script ne supprime RIEN : il classe. La décision reste humaine.

Sortie : ai-service/data/audit_claims.tsv
Lancer :
    docker compose exec ai-service python -m app.rag.audit_claims
"""
import asyncio
import math
import re
from pathlib import Path
from urllib.parse import unquote

import httpx

from app.db import connect
from app.mistral_client import chat_stream, embed

SORTIE = Path(__file__).resolve().parents[2] / "data" / "audit_claims.tsv"

CONSIGNE = (
    "Tu contrôles la qualité des questions d'un jeu de fact-checking. Le joueur "
    "lit une affirmation et doit deviner si elle est vraie ou fausse.\n"
    "Une affirmation est MAUVAISE si elle laisse deviner la réponse (elle qualifie "
    "déjà le contenu de faux, truqué, généré par IA, authentique, véritable...), "
    "si elle est formulée en question, si elle reprend le point de vue du "
    "vérificateur plutôt que celui de la rumeur, ou si elle est incompréhensible "
    "hors contexte.\n"
    "Réponds UNIQUEMENT par « OK » si l'affirmation est utilisable, ou par "
    "« MAUVAIS: <raison en cinq mots> » sinon."
)


def _cosinus(a: list[float], b: list[float]) -> float:
    produit = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return produit / (na * nb) if na and nb else 0.0


def _titre_video(client: httpx.Client, media: str) -> str:
    """Titre de la vidéo, pour le comparer à l'affirmation.

    YouTube : via oEmbed (aucune clé nécessaire). Commons : le nom de fichier
    est descriptif par convention, on le nettoie. Facebook : rien d'exploitable,
    on renvoie une chaîne vide et la similarité sera ignorée.
    """
    if "/embed/" in media and "youtube" in media:
        vid = media.split("/embed/", 1)[-1].split("?", 1)[0]
        try:
            r = client.get(
                "https://www.youtube.com/oembed",
                params={"url": f"https://www.youtube.com/watch?v={vid}", "format": "json"},
                timeout=20,
            )
            return r.json().get("title", "") if r.status_code == 200 else ""
        except Exception:
            return ""
    if "upload.wikimedia.org" in media:
        nom = unquote(media.split("/")[-1].split("?", 1)[0])
        nom = re.sub(r"\.(webm|ogv|mp4)$", "", nom, flags=re.I)
        return nom.replace("_", " ")
    return ""


async def _juge(texte: str) -> str:
    """Verdict du modèle sur une affirmation. Renvoie '' si le service échoue."""
    messages = [
        {"role": "system", "content": CONSIGNE},
        {"role": "user", "content": f"Affirmation : « {texte} »"},
    ]
    try:
        morceaux = [m async for m in chat_stream(messages)]
        return "".join(morceaux).strip()
    except Exception:
        return ""


async def main() -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT id, "truthLabel", text, "mediaRef" FROM "Claim" '
            'WHERE "mediaRef" IS NOT NULL ORDER BY text'
        )
        claims = cur.fetchall()

    print(f"{len(claims)} claims à auditer...")

    # --- Titres des vidéos ---
    titres = []
    with httpx.Client() as client:
        for i, (_id, _lab, _txt, media) in enumerate(claims, 1):
            titres.append(_titre_video(client, media))
            if i % 20 == 0:
                print(f"  titres {i}/{len(claims)}")

    # --- Similarité affirmation / titre (embeddings groupés) ---
    print("  calcul des similarités...")
    textes = [c[2] for c in claims]
    vecteurs_txt = await embed(textes)
    # Un titre vide fausserait l'embedding : on met un espace et on ignorera.
    vecteurs_ttl = await embed([t or " " for t in titres])
    similarites = [
        _cosinus(vt, vl) if titres[i] else None
        for i, (vt, vl) in enumerate(zip(vecteurs_txt, vecteurs_ttl))
    ]

    # --- Juge LLM sur les textes ---
    print("  jugement des textes par le modèle...")
    verdicts = []
    for i, texte in enumerate(textes, 1):
        verdicts.append(await _juge(texte))
        if i % 10 == 0:
            print(f"  textes {i}/{len(textes)}")

    # --- Score de suspicion ---
    # Deux signaux indépendants. Un texte jugé mauvais est rédhibitoire (poids
    # fort) ; une similarité basse indique une vidéo qui ne colle pas au sujet.
    lignes = []
    for (cid, label, texte, media), titre, sim, verdict in zip(claims, titres, similarites, verdicts):
        mauvais_texte = verdict.upper().startswith("MAUVAIS")
        score = 0.0
        if mauvais_texte:
            score += 1.0
        if sim is not None:
            # 0.75 et plus : sujets manifestement liés. En dessous de 0.55 le
            # décalage est net. On normalise entre les deux.
            score += max(0.0, min(1.0, (0.75 - sim) / 0.20))
        else:
            score += 0.3  # titre inconnu : on ne peut rien affirmer, léger doute
        lignes.append((score, cid, label, texte, titre, sim, verdict))

    lignes.sort(key=lambda x: -x[0])
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    with SORTIE.open("w", encoding="utf-8") as f:
        f.write("score\tid\tlabel\ttexte\ttitre_video\tsimilarite\tverdict_llm\n")
        for score, cid, label, texte, titre, sim, verdict in lignes:
            sim_txt = f"{sim:.3f}" if sim is not None else ""
            f.write(f"{score:.2f}\t{cid}\t{label}\t{texte}\t{titre}\t{sim_txt}\t{verdict}\n")

    suspects = sum(1 for l in lignes if l[0] >= 1.0)
    textes_ko = sum(1 for l in lignes if l[6].upper().startswith("MAUVAIS"))
    print(f"\nAudit écrit dans {SORTIE}")
    print(f"  {textes_ko} textes jugés mauvais par le modèle")
    print(f"  {suspects} claims au score >= 1.0 (à relire en priorité)")


if __name__ == "__main__":
    asyncio.run(main())
