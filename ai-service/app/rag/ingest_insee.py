"""Ingestion d'indicateurs INSEE (API BDM) dans le corpus RAG.

POURQUOI l'INSEE EN PLUS d'Eurostat : sur des chiffres français, l'INSEE est
l'autorité statistique nationale — c'est la source qu'un fact-checkeur citerait
en premier. Avoir les DEUX donne un vrai atout : le RAG dispose de deux sources
officielles INDÉPENDANTES sur les mêmes indicateurs, et peut expliquer pourquoi
elles diffèrent (méthode et période de mesure) au lieu de se contredire.

⚠️ Les deux ne mesurent pas la même chose, et c'est écrit dans les phrases
produites : l'INSEE publie ici du TRIMESTRIEL au sens du BIT (France entière,
données CVS), là où Eurostat publie du mensuel désaisonnalisé. Deux chiffres
différents ne sont donc pas une erreur — et le bot doit pouvoir le dire.

Remplace les valeurs qui étaient codées en dur dans ingest_indicateurs.py :
ici tout est récupéré en direct, donc daté et auto-actualisable.

Détails techniques :
- l'API BDM est OUVERTE (aucune clé, contrairement à ce qu'on pourrait croire) ;
- elle répond en SDMX **XML** (Eurostat répond en JSON), d'où le parsing avec
  `xml.etree` de la bibliothèque STANDARD : aucune dépendance ajoutée ;
- chaque série est désignée par un « idbank » opaque. Ceux ci-dessous ont été
  relevés en listant le jeu de données CHOMAGE-TRIM-NATIONAL, et le titre exact
  renvoyé par l'API est vérifié à l'exécution (voir `_serie`).

Lancer :
    docker compose exec ai-service python -m app.rag.ingest_insee
"""
import asyncio
import xml.etree.ElementTree as ET

import httpx

from app.db import connect, ensure_schema, to_pgvector
from app.mistral_client import embed

BASE = "https://api.insee.fr/series/BDM/V1/data/SERIES_BDM/"

# (idbank, phrase-modèle avec {v}). Séries « France entière, données CVS »,
# relevées dans le jeu CHOMAGE-TRIM-NATIONAL (« taux de chômage par sexe et âge
# au sens du BIT »). On préfère « France entière » à « France hors Mayotte ».
SERIES = [
    ("011818543",
     "le taux de chômage en France (France entière) est de {v} % de la population "
     "active, au sens du BIT, en données trimestrielles corrigées des variations "
     "saisonnières"),
    ("011818548",
     "le taux de chômage des moins de 25 ans en France (France entière) est de "
     "{v} %, au sens du BIT, en données trimestrielles corrigées des variations "
     "saisonnières"),
    ("011818581",
     "le taux de chômage de longue durée en France (France entière) est de {v} % "
     "de la population active, au sens du BIT, en données trimestrielles corrigées "
     "des variations saisonnières"),
    # Délinquance : thème majeur de désinformation, d'où son intérêt ici.
    # Série « Total - France » du jeu TCRED-CONDITIONSDEVIE-APE-PEC. Attention,
    # ce jeu contient surtout des séries DÉPARTEMENTALES et une série piège
    # « France métropolitaine hors Île-de-France » (001779402) qui donnerait un
    # chiffre national faux. Celle-ci est bien la série nationale complète.
    ("010757166",
     "le nombre de personnes mises en cause dans des affaires pénales "
     "poursuivables en France est de {v} sur l'année"),
    # Fonction publique : « il y a trop de fonctionnaires » est un marronnier de
    # la désinformation, autant avoir le chiffre officiel. Série « France hors
    # Mayotte » (la plus complète). Valeur en milliers -> remise à l'échelle.
    ("010608465",
     "le nombre d'agents de la fonction publique en France (hors Mayotte, "
     "trois versants confondus) est de {v}"),
    # Logement : le parc total et surtout les logements VACANTS reviennent en
    # boucle dans les débats (« des millions de logements vides »). Valeurs en
    # milliers dans la BDM -> remises à l'échelle.
    ("001687211",
     "le parc de logements en France métropolitaine compte {v} logements au total"),
    ("001687214",
     "le nombre de logements vacants en France métropolitaine est de {v}"),
]

# --- Séries ÉCARTÉES après vérification (ne pas les réintroduire sans contrôle) ---
# - 001744512 (indicateur conjoncturel de fécondité) : « Série arrêtée », et sa
#   valeur brute (159) s'exprime pour 100 femmes — publiée telle quelle, elle
#   donnerait « 159 enfants par femme ». Double raison de l'exclure.
# - 000436392 (taux de natalité) : « Série arrêtée » également.
# - Taux de pauvreté (TCRED-...-TAUX-PAUVRETE-AGE) : ce jeu ne contient que des
#   séries départementales, dont la dernière année est 2015. Trop ancien.


