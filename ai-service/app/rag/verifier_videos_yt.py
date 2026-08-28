"""Détache les vidéos YouTube qui ne sont pas le contenu débunké.

Le collecteur retient le premier lecteur trouvé dans l'article. Or les médias
insèrent souvent leur propre production avant la publication qu'ils analysent :
habillage de rubrique, animation pédagogique, extrait de leur JT. On se
retrouve alors avec une affirmation sur une manifestation en Pologne illustrée
par un dessin animé de l'AFP expliquant comment vérifier une photo. Le joueur
ne peut rien en juger, et le clip est perdu.

Le critère de tri est la CHAÎNE. L'API oEmbed de YouTube est publique et rend
le titre et l'auteur sans clé. Si la chaîne est celle du média qui signe le
fact-check, la vidéo est sa production, pas le contenu litigieux. C'est net,
vérifiable, et ça ne repose sur aucune heuristique de ressemblance de texte —
une vidéo débunkée est souvent en polonais ou en russe, comparer son titre à
une affirmation française n'aurait rien donné.

On vide `mediaRef` au lieu de supprimer la claim : le texte et la source
restent utiles au RAG, seule la vidéo était mauvaise.

Lancer :
    docker compose exec ai-service python -m app.rag.verifier_videos_yt
"""
import re
import time

import httpx

from app.db import connect

OEMBED = "https://www.youtube.com/oembed"
ENTETES = {"User-Agent": "FactArena-42-project/0.1 (educational; contact via 42 school)"}

# Chaînes des rédactions présentes dans le corpus : leur contenu est du
# journalisme sur l'intox, jamais l'intox elle-même.
REDACTIONS = re.compile(
    r"\bAFP\b|Agence France|TF1|LCI|20 ?Minutes|France ?info|franceinfo|RTBF|"
    r"Le ?Monde|D[ée]codeurs|Brut|dpa|Defacto|Reuters|BFM",
    re.I,
)

# Vidéos d'habillage réutilisées d'un article à l'autre : même sans reconnaître
# la chaîne, une vidéo qui illustre plusieurs affirmations sans rapport entre
# elles ne peut pas être le contenu débunké de chacune.
SEUIL_REUTILISATION = 2


def _infos(video_id: str) -> tuple[str, str] | None:
    url = f"https://www.youtube.com/watch?v={video_id}"
    for _essai in range(3):
        try:
            r = httpx.get(OEMBED, params={"url": url, "format": "json"},
                          headers=ENTETES, timeout=25)
            if r.status_code == 200:
                d = r.json()
                return d.get("title", ""), d.get("author_name", "")
            # 401/403/404 : vidéo privée, supprimée ou géobloquée. Injouable
            # de toute façon, on la traite comme un rejet.
            if r.status_code in (401, 403, 404):
                return None
        except Exception:
            pass
        time.sleep(3)
    return None


def main() -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute('SELECT id, text, "mediaRef" FROM "Claim" WHERE "mediaRef" LIKE %s',
                    ("%/embed/%",))
        lignes = cur.fetchall()

    # Comptage des réutilisations avant toute décision.
    occurrences: dict[str, int] = {}
    for _i, _t, media in lignes:
        occurrences[media] = occurrences.get(media, 0) + 1

    print(f"{len(lignes)} claim(s) avec une vidéo YouTube.\n")
    a_detacher, gardes = [], []
    cache: dict[str, tuple[str, str] | None] = {}

    for claim_id, texte, media in lignes:
        trouve = re.search(r"/embed/([A-Za-z0-9_-]{11})", media)
        if not trouve:
            a_detacher.append((claim_id,))
            continue
        vid = trouve.group(1)

        if occurrences[media] > SEUIL_REUTILISATION:
            print(f"  rejet (réutilisée {occurrences[media]}x)  {texte[:56]}")
            a_detacher.append((claim_id,))
            continue

        if vid not in cache:
            cache[vid] = _infos(vid)
            time.sleep(1.2)
        infos = cache[vid]
        if infos is None:
            print(f"  rejet (indisponible)            {texte[:56]}")
            a_detacher.append((claim_id,))
            continue

        titre, chaine = infos
        if REDACTIONS.search(chaine) or REDACTIONS.search(titre):
            print(f"  rejet (chaîne « {chaine[:22]} »)  {texte[:48]}")
            a_detacher.append((claim_id,))
        else:
            gardes.append((chaine, titre, texte))

    if a_detacher:
        with connect() as conn, conn.cursor() as cur:
            cur.executemany('UPDATE "Claim" SET "mediaRef" = NULL WHERE id = %s', a_detacher)
            conn.commit()

    print(f"\n{len(a_detacher)} vidéo(s) détachée(s), {len(gardes)} conservée(s) :\n")
    for chaine, titre, texte in gardes:
        print(f"  [{chaine[:20]:20s}] {titre[:44]}")
        print(f"    -> {texte[:80]}")


if __name__ == "__main__":
    main()
