"""Lot de clips « cette vidéo de Trump est-elle authentique ou truquée ? ».

Constat de départ : chercher des propos de Trump notés VRAIS ne donne rien.
Sur 323 déclarations vérifiées, aucune n'est classée vraie — les rédactions de
fact-checking publient ce qui cloche, pas ce qui va. Un lot construit là-dessus
n'aurait donc contenu que des FAUX, et les joueurs auraient vite compris qu'il
suffisait de répondre « fake » à chaque clip le concernant.

L'angle retenu est l'AUTHENTICITÉ DU MÉDIA, pas la véracité du propos. Snopes
tranche dans les deux sens sur ce terrain : séquence authentique d'un côté,
vidéo générée par IA ou sortie de son contexte de l'autre. On retrouve donc un
équilibre, et la question posée au joueur — truqué ou pas — est exactement la
mécanique du jeu.

Deux partis pris :

- On ne garde QUE les vérifications portant sur une vidéo. Les photos et
  captures d'écran sont majoritaires côté « authentique », mais le lecteur ne
  sait pas les afficher : un clip sans image jouable est un clip perdu.
- On NE TRADUIT PAS. Reformuler les propos d'une personne nommée est
  précisément ce que la règle d'or de app/rag/README.md interdit : une nuance
  perdue à la traduction déplacerait le verdict, et le verdict ne nous
  appartient pas. Les énoncés restent donc dans la langue du fact-checkeur.

Lancer :
    docker compose exec ai-service python -m app.rag.claims_trump
"""
import os
import secrets
import string
import time

import httpx

from app.db import connect
from app.rag.export_claims import API, make_source_key, map_verdict
from app.rag.videos_depuis_factchecks import ENTETES, _extraire

# Requêtes ciblant les vérifications de MÉDIAS, pas de déclarations.
REQUETES = [
    "Trump video authentic", "Trump footage", "Trump video shows",
    "Trump AI video", "Trump video altered", "Trump deepfake video",
]

# Le sujet vérifié doit être une vidéo. « photo », « image » et « screenshot »
# sont écartés même quand le verdict est bon : rien à jouer sans séquence.
MOTS_VIDEO = ("video", "footage", "clip", "recording")
MOTS_IMAGE = ("photograph", "photo ", "a photo", "image", "screenshot", "picture")


def _est_une_video(texte: str) -> bool:
    bas = texte.lower()
    if not any(m in bas for m in MOTS_VIDEO):
        return False
    # Certains énoncés parlent d'une photo ET d'une vidéo. Dans le doute on
    # écarte : mieux vaut un lot plus petit qu'un clip vide en pleine manche.
    return not any(m in bas for m in MOTS_IMAGE)


def main() -> None:
    cle = os.getenv("GOOGLE_API_KEY")
    if not cle:
        print("GOOGLE_API_KEY manquante dans .env.")
        return

    candidats: dict[str, dict] = {}
    for requete in REQUETES:
        for page in range(3):
            try:
                r = httpx.get(API, params={"key": cle, "query": requete,
                                           "languageCode": "en", "pageSize": 50,
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
                if "trump" not in texte.lower() or not _est_une_video(texte):
                    continue
                for rev in c.get("claimReview", []):
                    label = map_verdict(rev.get("textualRating", ""))
                    url = rev.get("url")
                    if not label or not url:
                        continue
                    editeur = rev.get("publisher", {}).get("name", "factcheck")
                    candidats.setdefault(texte, {
                        "texte": texte, "label": label, "url": url, "editeur": editeur,
                    })
            time.sleep(1)

    print(f"{len(candidats)} vérification(s) de vidéo retenue(s).\n")
    if not candidats:
        return

    with connect() as conn, conn.cursor() as cur:
        cur.execute('SELECT "sourceKey" FROM "Claim" WHERE "sourceKey" IS NOT NULL')
        deja = {r[0] for r in cur.fetchall()}

    alphabet = string.ascii_lowercase + string.digits
    lignes = []
    sans_video = 0
    for donnees in candidats.values():
        cle_source = make_source_key(donnees["editeur"], donnees["url"])
        if cle_source in deja:
            continue
        # On va chercher dans l'article la vidéo qu'il analyse. Sans elle, la
        # claim n'a rien à montrer : on ne l'insère pas du tout.
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
                       "trump_media", donnees["url"], media))

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
          f"{sans_video} écarté(s) faute de vidéo dans l'article.\n")
    for ligne in lignes:
        plateforme = "facebook" if "facebook" in ligne[6] else "youtube"
        print(f"  [{ligne[3]:5s}|{plateforme:8s}] {ligne[2][:66]}")


if __name__ == "__main__":
    main()
