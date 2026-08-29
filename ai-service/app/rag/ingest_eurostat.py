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

# Zones géographiques interrogées. POURQUOI l'Europe EN PLUS de la France :
# beaucoup d'intox sont COMPARATIVES (« le pays le plus taxé », « celui qui
# accueille le plus de migrants »). Sans le point de comparaison européen, le
# bot ne peut pas répondre à ce type d'affirmation. Chaque zone porte ses deux
# formes grammaticales, sinon les phrases générées sont bancales.
#   {loc} -> « en France »       / « dans l'Union européenne »
#   {gen} -> « de la France »    / « de l'Union européenne »
ZONES = [
    ("FR", "en France", "de la France"),
    ("EU27_2020", "dans l'Union européenne", "de l'Union européenne"),
]

# Indicateurs curés : (libellé, phrase-modèle avec {v}/{loc}/{gen}, dataset, filtres).
# Les filtres ont été VÉRIFIÉS (valeur d'ordre de grandeur cohérent) avant d'être
# figés ici. Ne pas ajouter un indicateur sans avoir vérifié sa valeur à la main.
INDICATEURS = [
    ("chômage",
     "le taux de chômage {loc} est de {v} % de la population active",
     "une_rt_m", {"sex": "T", "age": "TOTAL", "s_adj": "SA", "unit": "PC_ACT"}),
    ("chômage des jeunes",
     "le taux de chômage des jeunes de moins de 25 ans {loc} est de {v} %",
     "une_rt_m", {"sex": "T", "age": "Y_LT25", "s_adj": "SA", "unit": "PC_ACT"}),
    ("inflation",
     "l'inflation annuelle {loc} (indice des prix à la consommation harmonisé) est de {v} %",
     "prc_hicp_manr", {"coicop": "CP00", "unit": "RCH_A"}),
    ("dette publique",
     "la dette publique {gen} représente {v} % du PIB",
     "gov_10dd_edpt1", {"na_item": "GD", "sector": "S13", "unit": "PC_GDP"}),
    ("déficit public",
     "le déficit public {gen} représente {v} % du PIB",
     "gov_10dd_edpt1", {"na_item": "B9", "sector": "S13", "unit": "PC_GDP"}),
    ("croissance du PIB",
     "la croissance du PIB réel {gen} est de {v} % sur l'année",
     "tec00115", {"na_item": "B1GQ", "unit": "CLV_PCH_PRE"}),
    # Vérifié à la main avant d'être figé (règle ci-dessus) : l'API renvoie
    # 56,8 (2023), 57,0 (2024) et 57,2 (2025) % du PIB — ordres de grandeur
    # cohérents. Remplace un indicateur qui était codé en dur et non sourcé
    # dans ingest_indicateurs.py : ici la valeur est live, datée et sourcée.
    ("dépense publique",
     "la dépense publique {gen} représente {v} % du PIB",
     "gov_10a_main", {"na_item": "TE", "sector": "S13", "unit": "PC_GDP"}),
    # Immigration : thème n°1 de la désinformation, et absent de la BDM de
    # l'INSEE (ces chiffres vivent dans le recensement, pas dans les séries
    # macro) — d'où Eurostat. « Immigrants » au sens du règlement européen :
    # personnes ayant établi leur résidence en France dans l'année, toutes
    # nationalités confondues (y compris les Français de retour).
    ("immigration",
     "le nombre d'immigrants ayant établi leur résidence {loc} est de {v} "
     "sur l'année (toutes nationalités confondues, définition Eurostat)",
     "migr_imm1ctz", {"agedef": "COMPLET", "age": "TOTAL", "sex": "T", "citizen": "TOTAL", "unit": "NR"}),
]


def _source_url(dataset: str) -> str:
    # Page publique du jeu de données sur Eurostat (sert de citation).
    return f"https://ec.europa.eu/eurostat/databrowser/view/{dataset}/default/table?lang=fr"


def _latest(client: httpx.Client, dataset: str, filtres: dict, geo: str = "FR"):
    """Renvoie (période, valeur) la plus récente disponible pour la France.

    On filtre toutes les dimensions SAUF le temps à une seule valeur : le tableau
    `value` est alors indexé uniquement par la période, ce qui rend l'extraction
    fiable.
    """
    params = {**filtres, "geo": geo, "format": "JSON", "lang": "FR"}
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
            for geo, loc, gen in ZONES:
                periode, v = _latest(client, dataset, filtres, geo)
                if v is None:
                    print(f"  (aucune valeur pour {libelle} / {geo})")
                    continue
                phrase = (
                    f"En {periode}, {modele.format(v=v, loc=loc, gen=gen)}. "
                    f"Source : Eurostat (ESTAT)."
                )
                lignes.append((phrase, _source_url(dataset)))
                print(f"  {libelle:22} {geo:10}: {periode} -> {v}")

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
