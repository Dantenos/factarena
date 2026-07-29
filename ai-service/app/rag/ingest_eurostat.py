"""Harvester Eurostat : récupère des indicateurs chiffrés officiels -> corpus RAG.

POURQUOI Eurostat, et PAS du scraping HTML de l'INSEE : Eurostat expose les vrais
chiffres français en DONNÉES STRUCTURÉES (API ouverte, sans clé). On lit des
nombres propres, jamais de la prose à gratter — donc AUCUN risque d'extraire un
mauvais chiffre, ce qui serait catastrophique dans un corpus de fact-check.

Chaque indicateur devient une phrase-fait sourcée (valeur + période + source),
embeddée et insérée avec source='eurostat'. /rag/ask peut alors contredire une
affirmation chiffrée avec un chiffre officiel et sa source.

Réactualisable : relancer le script récupère les dernières valeurs publiées.

Étendre le magasin = ajouter une ligne à INDICATEURS.  Vérifier d'abord que les
filtres donnent le bon découpage (bon âge, bonne unité, corrigé des variations
saisonnières...) : un mauvais filtre = un mauvais chiffre.
"""
import asyncio

import httpx

from app.db import connect, ensure_schema, to_pgvector
from app.mistral_client import embed

BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
HEADERS = {"User-Agent": "FactArena-42-project/0.1 (ft_transcendence; educational)"}

# Indicateurs curés : (libellé, phrase-modèle avec {v}, dataset Eurostat, filtres).
# Les filtres ont été VÉRIFIÉS (valeur d'ordre de grandeur cohérent) avant d'être
# figés ici. Ne pas ajouter un indicateur sans avoir vérifié sa valeur à la main.
INDICATEURS = [
    ("chômage",
     "le taux de chômage en France est de {v} % de la population active",
     "une_rt_m", {"sex": "T", "age": "TOTAL", "s_adj": "SA", "unit": "PC_ACT"}),
    ("chômage des jeunes",
     "le taux de chômage des jeunes de moins de 25 ans en France est de {v} %",
     "une_rt_m", {"sex": "T", "age": "Y_LT25", "s_adj": "SA", "unit": "PC_ACT"}),
    ("inflation",
     "l'inflation annuelle en France (indice des prix à la consommation harmonisé) est de {v} %",
     "prc_hicp_manr", {"coicop": "CP00", "unit": "RCH_A"}),
    ("dette publique",
     "la dette publique de la France représente {v} % du PIB",
     "gov_10dd_edpt1", {"na_item": "GD", "sector": "S13", "unit": "PC_GDP"}),
    ("déficit public",
     "le déficit public de la France représente {v} % du PIB",
     "gov_10dd_edpt1", {"na_item": "B9", "sector": "S13", "unit": "PC_GDP"}),
    ("croissance du PIB",
     "la croissance du PIB réel de la France est de {v} % sur l'année",
     "tec00115", {"na_item": "B1GQ", "unit": "CLV_PCH_PRE"}),
]


def _source_url(dataset: str) -> str:
    # Page publique du jeu de données sur Eurostat (sert de citation).
    return f"https://ec.europa.eu/eurostat/databrowser/view/{dataset}/default/table?lang=fr"


def _latest(client: httpx.Client, dataset: str, filtres: dict):
    """Renvoie (période, valeur) la plus récente disponible pour la France.

    On filtre toutes les dimensions SAUF le temps à une seule valeur : le tableau
    `value` est alors indexé uniquement par la période, ce qui rend l'extraction
    fiable.
    """
    params = {**filtres, "geo": "FR", "format": "JSON", "lang": "FR"}
    data = client.get(BASE + dataset, params=params, headers=HEADERS, timeout=25).json()
    index = data["dimension"]["time"]["category"]["index"]
    valeurs = data["value"]
    # On parcourt les périodes de la plus récente à la plus ancienne.
    for periode in sorted(index, key=lambda k: index[k], reverse=True):
        v = valeurs.get(str(index[periode]))
        if v is not None:
            return periode, v
    return None, None


async def ingest() -> None:
    ensure_schema()
    lignes = []
    with httpx.Client() as client:
        for libelle, modele, dataset, filtres in INDICATEURS:
            periode, v = _latest(client, dataset, filtres)
            if v is None:
                print(f"  (aucune valeur pour {libelle})")
                continue
            phrase = f"En {periode}, {modele.format(v=v)}. Source : Eurostat (ESTAT)."
            lignes.append((phrase, _source_url(dataset)))
            print(f"  {libelle:22}: {periode} -> {v}")

    if not lignes:
        print("Aucun indicateur récupéré (Eurostat injoignable ?).")
        return

    # On remplace proprement les entrées 'eurostat' (relance = valeurs à jour).
    with connect() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM documents WHERE source = 'eurostat';")
        conn.commit()

    vecteurs = await embed([phrase for phrase, _ in lignes])
    with connect() as conn, conn.cursor() as cur:
        for (phrase, url), vec in zip(lignes, vecteurs):
            cur.execute(
                "INSERT INTO documents (source, title, url, content, chunk_index, embedding) "
                "VALUES (%s, %s, %s, %s, %s, %s::vector)",
                ("eurostat", "Indicateur officiel (Eurostat)", url, phrase, 0, to_pgvector(vec)),
            )
        conn.commit()
    print(f"{len(lignes)} indicateurs Eurostat ingérés (source='eurostat').")


# À lancer dans le conteneur (appelle Mistral -> clé requise) :
#     docker compose exec ai-service python -m app.rag.ingest_eurostat
if __name__ == "__main__":
    asyncio.run(ingest())
