"""Exporte le noyau de l'index vectoriel, vecteurs compris, dans le dépôt.

L'index complet pèse un gigaoctet et ne peut pas être versionné. Mais sans lui,
une machine qui vient de cloner le dépôt a une base vide : le bot répond sans
jamais citer de source, alors que c'est précisément ce qui démontre le module
RAG.

On n'exporte donc que le noyau utile au jeu — les passages de fact-checks et
les chiffres officiels — en laissant de côté les dizaines de milliers
d'extraits Wikipédia, qui font le volume sans servir aux verdicts.

ON EXPORTE LES VECTEURS, PAS SEULEMENT LE TEXTE. Recalculer les plongements au
chargement demanderait un appel à Mistral par passage : plusieurs minutes
d'attente, une clé valide, et le risque de heurter les limites de débit au
pire moment. Avec les vecteurs, le chargement est instantané et hors ligne.

Lancer :
    docker compose exec ai-service python -m app.rag.exporter_index
"""
import gzip
import json
import pathlib

from app.db import connect

SORTIE = pathlib.Path("/app/export/rag-noyau.json.gz")

# Les sources qui servent réellement à justifier un verdict. Wikipédia est
# volontairement exclu : 67 000 passages de culture générale, tout le poids.
SOURCES = ("factcheck", "insee", "eurostat", "banque_mondiale")


def main() -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT content, url, title, source, embedding::text
               FROM rag.documents WHERE source = ANY(%s) ORDER BY source, url""",
            (list(SOURCES),),
        )
        lignes = cur.fetchall()

    passages = [
        {"content": c, "url": u, "title": t, "source": s, "embedding": e}
        for c, u, t, s, e in lignes
    ]

    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(SORTIE, "wt", encoding="utf-8") as f:
        json.dump(passages, f, ensure_ascii=False)

    poids = SORTIE.stat().st_size / 1024 / 1024
    print(f"{len(passages)} passages exportés vers {SORTIE} ({poids:.1f} Mo)")
    par_source: dict[str, int] = {}
    for p in passages:
        par_source[p["source"]] = par_source.get(p["source"], 0) + 1
    for source, n in sorted(par_source.items(), key=lambda x: -x[1]):
        print(f"  {source:18s} {n}")


if __name__ == "__main__":
    main()
