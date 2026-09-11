"""Fabrique des claims FAUSSES en décontextualisant des vidéos authentiques.

POURQUOI CE SCRIPT : le jeu manquait de fausses claims dont la vidéo soit
utilisable. Celles tirées des fact-checks posent deux problèmes insolubles —
l'article embarque souvent la preuve du trucage plutôt que la vidéo litigieuse,
et surtout le lecteur YouTube AFFICHE LE TITRE. Une affirmation « cette vidéo
montre une frappe iranienne » illustrée par une vidéo intitulée « Chinese
chemical plant explosion » se devine sans réfléchir.

LA SOLUTION : reprendre les vidéos Wikimedia — authentiques, documentées, lues
par la balise <video> qui n'affiche aucun titre — et les attribuer au MAUVAIS
événement. C'est très exactement le mécanisme de désinformation le plus
répandu : l'image recyclée, sortie de son contexte. La catégorie HORS_CONTEXTE
désigne ce cas.

POURQUOI C'EST LÉGITIME, alors que la règle d'or interdit de qualifier soi-même
un contenu : ici on ne porte aucun jugement sur les propos de quiconque. On
prend une vidéo dont la fiche Commons établit le sujet réel, et on affirme
qu'elle montre autre chose. La clé de réponse est donc CERTAINE — c'est la
fiche source qui l'établit, pas nous. Aucune personne n'est mise en cause : ce
sont des phénomènes naturels.

À la révélation, l'explication rétablit le vrai sujet et cite la fiche Commons.

Lancer :
    docker compose exec ai-service python -m app.rag.claims_hors_contexte
"""
import hashlib
import re
import secrets
import string
import unicodedata

from app.db import connect

# (motif attendu dans le nom du fichier, fausse attribution plausible).
# La fausse attribution doit rester crédible : un joueur doit pouvoir hésiter.
# On garde le même TYPE de phénomène et on change le lieu ou l'événement, comme
# le font les vraies décontextualisations.
DETOURNEMENTS = [
    ("tornado",
     "Cette vidéo montre la tornade qui a frappé la Normandie en octobre 2018."),
    ("quake|earthquake",
     "Cette vidéo montre les secousses du séisme de Turquie de février 2023."),
    ("eclipse",
     "Cette vidéo montre l'éclipse solaire totale observée depuis la France en 1999."),
    ("volcano|eruption|erupting",
     "Cette vidéo montre l'éruption du Vésuve filmée par un touriste."),
    ("geyser",
     "Cette vidéo montre un geyser apparu dans un jardin après un forage en Islande."),
    ("avalanche",
     "Cette vidéo montre l'avalanche qui a emporté un refuge dans les Alpes françaises."),
    ("balen|whale",
     "Cette vidéo montre une baleine remontée jusque dans la Seine à Rouen."),
]


def _sans_accents(t: str) -> str:
    t = t.lower()
    t = unicodedata.normalize("NFD", t)
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


def _sujet_reel(media: str) -> str:
    """Sujet véritable de la vidéo, lu dans le nom du fichier Commons."""
    nom = re.sub(r"\.(webm|ogv|mp4)(\?.*)?$", "", media.split("/")[-1])
    return nom.replace("_", " ")[:120]


def main() -> None:
    with connect() as conn, conn.cursor() as cur:
        # On part des vidéos Commons déjà validées comme authentiques.
        cur.execute(
            'SELECT "mediaRef", "sourceUrl" FROM "Claim" '
            'WHERE "mediaRef" LIKE %s AND "truthLabel" = %s',
            ("%wikimedia%", "TRUE"),
        )
        sources = cur.fetchall()
        cur.execute('SELECT "sourceKey" FROM "Claim" WHERE "sourceKey" IS NOT NULL')
        deja = {r[0] for r in cur.fetchall()}

    nouvelles = []
    utilises: set[str] = set()
    for media, source_url in sources:
        fichier = _sans_accents(_sujet_reel(media))
        for motif, fausse_attribution in DETOURNEMENTS:
            if not re.search(motif, fichier, re.I):
                continue
            # Une seule claim fausse par thème : sinon le joueur verrait cinq
            # fois « la tornade de Normandie » et comprendrait le procédé.
            if motif in utilises:
                break
            utilises.add(motif)
            cle = "horscontexte:" + hashlib.sha1(media.encode()).hexdigest()[:16]
            if cle in deja:
                break
            nouvelles.append((cle, fausse_attribution, "FALSE", "hors_contexte",
                              source_url, media))
            break

    if not nouvelles:
        print("Aucune claim hors-contexte à créer.")
        return

    alphabet = string.ascii_lowercase + string.digits
    avec_id = [("c" + "".join(secrets.choice(alphabet) for _ in range(24)), *n) for n in nouvelles]

    with connect() as conn, conn.cursor() as cur:
        cur.executemany(
            'INSERT INTO "Claim" (id, "sourceKey", text, "truthLabel", category, '
            '"sourceUrl", "mediaRef", "createdAt") '
            'VALUES (%s, %s, %s, %s::"ClaimTruthLabel", %s, %s, %s, now()) '
            'ON CONFLICT ("sourceKey") DO NOTHING',
            avec_id,
        )
        conn.commit()

    print(f"{len(nouvelles)} claims HORS CONTEXTE créées :\n")
    for _cle, texte, _lab, _cat, _src, media in nouvelles:
        print(f"  « {texte[:66]} »")
        print(f"    (en réalité : {_sujet_reel(media)[:64]})")


if __name__ == "__main__":
    main()
