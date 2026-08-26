"""Crée des claims VRAIES avec vidéo, depuis Wikimedia Commons.

POURQUOI CE SCRIPT EXISTE : le jeu souffrait d'un déséquilibre qui le rendait
devinable — sur les claims ayant une vidéo, la quasi-totalité était fausse. Un
joueur attentif gagnait en répondant « fake » dès qu'il voyait un extrait.

La cause est structurelle : les fact-checkeurs ne publient presque jamais de
verdict « c'est vrai ». Il faut donc chercher le vrai AILLEURS. Wikimedia
Commons est la source idéale pour de l'« insolite mais authentique » : ce sont
des documents réels, décrits et sourcés, et le fichier vidéo est servi en
direct — donc lu par la balise <video>, SANS lecteur tiers ni script externe.
C'est même plus propre qu'une iframe pour la console.

COMMENT ON ÉVITE D'INVENTER (règle d'or, docs/CLAIMS.md §2) : on n'utilise PAS
la recherche libre, mais les CATÉGORIES de Commons, curées à la main par ses
contributeurs. La recherche libre nous avait sorti « 60163 Tornado » pour une
tornade : c'est une locomotive à vapeur. Affirmer « cette vidéo montre une vraie
tornade » dessus aurait fabriqué une FAUSSE clé de réponse — exactement ce que
la règle d'or interdit. Une catégorie « Videos of tornadoes » ne contient, elle,
que de vraies tornades.

Lancer :
    docker compose exec ai-service python -m app.rag.claims_from_commons
"""
import hashlib
import secrets
import string
import time

import httpx

from app.db import connect

API = "https://commons.wikimedia.org/w/api.php"
ENTETES = {"User-Agent": "FactArena-42-project/0.1 (ft_transcendence; educational)"}

# ⚠️ FORMULATION NEUTRE OBLIGATOIRE. La première version écrivait « une
# VÉRITABLE éruption », « une VRAIE tornade », « authentique »... ce qui
# annonçait la réponse : 18 claims vraies se devinaient sans regarder la vidéo.
# Une affirmation doit se lire exactement comme une intox potentielle.
#
# (affirmation en français, catégorie Commons). La catégorie EST le garde-fou :
# son contenu est vérifié par des contributeurs, pas par un moteur approximatif.
# Une catégorie inexistante ou vide est simplement ignorée à l'exécution.
THEMES = [
    ("Cette vidéo montre une éruption volcanique.",
     "Category:Videos of volcanic eruptions"),
    ("Cette vidéo montre une tornade.",
     "Category:Videos of tornadoes"),
    ("Cette vidéo montre un impact de foudre.",
     "Category:Videos of lightning"),
    ("Cette vidéo montre une éclipse solaire.",
     "Category:Videos of solar eclipses"),
    ("Cette vidéo montre un lancement de fusée.",
     "Category:Videos of rocket launches"),
    ("Cette vidéo montre une avalanche.",
     "Category:Videos of avalanches"),
    ("Cette vidéo montre un geyser en éruption.",
     "Category:Videos of geysers"),
    ("Cette vidéo montre une baleine filmée en mer.",
     "Category:Videos of whales"),
    ("Cette vidéo montre une trombe marine.",
     "Category:Videos of waterspouts"),
    ("Cette vidéo montre les secousses d'un séisme.",
     "Category:Videos of earthquakes"),
    ("Cette vidéo montre une aurore polaire.",
     "Category:Videos of auroras"),
    ("Cette vidéo montre une éruption solaire vue depuis l'espace.",
     "Category:Videos of solar flares"),
]

# Formats réellement lisibles par un navigateur avec la balise <video>.
EXTENSIONS = (".webm", ".ogv", ".mp4")
PAR_CATEGORIE = 5


def _lisible(url: str) -> bool:
    """L'URL pointe-t-elle vers un fichier vidéo jouable ?

    ⚠️ Commons ajoute parfois une chaîne de requête (« ?download&content=... »).
    Tester l'extension sur l'URL brute rejetait donc TOUS les fichiers : il faut
    couper avant le « ? ».
    """
    return url.split("?", 1)[0].lower().endswith(EXTENSIONS)


def _fichiers(client: httpx.Client, categorie: str):
    """Vidéos d'une catégorie Commons, avec gestion du quota (429)."""
    for tentative in range(3):
        r = client.get(
            API,
            params={
                "action": "query", "format": "json", "generator": "categorymembers",
                "gcmtitle": categorie, "gcmtype": "file", "gcmlimit": PAR_CATEGORIE * 3,
                "prop": "imageinfo", "iiprop": "url",
            },
            headers=ENTETES, timeout=30,
        )
        # Wikimedia limite le débit : on patiente au lieu d'abandonner.
        if r.status_code == 429:
            time.sleep(5 * (tentative + 1))
            continue
        r.raise_for_status()
        break
    else:
        return []

    pages = r.json().get("query", {}).get("pages", {})
    resultats = []
    for page in pages.values():
        info = (page.get("imageinfo") or [{}])[0]
        url, fiche = info.get("url") or "", info.get("descriptionurl") or ""
        if not fiche or not _lisible(url):
            continue
        resultats.append((page.get("title", ""), url, fiche))
        if len(resultats) >= PAR_CATEGORIE:
            break
    return resultats


def main() -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute('SELECT "sourceUrl" FROM "Claim" WHERE "sourceUrl" IS NOT NULL;')
        deja = {r[0].rstrip("/") for r in cur.fetchall()}

    nouvelles = []
    with httpx.Client() as client:
        for affirmation, categorie in THEMES:
            try:
                trouves = _fichiers(client, categorie)
            except Exception as e:
                print(f"  ({categorie[9:40]} : {type(e).__name__})")
                continue
            if not trouves:
                print(f"  rien   {categorie[9:46]}")
                continue
            retenus = 0
            for _titre, url, fiche in trouves:
                if fiche.rstrip("/") in deja:
                    continue
                deja.add(fiche.rstrip("/"))
                cle = "commons:" + hashlib.sha1(fiche.encode()).hexdigest()[:16]
                nouvelles.append((cle, affirmation, "TRUE", "insolite_vrai", fiche, url))
                retenus += 1
            print(f"  {retenus:2} vidéo(s) {categorie[9:46]}")
            time.sleep(2)

    if not nouvelles:
        print("Aucune vidéo exploitable trouvée.")
        return

    # CUID obligatoire : le back valide tout identifiant contre /^c[a-z0-9]{24}$/.
    alphabet = string.ascii_lowercase + string.digits
    avec_id = [("c" + "".join(secrets.choice(alphabet) for _ in range(24)), *n) for n in nouvelles]

    with connect() as conn, conn.cursor() as cur:
        cur.executemany(
            'INSERT INTO "Claim" (id, "sourceKey", text, "truthLabel", category, '
            '"sourceUrl", "mediaRef", "createdAt") '
            'VALUES (%s, %s, %s, %s::"ClaimTruthLabel", %s, %s, %s, now()) '
            'ON CONFLICT ("sourceKey") DO NOTHING',
            avec_id,
        )
        conn.commit()

    print(f"\n{len(nouvelles)} claims VRAIES avec vidéo créées (Wikimedia Commons).")


if __name__ == "__main__":
    main()
