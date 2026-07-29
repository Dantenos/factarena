"""Ingestion d'INDICATEURS CHIFFRÉS OFFICIELS dans le corpus RAG (« le magasin de chiffres »).

POURQUOI : le corpus Wikipédia sait expliquer des faits, mais pas contredire un
CHIFFRE d'actualité (« la dépense publique, c'est X », « le chômage, c'est Y »).
Ici on ajoute une poignée d'indicateurs officiels sous forme de phrases-faits
sourcées (valeur + année + source), embeddées comme le reste. Résultat :
/rag/ask peut alors CITER un vrai chiffre officiel pour contredire une affirmation.

Ces entrées portent source='data_gouv' (distinctes du corpus Wikipédia).

⚠️ IMPORTANT — les chiffres officiels sont RÉACTUALISÉS régulièrement. Chaque
indicateur marqué `verifie=False` ci-dessous est un ordre de grandeur à
CONFIRMER et à dater contre sa source AVANT la soutenance. Ne présente jamais un
chiffre non vérifié comme une preuve.
"""
import asyncio

from app.db import connect, ensure_schema, to_pgvector
from app.mistral_client import embed

# Chaque indicateur : (phrase-fait sourcée, url de la source, verifie).
# verifie=True  -> valeur confirmée sur la source (URL précise).
# verifie=False -> ordre de grandeur bien établi, À VÉRIFIER/ACTUALISER + URL exacte.
INDICATEURS = [
    (
        "En moyenne sur l'année 2025, le taux de chômage en France au sens du BIT "
        "est de 7,7 % de la population active. Source : INSEE, 2025.",
        "https://www.insee.fr/fr/statistiques/8735266",
        True,
    ),
    (
        "En 2025, le taux de chômage des jeunes de 15 à 24 ans en France est de "
        "19,8 % en moyenne sur l'année. Source : INSEE, 2025.",
        "https://www.insee.fr/fr/statistiques/8735266",
        True,
    ),
    (
        "Fin 2024, la dette publique de la France représente environ 113 % du "
        "produit intérieur brut (PIB). Source : INSEE, comptes nationaux.",
        "https://www.insee.fr",
        False,  # à vérifier : valeur exacte + informations rapides INSEE de l'année
    ),
    (
        "En 2024, la dépense publique de la France représente environ 57 % du PIB, "
        "l'une des plus élevées de l'Union européenne. Source : INSEE / Eurostat.",
        "https://www.insee.fr",
        False,  # à vérifier : % exact et montant en milliards
    ),
]

# À CURER ENSUITE (chiffres pertinents pour les thèmes du jeu, à vérifier d'abord) :
#   - balance commerciale agroalimentaire de la France (source : Douanes / INSEE)
#   - nombre de défaillances d'entreprises par an (source : Banque de France)
#   - taux de renoncement aux soins (source : DREES / IRDES)
#   - solde migratoire annuel (source : INSEE)


async def ingest() -> None:
    ensure_schema()
    # On repart propre pour cette source : relancer le script ne fait pas de doublons.
    with connect() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM documents WHERE source = 'data_gouv';")
        conn.commit()

    textes = [texte for texte, _, _ in INDICATEURS]
    vecteurs = await embed(textes)

    with connect() as conn, conn.cursor() as cur:
        for (texte, url, _verifie), vec in zip(INDICATEURS, vecteurs):
            cur.execute(
                "INSERT INTO documents (source, title, url, content, chunk_index, embedding) "
                "VALUES (%s, %s, %s, %s, %s, %s::vector)",
                ("data_gouv", "Indicateur officiel", url, texte, 0, to_pgvector(vec)),
            )
        conn.commit()

    non_verifies = sum(1 for _, _, v in INDICATEURS if not v)
    print(f"{len(INDICATEURS)} indicateurs ingérés (source='data_gouv').")
    if non_verifies:
        print(f"  ⚠️  {non_verifies} sont marqués verifie=False -> à confirmer avant la soutenance.")


# À lancer dans le conteneur (appelle Mistral -> clé requise) :
#     docker compose exec ai-service python -m app.rag.ingest_indicateurs
if __name__ == "__main__":
    asyncio.run(ingest())
