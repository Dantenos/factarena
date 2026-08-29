"""Ingestion d'indicateurs INTERNATIONAUX (API Banque mondiale) dans le RAG.

POURQUOI une troisième source, après l'INSEE (France) et Eurostat (Europe) :
beaucoup d'intox sont des comparaisons INTERNATIONALES — « la France pollue plus
que la Chine », « on vit moins bien qu'aux États-Unis », « la France est
surpeuplée ». Sans chiffres hors Europe, le bot ne peut rien opposer à ce type
d'affirmation. La Banque mondiale couvre tous les pays avec des définitions
homogènes, ce qui rend les comparaisons légitimes.

L'API est OUVERTE (aucune clé), répond en JSON, et `mrnev=1` demande directement
la dernière valeur non vide — pas besoin de parcourir tout l'historique.

⚠️ Les valeurs brutes ont beaucoup de décimales (82.9804878048781 ans) : on les
arrondit avant de les écrire, sinon le LLM recopie un chiffre illisible et
faussement précis dans ses réponses.

Lancer :
    docker compose exec ai-service python -m app.rag.ingest_worldbank
"""
import asyncio

import httpx

from app.db import connect, ensure_schema, to_pgvector
from app.mistral_client import embed

BASE = "https://api.worldbank.org/v2/country/{pays}/indicator/{code}"

# Pays comparés : la France, ses deux voisins de référence dans le débat public,
# les deux géants systématiquement cités, et le monde comme point de repère.
PAYS = [
    ("FRA", "la France"),
    ("DEU", "l'Allemagne"),
    ("USA", "les États-Unis"),
    ("CHN", "la Chine"),
    ("WLD", "le monde"),
]

# (code Banque mondiale, phrase-modèle, nb de décimales à conserver).
# Chaque indicateur a été vérifié sur la France avant d'être figé : PIB/hab
# ~49 000 $, espérance de vie ~83 ans, CO2 ~4 t/hab, population ~68,7 M.
INDICATEURS = [
    ("NY.GDP.PCAP.CD",
     "le produit intérieur brut par habitant {pays_gen} est de {v} dollars américains", 0),
    ("SP.DYN.LE00.IN",
     "l'espérance de vie à la naissance {pays_gen} est de {v} ans", 1),
    ("EN.GHG.CO2.PC.CE.AR5",
     "les émissions de CO2 par habitant {pays_gen} sont de {v} tonnes par an", 2),
    ("SP.POP.TOTL",
     "la population totale {pays_gen} est de {v} habitants", 0),
]


def _source_url(code: str) -> str:
    """Page publique de l'indicateur — sert de citation dans les réponses RAG."""
    return f"https://donnees.banquemondiale.org/indicateur/{code}"


def _valeur(client: httpx.Client, pays: str, code: str):
    """Renvoie (année, valeur brute) la plus récente, ou (None, None)."""
    resp = client.get(
        BASE.format(pays=pays, code=code),
        params={"format": "json", "per_page": 1, "mrnev": 1},
        timeout=45,
    )
    resp.raise_for_status()
    data = resp.json()
    # L'API renvoie [metadonnees, [observations]] ; la liste peut être absente.
    if not isinstance(data, list) or len(data) < 2 or not data[1]:
        return None, None
    obs = data[1][0]
    if obs.get("value") is None:
        return None, None
    return obs.get("date"), obs["value"]


def _formate(valeur: float, decimales: int) -> str:
    """Arrondit puis met des espaces fins comme séparateur de milliers."""
    if decimales == 0:
        return f"{round(valeur):,}".replace(",", " ")
    return f"{valeur:.{decimales}f}".replace(".", ",")


async def ingest() -> None:
    ensure_schema()
    lignes = []
    with httpx.Client() as client:
        for code, modele, decimales in INDICATEURS:
            for pays, libelle in PAYS:
                try:
                    annee, brut = _valeur(client, pays, code)
                except Exception as e:
                    print(f"  ({code}/{pays} : {type(e).__name__})")
                    continue
                if brut is None:
                    print(f"  (aucune valeur pour {code}/{pays})")
                    continue
                phrase = (
                    f"En {annee}, {modele.format(v=_formate(brut, decimales), pays_gen=libelle)}. "
                    f"Source : Banque mondiale (World Development Indicators)."
                )
                lignes.append((phrase, _source_url(code)))
                print(f"  {code:22} {pays:4}: {annee} -> {_formate(brut, decimales)}")

    if not lignes:
        print("Aucun indicateur récupéré (API Banque mondiale injoignable ?).")
        return

    # Relancer le script remplace les entrées : pas de doublons, valeurs à jour.
    with connect() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM documents WHERE source = 'banque_mondiale';")
        conn.commit()

    vecteurs = await embed([phrase for phrase, _ in lignes])
    with connect() as conn, conn.cursor() as cur:
        for (phrase, url), vec in zip(lignes, vecteurs):
            cur.execute(
                "INSERT INTO documents (source, title, url, content, chunk_index, embedding) "
                "VALUES (%s, %s, %s, %s, %s, %s::vector)",
                ("banque_mondiale", "Indicateur international (Banque mondiale)",
                 url, phrase, 0, to_pgvector(vec)),
            )
        conn.commit()

    print(f"{len(lignes)} indicateurs internationaux ingérés (source='banque_mondiale').")


if __name__ == "__main__":
    asyncio.run(ingest())