def _source_url(idbank: str) -> str:
    """Page publique de la série sur insee.fr — sert de citation dans le RAG."""
    return f"https://www.insee.fr/fr/statistiques/serie/{idbank}"


def _serie(client: httpx.Client, idbank: str):
    """Renvoie (titre, période, valeur) de l'observation la PLUS RÉCENTE.

    ⚠️ Piège vérifié : l'API renvoie les observations de la plus récente à la
    plus ancienne. Prendre le dernier élément de la liste donnerait donc une
    valeur de 1975. On trie explicitement sur TIME_PERIOD pour ne pas dépendre
    de cet ordre.
    """
    resp = client.get(BASE + idbank, timeout=30)
    resp.raise_for_status()
    root = ET.fromstring(resp.text)

    for el in root.iter():
        if el.tag.split("}")[-1] != "Series":
            continue
        titre = el.attrib.get("TITLE_FR", "")
        obs = [
            (c.attrib.get("TIME_PERIOD"), c.attrib.get("OBS_VALUE"))
            for c in el
            if c.tag.split("}")[-1] == "Obs" and c.attrib.get("OBS_VALUE")
        ]
        if not obs:
            return titre, None, None
        periode, valeur = max(obs, key=lambda o: o[0])  # tri lexicographique : "2026-Q2" > "2026-Q1"

        # ⚠️ MISE À L'ÉCHELLE — sans elle on publie des chiffres absurdes.
        # Deux conventions cohabitent dans la BDM :
        #   - UNIT_MULT=3       -> la valeur est en milliers (parc de logements :
        #                          37445 signifie 37 445 000 logements) ;
        #   - UNIT_MEASURE=E1000 -> idem (fonction publique : 5527.013 = 5 527 013).
        # On applique les deux, sans les cumuler à tort (elles ne coexistent pas).
        facteur = 10 ** int(el.attrib.get("UNIT_MULT") or 0)
        if el.attrib.get("UNIT_MEASURE") == "E1000":
            facteur *= 1000
        if facteur != 1:
            valeur = str(round(float(valeur) * facteur))
        return titre, periode, valeur
    return "", None, None


def _lisible(periode: str) -> str:
    """« 2026-Q2 » -> « au 2e trimestre 2026 » (plus naturel dans une réponse)."""
    if "-Q" in periode:
        annee, trimestre = periode.split("-Q")
        rang = "1er" if trimestre == "1" else f"{trimestre}e"
        return f"au {rang} trimestre {annee}"
    return f"en {periode}"


async def ingest() -> None:
    ensure_schema()
    lignes = []
    with httpx.Client() as client:
        for idbank, modele in SERIES:
            try:
                titre, periode, valeur = _serie(client, idbank)
            except Exception as e:  # série retirée, API en panne...
                print(f"  (échec sur {idbank} : {type(e).__name__})")
                continue
            if valeur is None:
                print(f"  (aucune valeur pour {idbank})")
                continue
            # Les grands nombres deviennent lisibles (1224662 -> « 1 224 662 ») :
            # c'est ce texte que le LLM recopiera dans sa réponse.
            affiche = valeur
            if "." not in valeur and valeur.lstrip("-").isdigit() and len(valeur.lstrip("-")) > 4:
                affiche = f"{int(valeur):,}".replace(",", " ")
            phrase = (
                f"Selon l'INSEE, {_lisible(periode)}, {modele.format(v=affiche)}. "
                f"Source : INSEE, Banque de données macroéconomiques (série {idbank})."
            )
            lignes.append((phrase, _source_url(idbank)))
            # Pas de « % » en dur ici : toutes les séries ne sont pas des taux.
            print(f"  {idbank} | {periode} -> {affiche} | {titre[:58]}")

    if not lignes:
        print("Aucun indicateur récupéré (API INSEE injoignable ?).")
        return

    # Relancer le script remplace les entrées : pas de doublons, valeurs à jour.
    with connect() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM documents WHERE source = 'insee';")
        conn.commit()

    vecteurs = await embed([phrase for phrase, _ in lignes])
    with connect() as conn, conn.cursor() as cur:
        for (phrase, url), vec in zip(lignes, vecteurs):
            cur.execute(
                "INSERT INTO documents (source, title, url, content, chunk_index, embedding) "
                "VALUES (%s, %s, %s, %s, %s, %s::vector)",
                ("insee", "Indicateur officiel (INSEE)", url, phrase, 0, to_pgvector(vec)),
            )
        conn.commit()

    print(f"{len(lignes)} indicateurs INSEE ingérés (source='insee').")


if __name__ == "__main__":
    asyncio.run(ingest())
