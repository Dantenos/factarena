"""Clips portant sur des vidéos générées par intelligence artificielle.

C'est devenu le motif de désinformation le plus courant, et celui que le joueur
a le plus de chances de croiser en vrai. Le corpus n'en contenait presque rien.

L'intérêt de jeu est double, parce que ces vérifications tombent dans les deux
sens :

- une séquence spectaculaire présentée comme réelle, que la rédaction identifie
  comme synthétique — l'affirmation d'authenticité est alors FAUSSE ;
- une publication dont on doute qu'elle ait eu lieu, et que la rédaction
  confirme — « untel a bien diffusé une vidéo générée par IA » est VRAI.

Le second cas est précieux : le corpus penche lourdement du côté des démentis,
et ces confirmations sont l'une des rares sources d'affirmations vraies.

On ne fabrique aucune vidéo synthétique nous-mêmes. Outre que la stack ne le
permet pas, produire un faux crédible mettant en scène une personne réelle pour
l'afficher dans un jeu serait exactement le comportement que ce jeu apprend à
repérer.

Lancer :
    docker compose exec ai-service python -m app.rag.claims_video_ia
"""
import os
import secrets
import string
import time

import httpx

from app.db import connect
from app.rag.export_claims import API, make_source_key, map_verdict
from app.rag.videos_depuis_factchecks import ENTETES, _extraire

# On reste sur les ANIMAUX et la PHYSIQUE-CHIMIE.
#
# Une première passe sans restriction avait ramené des trucages politiques et
# des arnaques à l'investissement mettant en scène des personnalités nommées :
# hors sujet pour le jeu, souvent en anglais, et pas le genre de contenu qu'on
# veut voir défiler dans une partie entre étudiants. Les faux animaliers et les
# fausses démonstrations scientifiques, eux, sont massivement partagés, ne
# mettent personne en cause, et se prêtent bien mieux à l'exercice : on y
# cherche des indices dans l'image, pas dans l'actualité.
REQUETES_FR = [
    "vidéo générée par IA animal", "faux animal vidéo intelligence artificielle",
    "vidéo IA nature", "créature marine vidéo IA", "sauvetage animal vidéo IA",
    "expérience scientifique vidéo truquée", "vidéo IA phénomène naturel",
]
REQUETES_EN = [
    "AI-generated video animal", "AI generated wildlife video fake",
    "AI video animal rescue", "AI generated sea creature video",
    "AI generated science experiment video", "fake physics video AI",
    "AI generated nature footage",
]

# Le sujet doit relever du vivant ou des sciences dures. Sans ce filtre, les
# requêtes ramènent quand même des trucages politiques : le mot « IA » suffit
# à les faire remonter, quel que soit le thème.
THEMES_AUTORISES = (
    "animal", "animaux", "chien", "chat", "oiseau", "poisson", "requin", "baleine",
    "ours", "lion", "tigre", "serpent", "insecte", "araignée", "singe", "éléphant",
    "créature", "espèce", "faune", "nature", "océan", "marine", "abeille",
    "dog", "cat", "bird", "fish", "shark", "whale", "bear", "lion", "tiger",
    "snake", "insect", "spider", "monkey", "elephant", "creature", "species",
    "wildlife", "ocean", "sea ", "animal",
    "physique", "chimie", "expérience", "réaction", "laboratoire", "molécule",
    "aimant", "électricité", "gravité", "volcan", "météo", "foudre",
    "physics", "chemistry", "experiment", "reaction", "laboratory", "magnet",
    "electricity", "gravity", "volcano", "lightning",
)

# Le sujet vérifié doit être une vidéo : les photos et illustrations générées
# par IA sont nombreuses, mais le lecteur ne sait pas les afficher.
MOTS_VIDEO = ("vidéo", "video", "séquence", "footage", "images animées", "clip")
MOTS_IMAGE = ("photographie", "photograph", "screenshot", "capture d'écran")


def _utilisable(texte: str) -> bool:
    bas = texte.lower()
    if not any(m in bas for m in MOTS_VIDEO):
        return False
    if any(m in bas for m in MOTS_IMAGE):
        return False
    return any(m in bas for m in THEMES_AUTORISES)


def main() -> None:
    cle = os.getenv("GOOGLE_API_KEY")
    if not cle:
        print("GOOGLE_API_KEY manquante dans .env.")
        return

    candidats: dict[str, dict] = {}
    for langue, requetes in (("fr", REQUETES_FR), ("en", REQUETES_EN)):
        for requete in requetes:
            for page in range(3):
                try:
                    r = httpx.get(API, params={"key": cle, "query": requete,
                                               "languageCode": langue, "pageSize": 50,
                                               "offset": page * 50}, timeout=40)
                except Exception:
                    break
                if r.status_code != 200:
                    break
                claims = r.json().get("claims", [])
                if not claims:
                    break
                for c in claims:
                    texte = (c.get("text") or "").strip()
                    if not (30 <= len(texte) <= 260) or not _utilisable(texte):
                        continue
                    for rev in c.get("claimReview", []):
                        label = map_verdict(rev.get("textualRating", ""))
                        url = rev.get("url")
                        if not label or not url:
                            continue
                        candidats.setdefault(texte, {
                            "texte": texte, "label": label, "url": url,
                            "editeur": rev.get("publisher", {}).get("name", "factcheck"),
                        })
                time.sleep(1)

    vrais_dispo = sum(1 for d in candidats.values() if d["label"] == "TRUE")
    print(f"{len(candidats)} vérification(s) retenue(s) dont {vrais_dispo} VRAI.\n")
    if not candidats:
        return

    with connect() as conn, conn.cursor() as cur:
        cur.execute('SELECT "sourceKey" FROM "Claim" WHERE "sourceKey" IS NOT NULL')
        deja = {r[0] for r in cur.fetchall()}

    # Les VRAIES d'abord : ce sont les plus rares et les plus utiles au jeu.
    ordonnes = sorted(candidats.values(), key=lambda d: d["label"] != "TRUE")

    alphabet = string.ascii_lowercase + string.digits
    lignes, sans_video = [], 0
    for donnees in ordonnes:
        cle_source = make_source_key(donnees["editeur"], donnees["url"])
        if cle_source in deja:
            continue
        media = None
        try:
            page = httpx.get(donnees["url"], headers=ENTETES, timeout=30,
                             follow_redirects=True)
            if page.status_code == 200:
                media = _extraire(page.text)
        except Exception:
            media = None
        time.sleep(1.5)
        if not media:
            sans_video += 1
            continue
        lignes.append(("c" + "".join(secrets.choice(alphabet) for _ in range(24)),
                       cle_source, donnees["texte"], donnees["label"],
                       "video_ia", donnees["url"], media))

    if lignes:
        with connect() as conn, conn.cursor() as cur:
            cur.executemany(
                'INSERT INTO "Claim" (id, "sourceKey", text, "truthLabel", category, '
                '"sourceUrl", "mediaRef", "createdAt") '
                'VALUES (%s, %s, %s, %s::"ClaimTruthLabel", %s, %s, %s, now()) '
                'ON CONFLICT ("sourceKey") DO NOTHING',
                lignes,
            )
            conn.commit()

    vrais = sum(1 for l in lignes if l[3] == "TRUE")
    print(f"{len(lignes)} clip(s) insérés ({vrais} VRAI / {len(lignes) - vrais} FAUX), "
          f"{sans_video} sans vidéo exploitable.\n")
    for ligne in lignes:
        print(f"  [{ligne[3]:5s}] {ligne[2][:82]}")


if __name__ == "__main__":
    main()
