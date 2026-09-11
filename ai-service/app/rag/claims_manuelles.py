"""Clips ajoutés à la main, après tri humain.

La collecte automatique couvre l'essentiel du corpus, mais elle rate les
vérifications que l'API n'indexe pas et celles dont la vidéo se trouve
ailleurs que dans l'article. Ce fichier recueille ce qu'on ajoute au cas par
cas, une fois le clip regardé et le verdict relevé chez le fact-checkeur.

Chaque entrée porte sa source. C'est la condition posée par app/rag/README.md :
le verdict appartient à la rédaction qui l'a publié, jamais à nous. On se
contente de recopier fidèlement, y compris quand la conclusion est nuancée —
auquel cas la nuance part dans l'explication, puisque la base ne connaît que
VRAI et FAUX.

Lancer :
    docker compose exec ai-service python -m app.rag.claims_manuelles
"""
import hashlib
import secrets
import string

from app.db import connect

# (affirmation, verdict, vidéo, article source, explication de la révélation).
#
# Le verdict doit être celui de l'article, pas une appréciation personnelle.
# En cas de doute sur ce qu'a réellement conclu la rédaction, on n'ajoute pas.
LOT = [
    (
        "L'explosion de la criminalité en France a un lien direct avec l'immigration.",
        "FALSE",
        "https://www.youtube-nocookie.com/embed/OY2WvPg35-Y",
        "https://defacto-observatoire.fr/Medias/Factuel/Fact-checks/"
        "Immigration-et-delinquance-attention-aux-interpretations-trompeuses-"
        "des-chiffres-du-ministere-de-l-Interieur/",
        "Defacto qualifie cette lecture des chiffres du ministère de l'Intérieur "
        "d'interprétation trompeuse : elle confond « étrangers » et « immigrés », "
        "« mis en cause » et « condamnés », et laisse de côté l'âge, le sexe et "
        "l'accès à l'emploi. L'article cite des chercheurs pour qui, une fois ces "
        "biais neutralisés, les études concluent à l'absence d'impact de "
        "l'immigration sur la délinquance. À noter : la rédaction parle "
        "d'interprétation trompeuse plutôt que d'affirmation fausse — le jeu ne "
        "gère que deux verdicts, la nuance est donc ici.",
    ),
    # Le cas d'école du « ça sent le fake, et pourtant » : des vidéos d'OVNIs
    # que le joueur classera spontanément en intox, alors qu'elles sont
    # officielles. La source est le communiqué du ministère de la Défense
    # américain, pas une rédaction de fact-checking — c'est un document
    # primaire, ce qui vaut mieux encore.
    (
        "Le ministère de la Défense américain a lui-même publié et authentifié des vidéos "
        "de phénomènes aériens non identifiés filmées par des pilotes de l'US Navy.",
        "TRUE",
        "https://www.youtube-nocookie.com/embed/tf1uLwUTDA0",
        "https://www.defense.gov/News/Releases/Release/Article/2165713/"
        "statement-by-the-department-of-defense-on-the-release-of-historical-navy-videos/",
        "Le Pentagone a diffusé trois séquences le 27 avril 2020 — FLIR1, GIMBAL et GO FAST — "
        "en précisant qu'elles étaient authentiques et que les phénomènes observés restaient "
        "non identifiés. Le but affiché était de couper court aux versions déformées qui "
        "circulaient déjà.",
    ),
    (
        "Le renseignement américain a reconnu par écrit être incapable d'expliquer la quasi-"
        "totalité des phénomènes aériens signalés par ses propres pilotes.",
        "TRUE",
        "https://www.youtube-nocookie.com/embed/6rWOtrke0HY",
        "https://www.dni.gov/files/ODNI/documents/assessments/"
        "Prelimary-Assessment-UAP-20210625.pdf",
        "Le rapport préliminaire du directeur du renseignement national, en juin 2021, "
        "recensait 144 signalements entre 2004 et 2021 : un seul a pu être expliqué. Le "
        "document ne conclut à rien d'extraterrestre — il constate un manque de données.",
    ),
]


def main() -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute('SELECT "sourceKey" FROM "Claim" WHERE "sourceKey" IS NOT NULL')
        deja = {r[0] for r in cur.fetchall()}

    alphabet = string.ascii_lowercase + string.digits
    lignes = []
    for texte, label, media, source, explication in LOT:
        cle = "manuel:" + hashlib.sha1(source.encode()).hexdigest()[:16]
        if cle in deja:
            continue
        lignes.append(("c" + "".join(secrets.choice(alphabet) for _ in range(24)),
                       cle, texte, label, "societe_fr", source, media, explication))

    if not lignes:
        print("Rien de nouveau à insérer.")
        return

    with connect() as conn, conn.cursor() as cur:
        cur.executemany(
            'INSERT INTO "Claim" (id, "sourceKey", text, "truthLabel", category, '
            '"sourceUrl", "mediaRef", "createdAt") '
            'VALUES (%s, %s, %s, %s::"ClaimTruthLabel", %s, %s, %s, now()) '
            'ON CONFLICT ("sourceKey") DO NOTHING',
            [l[:7] for l in lignes],
        )
        cur.executemany(
            'INSERT INTO "ClaimVerdict" (id, "claimId", "verdictText", confidence, citations) '
            'VALUES (%s, %s, %s, 1.0, %s::jsonb) ON CONFLICT ("claimId") DO NOTHING',
            [("c" + "".join(secrets.choice(alphabet) for _ in range(24)), l[0], l[7],
              '[{"titre": "Article de vérification", "url": "' + l[5] + '"}]')
             for l in lignes],
        )
        conn.commit()

    print(f"{len(lignes)} clip(s) ajouté(s) :\n")
    for ligne in lignes:
        print(f"  [{ligne[3]:5s}] {ligne[2][:88]}")


if __name__ == "__main__":
    main()
