"""Crée une manche contenant TOUS les clips jouables, pour un tri à l'écran.

Trier le corpus en base est fastidieux : on ne voit ni la vidéo, ni ce que le
joueur verra vraiment. Le plus rapide est de tout passer en revue dans le jeu
lui-même et de cliquer « cette vidéo ne correspond pas à l'affirmation » dès
qu'un clip cloche. Les signalements atterrissent dans ClipReport, et
app/rag/signalements.py les retire ensuite du tirage.

Ce n'est PAS une manche jouable normalement : elle contient des dizaines de
clips au lieu de dix, et sert uniquement à la curation. On la crée donc dans un
salon dédié, pour ne pas polluer les parties réelles — les claims déjà jouées
étant exclues par salon, les faire défiler ici ne les retirerait pas des vraies
parties.

Lancer :
    docker compose exec ai-service python -m app.rag.manche_de_tri
    docker compose exec ai-service python -m app.rag.manche_de_tri --email autre@exemple.fr
"""
import argparse
import secrets
import string
from datetime import datetime, timedelta, timezone

from app.db import connect

# Une heure : c'est le maximum accepté par le back, et il en faut au moins
# autant pour parcourir tout le corpus.
DUREE_SECONDES = 3600


def _cuid() -> str:
    alphabet = string.ascii_lowercase + string.digits
    return "c" + "".join(secrets.choice(alphabet) for _ in range(24))


def main() -> None:
    parseur = argparse.ArgumentParser(description="Manche de curation")
    parseur.add_argument("--email", default="admin@factarena.local",
                         help="propriétaire du salon de tri")
    options = parseur.parse_args()

    with connect() as conn, conn.cursor() as cur:
        cur.execute('SELECT id FROM "User" WHERE email = %s', (options.email,))
        utilisateur = cur.fetchone()
        if not utilisateur:
            print(f"Compte introuvable : {options.email}")
            return
        user_id = utilisateur[0]

        # Mêmes critères que le tirage normal : seuls les médias que le lecteur
        # sait afficher. Trier des clips injouables n'aurait aucun sens.
        cur.execute("""SELECT id FROM "Claim"
                       WHERE "mediaRef" LIKE '%upload.wikimedia%'
                          OR "mediaRef" LIKE '%/embed/%'
                          OR "mediaRef" LIKE '%plugins/video.php%'
                       ORDER BY category, text""")
        claims = [r[0] for r in cur.fetchall()]
        if not claims:
            print("Aucun clip jouable.")
            return

        maintenant = datetime.now(timezone.utc)
        room_id, round_id = _cuid(), _cuid()
        cur.execute(
            'INSERT INTO "Room" (id, name, status, "createdBy", "createdAt", "updatedAt") '
            'VALUES (%s, %s, %s::"RoomStatus", %s, %s, %s)',
            (room_id, f"Tri du corpus — {maintenant:%d/%m %H:%M}", "IN_PROGRESS",
             user_id, maintenant, maintenant),
        )
        # opensAt dans trois secondes, comme une manche normale : le compte à
        # rebours du front s'appuie dessus.
        ouvre = maintenant + timedelta(seconds=3)
        cur.execute(
            'INSERT INTO "Round" (id, "roomId", status, "opensAt", "locksAt", '
            '"createdAt", "updatedAt") '
            'VALUES (%s, %s, %s::"RoundStatus", %s, %s, %s, %s)',
            (round_id, room_id, "COUNTDOWN", ouvre,
             ouvre + timedelta(seconds=DUREE_SECONDES), maintenant, maintenant),
        )
        cur.executemany(
            'INSERT INTO "RoundClaim" (id, "roundId", "claimId", "orderIndex") '
            'VALUES (%s, %s, %s, %s)',
            [(_cuid(), round_id, claim_id, i) for i, claim_id in enumerate(claims)],
        )
        conn.commit()

    minutes = DUREE_SECONDES // 60
    print(f"Manche de tri créée : {len(claims)} clips, {minutes} minutes.\n")
    print(f"  https://localhost:8443/room/{room_id}\n")
    print("Parcours les clips, clique « cette vidéo ne correspond pas à")
    print("l'affirmation » sur ceux qui clochent, puis :")
    print("  docker compose exec ai-service python -m app.rag.signalements --ecarter")


if __name__ == "__main__":
    main()
