"""Accès PostgreSQL du service IA — la table des vecteurs (le corpus RAG).

POURQUOI ce fichier vit ici et pas dans Prisma : Prisma (côté back NestJS) gère
les tables relationnelles (User, Room...), mais il gère mal le type `vector`.
La frontière décidée dans docs/ARCHITECTURE.md §5.2 : les tables VECTORIELLES
sont gérées par le service IA, dans la MÊME base. Les deux mondes se parlent par
`id`, jamais par jointure Prisma <-> vecteur.

POURQUOI UN SCHÉMA DÉDIÉ `rag` (et pas `public`) : le `prisma db push` du backend
gère le schéma `public` et veut SUPPRIMER toute table qu'il n'y connaît pas —
dont notre `documents`. En isolant nos tables dans le schéma `rag`, Prisma ne les
voit plus et ne peut plus les détruire. On règle le search_path sur `rag,public`
pour que nos requêtes non qualifiées visent `rag.documents`, tout en gardant
l'accès au type `vector` (extension installée dans `public`).

POURQUOI psycopg en SQL direct (et pas un ORM comme SQLAlchemy) : on a UNE table
et quelques requêtes. Un ORM serait une grosse dépendance pour rien, alors que
du SQL brut se lit et s'explique en soutenance ligne par ligne.
"""
import psycopg

from app.config import settings

# Schéma dédié aux tables du service IA (isolé de `public` que gère Prisma).
AI_SCHEMA = "rag"

# Dimension des vecteurs = celle du modèle mistral-embed (vérifiée en vrai à
# l'étape 0 : 1024). Elle DOIT correspondre exactement au modèle, sinon Postgres
# refuse l'insertion. Si un jour on change de modèle d'embedding, c'est ici que
# ça se répercute.
EMBED_DIM = 1024


def truncate_documents() -> None:
    """Vide la table du corpus. Pratique pour ré-ingérer proprement (une
    ré-exécution du script d'ingestion n'écrase pas : elle ajoute)."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute("TRUNCATE documents RESTART IDENTITY;")
        conn.commit()


def connect() -> psycopg.Connection:
    # Même DATABASE_URL que Prisma (base partagée), MAIS search_path = rag,public :
    # nos requêtes non qualifiées (`FROM documents`...) visent rag.documents, et le
    # type `vector` de l'extension (dans public) reste résolu.
    return psycopg.connect(
        settings.database_url, options=f"-c search_path={AI_SCHEMA},public"
    )


def to_pgvector(values: list[float]) -> str:
    """Formate un vecteur Python au format texte que pgvector sait lire : '[a,b,c]'.

    On passe par le texte (et pas un adaptateur dédié) pour ne PAS ajouter encore
    une dépendance : pgvector accepte nativement cette écriture, castée en
    ::vector au moment de l'INSERT.
    """
    return "[" + ",".join(f"{x:.6f}" for x in values) + "]"


def ensure_schema() -> None:
    """Crée la table du corpus et son index de similarité s'ils n'existent pas.

    Idempotent (IF NOT EXISTS partout) : on peut l'appeler à chaque démarrage
    sans risque d'écraser des données.

    Choix de l'index HNSW plutôt qu'ivfflat : HNSW n'a pas besoin de données
    préexistantes pour se construire (il s'enrichit au fil des insertions) et
    donne une meilleure qualité de recherche. `vector_cosine_ops` car on compare
    les embeddings par distance cosinus (l'opérateur <=>).
    """
    with connect() as conn, conn.cursor() as cur:
        # Notre schéma dédié (isolé de `public` que gère Prisma). Le search_path
        # de connect() fait ensuite atterrir la table dans `rag`.
        cur.execute(f"CREATE SCHEMA IF NOT EXISTS {AI_SCHEMA};")
        # L'extension est normalement déjà activée (postgres/init/01-pgvector.sql).
        # On la (re)demande explicitement dans `public` pour qu'elle reste partagée
        # et ne parte pas dans `rag` à cause du search_path.
        cur.execute("CREATE EXTENSION IF NOT EXISTS vector SCHEMA public;")
        cur.execute(
            f"""
            CREATE TABLE IF NOT EXISTS documents (
                id          serial PRIMARY KEY,
                source      text,            -- provenance (ex. 'wikipedia_fr') : pour mélanger des corpus plus tard
                title       text,            -- titre du document (sert de citation dans les réponses)
                url         text,            -- lien vers la source (citation)
                content     text NOT NULL,   -- le passage réellement vectorisé (un chunk)
                chunk_index int,             -- position du chunk dans le document d'origine
                embedding   vector({EMBED_DIM})
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS documents_embedding_hnsw
            ON documents USING hnsw (embedding vector_cosine_ops);
            """
        )
        conn.commit()
