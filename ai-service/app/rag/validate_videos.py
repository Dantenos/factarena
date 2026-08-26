"""Vérifie que chaque vidéo attachée à une claim est RÉELLEMENT jouable.

POURQUOI : trois pannes différentes sont apparues en jouant une manche, et
toutes donnaient le même symptôme — un clip inutilisable au milieu du jeu, donc
un joueur qui ne peut pas voter.

  1. « This video is private » : la vidéo YouTube existe mais son propriétaire
     l'a rendue privée. claims_from_videos.py, qui lit un TSV déjà constitué,
     ne faisait aucun contrôle (seul enrich_videos.py en faisait un).
  2. « Playback on other websites has been disabled » : la vidéo est publique
     mais interdit l'intégration hors YouTube.
  3. Écran noir sur une vidéo Wikimedia : le fichier est en Ogg Theora (.ogv),
     format dont Chrome a RETIRÉ le support en 2024. Le lecteur affiche alors
     du noir sans la moindre erreur.

Ce script repasse sur toutes les claims et efface le mediaRef de celles qui ne
peuvent pas être lues. On ne supprime pas la claim : sans vidéo, elle reste
parfaitement jouable en texte.

Lancer :
    docker compose exec ai-service python -m app.rag.validate_videos
"""
import httpx

from app.db import connect

# Formats réellement décodés par les navigateurs visés. Theora (.ogv) en est
# sorti : Chrome l'a retiré, et le sujet impose Chrome.
FORMATS_MORTS = (".ogv", ".ogg")


def _youtube_ok(client: httpx.Client, url: str) -> bool:
    """La vidéo YouTube est-elle publique ET intégrable ?

    L'endpoint oEmbed répond 200 dans ce cas, 401 pour une vidéo privée, 404
    pour une vidéo supprimée. Il ne demande aucune clé d'API — la YouTube Data
    API donnerait le champ `embeddable` mais n'est pas activée sur notre clé.
    """
    identifiant = url.split("/embed/", 1)[-1].split("?", 1)[0]
    try:
        r = client.get(
            "https://www.youtube.com/oembed",
            params={"url": f"https://www.youtube.com/watch?v={identifiant}", "format": "json"},
            timeout=20,
        )
        return r.status_code == 200
    except Exception:
        # En cas de doute (réseau), on garde la vidéo : mieux vaut la revérifier
        # plus tard que d'effacer un contenu valide sur un incident passager.
        return True


def main() -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute('SELECT id, "mediaRef" FROM "Claim" WHERE "mediaRef" IS NOT NULL')
        claims = cur.fetchall()

    print(f"{len(claims)} claims avec vidéo à vérifier...")
    a_effacer: list[tuple[str]] = []
    raisons = {"format": 0, "youtube": 0}

    with httpx.Client() as client:
        for claim_id, media in claims:
            base = media.split("?", 1)[0].lower()
            if base.endswith(FORMATS_MORTS):
                a_effacer.append((claim_id,))
                raisons["format"] += 1
                continue
            if "/embed/" in media and "youtube" in media:
                if not _youtube_ok(client, media):
                    a_effacer.append((claim_id,))
                    raisons["youtube"] += 1

    if not a_effacer:
        print("Toutes les vidéos sont jouables.")
        return

    with connect() as conn, conn.cursor() as cur:
        cur.executemany('UPDATE "Claim" SET "mediaRef" = NULL WHERE id = %s', a_effacer)
        conn.commit()

    print(
        f"{len(a_effacer)} vidéos retirées "
        f"({raisons['format']} au format non lu par Chrome, "
        f"{raisons['youtube']} privées ou non intégrables)."
    )


if __name__ == "__main__":
    main()
