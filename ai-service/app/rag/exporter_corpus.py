"""Écrit le corpus jouable dans le fichier de seed du back.

Sans ça, les clips n'existent que dans la base de la machine qui a lancé les
ingestions. Un coéquipier qui clone le dépôt et fait « docker compose up »
obtient une base presque vide, et lancer une manche échoue avec « Pas assez de
claims en base ». Le correcteur aurait eu exactement le même écran.

On n'exporte que les claims réellement jouables — celles dont le média est
d'une des trois formes que le lecteur sait afficher — avec leur explication de
révélation quand elle existe. Le reste du corpus sert au moteur de recherche
et n'a pas à voyager dans le seed.

Le fichier produit est versionné : c'est lui qui garantit que tout le monde
joue avec le même contenu.

Lancer :
    docker compose exec ai-service python -m app.rag.exporter_corpus
"""
import json
import pathlib

from app.db import connect

# Chemin vu depuis le conteneur : le dossier du back est monté à cet endroit
# en développement. On écrit à côté du seed qui va le lire.
SORTIE = pathlib.Path("/app/export/editorial-claims.generated.json")

JOUABLE = """("mediaRef" LIKE '%upload.wikimedia%'
              OR "mediaRef" LIKE '%/embed/%'
              OR "mediaRef" LIKE '%plugins/video.php%')"""


def main() -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(f'''
            SELECT cl."sourceKey", cl.text, cl."truthLabel", cl.category,
                   cl."sourceUrl", cl."mediaRef", cl."videoEndS",
                   v."verdictText", v.confidence, v.citations
            FROM "Claim" cl
            LEFT JOIN "ClaimVerdict" v ON v."claimId" = cl.id
            WHERE {JOUABLE}
            ORDER BY cl.category, cl.text
        ''')
        lignes = cur.fetchall()

    claims = []
    for cle, texte, label, categorie, source, media, fin, verdict, confiance, citations in lignes:
        entree = {
            # sourceKey sert de clé d'idempotence : réimporter le fichier ne
            # crée pas de doublons.
            "sourceKey": cle,
            "text": texte,
            "truthLabel": label,
            "category": categorie,
            "sourceUrl": source,
            "mediaRef": media,
        }
        if fin is not None:
            entree["videoEndS"] = fin
        if verdict:
            entree["verdict"] = {
                "verdictText": verdict,
                "confidence": confiance,
                "citations": citations or [],
            }
        claims.append(entree)

    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    SORTIE.write_text(json.dumps(claims, ensure_ascii=False, indent=2) + "\n")

    vrais = sum(1 for c in claims if c["truthLabel"] == "TRUE")
    avec_explication = sum(1 for c in claims if "verdict" in c)
    print(f"{len(claims)} clips exportés vers {SORTIE}")
    print(f"  {vrais} vrais / {len(claims) - vrais} faux, {avec_explication} avec explication")


if __name__ == "__main__":
    main()
