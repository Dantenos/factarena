"""Consulte les clips signalés par les joueurs, et permet de les écarter.

Le bouton « cette vidéo ne correspond pas à l'affirmation » écrit dans la table
ClipReport, mais rien ne permettait de relire ces remontées : la collecte ne
sert à rien sans consultation.

Le corpus étant constitué automatiquement, quelques vidéos ne correspondent pas
à leur énoncé, et les joueurs les repèrent avant nous — ils sont les seuls à
regarder chaque clip en entier. Un seul signalement suffit donc à écarter un
clip : avec plus de cent cinquante clips jouables, en perdre un à tort ne coûte
rien, alors qu'en garder un mauvais fait perdre des crédits à un joueur sur une
question qui n'avait pas de réponse.

Lecture seule par défaut. Avec --ecarter, tout clip signalé au moins une fois est
retiré du tirage : on vide leur mediaRef sans rien supprimer, le texte et la
source restant utiles au moteur de recherche.

Lancer :
    docker compose exec ai-service python -m app.rag.signalements
    docker compose exec ai-service python -m app.rag.signalements --ecarter
    docker compose exec ai-service python -m app.rag.signalements --ecarter --seuil 2
"""
import argparse

from app.db import connect


def main() -> None:
    parseur = argparse.ArgumentParser(description="Clips signalés par les joueurs")
    parseur.add_argument("--ecarter", action="store_true",
                         help="retire du tirage les clips atteignant le seuil")
    # Un seul signalement suffit à écarter le clip. Le corpus compte plus de
    # cent cinquante clips jouables : en perdre un à tort ne coûte rien, alors
    # qu'en laisser un mauvais fait perdre des crédits à un joueur sur une
    # question qui n'avait pas de réponse. Le déséquilibre entre les deux
    # erreurs justifie d'être strict.
    parseur.add_argument("--seuil", type=int, default=1,
                         help="nombre de signalements à partir duquel écarter (défaut 1)")
    options = parseur.parse_args()

    with connect() as conn, conn.cursor() as cur:
        cur.execute('''
            SELECT cl.id, count(*) AS signalements, cl.text, cl."truthLabel",
                   cl.category, cl."mediaRef"
            FROM "ClipReport" r
            JOIN "Claim" cl ON cl.id = r."claimId"
            GROUP BY cl.id, cl.text, cl."truthLabel", cl.category, cl."mediaRef"
            ORDER BY signalements DESC, cl.text
        ''')
        lignes = cur.fetchall()

    if not lignes:
        print("Aucun clip signalé.")
        return

    print(f"{len(lignes)} clip(s) signalé(s) :\n")
    a_ecarter = []
    for claim_id, nombre, texte, label, categorie, media in lignes:
        deja_hors = media is None
        marque = "déjà hors tirage" if deja_hors else f"{nombre} signalement(s)"
        print(f"  [{label:5s}|{str(categorie)[:14]:14s}] {marque}")
        print(f"    {texte[:88]}")
        if media:
            plateforme = ("facebook" if "facebook" in media
                          else "youtube" if "/embed/" in media else "wikimedia")
            print(f"    ({plateforme})")
        print()
        if nombre >= options.seuil and not deja_hors:
            a_ecarter.append((claim_id,))

    if not options.ecarter:
        if a_ecarter:
            print(f"{len(a_ecarter)} clip(s) atteignent le seuil de {options.seuil}. "
                  f"Relancer avec --ecarter pour les retirer du tirage.")
        return

    if not a_ecarter:
        print(f"Aucun clip n'atteint le seuil de {options.seuil}.")
        return

    with connect() as conn, conn.cursor() as cur:
        cur.executemany('UPDATE "Claim" SET "mediaRef" = NULL WHERE id = %s', a_ecarter)
        conn.commit()
    print(f"{len(a_ecarter)} clip(s) retiré(s) du tirage.")


if __name__ == "__main__":
    main()
