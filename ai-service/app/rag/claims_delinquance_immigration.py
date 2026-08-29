"""Lot de clips sur la délinquance et l'immigration, verdicts de fact-checkeurs.

C'est le terrain où la désinformation circule le plus en France, et donc celui
où le jeu a le plus d'intérêt. C'est aussi le plus délicat : les chiffres y sont
constamment déformés dans les deux sens, par exagération comme par minimisation.

D'OÙ VIENNENT LES VERDICTS. Uniquement de rédactions de fact-checking — AFP
Factuel, TF1 Info, Le Monde, 20 Minutes, franceinfo, Africa Check. On n'est pas
allé chercher les publications d'origine dans les médias qui les diffusent :
elles n'apportent aucun verdict, et les étiqueter nous-mêmes reviendrait à nous
instituer arbitres de ce qui est vrai. La règle d'or de docs/CLAIMS.md
l'interdit, et pour une bonne raison — c'est le fact-checkeur qui engage sa
responsabilité éditoriale, pas nous.

CE QU'ON CHERCHE EN PRIORITÉ : les affirmations notées VRAIES. Elles sont rares
dans ce corpus, parce qu'une rédaction publie surtout ce qui cloche, mais ce
sont les plus utiles au joueur. Une statistique qu'on croit gonflée et qui se
révèle exacte apprend bien plus qu'un énième démenti : elle interdit le réflexe
« ça me déplaît donc c'est faux », qui est une forme d'aveuglement comme une
autre. Les requêtes ci-dessous ratissent donc large sur les chiffres officiels,
là où les verdicts positifs se trouvent.

Lancer :
    docker compose exec ai-service python -m app.rag.claims_delinquance_immigration
"""
import os
import secrets
import string
import time

import httpx

from app.db import connect
from app.rag.export_claims import API, make_source_key, map_verdict
from app.rag.videos_depuis_factchecks import ENTETES, _extraire

# Deux familles de requêtes. Les premières ramènent surtout des démentis, les
# secondes visent les vérifications de statistiques, où les verdicts VRAIS se
# concentrent.
REQUETES = [
    "délinquance", "immigration", "insécurité France", "criminalité étrangers",
    "statistiques délinquance", "demandeurs d'asile France", "OQTF",
    "immigration chiffres", "violences France chiffres",
    # Chiffres officiels : c'est là qu'on trouve des « vrai ».
    "titres de séjour France", "expulsions étrangers France", "prisons étrangers",
    "aide médicale d'État", "regroupement familial", "mineurs non accompagnés",
    "homicides France chiffres", "vols France statistiques", "asile Europe chiffres",
    "population immigrée France", "naturalisations France", "sécurité chiffres INSEE",
]


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
                                           "languageCode": "fr", "pageSize": 50,
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
                # Les énoncés très courts ne se comprennent pas hors de leur
                # article, et les très longs débordent de l'écran de jeu.
                if not (30 <= len(texte) <= 260):
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

    # On traite les VRAIES en premier : la recherche de vidéo est lente, et si
    # l'exécution est interrompue on veut avoir sauvé les plus précieuses.
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
                       "societe_fr", donnees["url"], media))

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
        print(f"  [{ligne[3]:5s}] {ligne[2][:78]}")


if __name__ == "__main__":
    main()
