"""Claims VRAIES à fort effet « attends, c'est vrai ça ? » — science et histoire.

POURQUOI CE SCRIPT : les premières vraies claims tirées de Wikimedia étaient
inutilisables en jeu. « Cette vidéo montre une tornade » illustrée par une
vidéo de tornade : personne n'hésite une seconde, donc le clip n'apporte rien.
Un bon item de FactArena doit provoquer le doute — c'est là que le joueur
exerce son esprit critique, et c'est tout l'objet du jeu.

D'où ce lot : des faits SURPRENANTS mais parfaitement établis. Une plante qui
bouge sans muscles, du sucre qui luit dans le noir, une LED qui change de
couleur au froid, un site d'alunissage rephotographié depuis l'orbite. Le
joueur doit pouvoir se dire « ça sent le fake » et se tromper. C'est
exactement l'inverse du réflexe habituel, et c'est pédagogiquement le plus
intéressant : tout ce qui est spectaculaire n'est pas faux.

POURQUOI UNE TABLE ÉCRITE À LA MAIN plutôt qu'une génération automatique :
la clé de réponse doit être certaine. Chaque ligne ci-dessous associe un
fichier Wikimedia précis, dont le nom décrit sans ambiguïté le contenu, à une
affirmation vérifiée. Aucune heuristique ne s'intercale, donc aucune claim ne
peut se retrouver avec un mauvais verdict — c'était le défaut des lots
précédents, où un titre mal interprété donnait un FAUX étiqueté VRAI.

Les vidéos Wikimedia passent par la balise <video>, qui n'affiche AUCUN titre :
contrairement à un embed YouTube, le lecteur ne vend pas la mèche.

Lancer :
    docker compose exec ai-service python -m app.rag.claims_wtf
"""
import hashlib
import secrets
import string
import time

import httpx

from app.db import connect

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
UA = "FactArena-42-project/0.1 (educational; contact via 42 school)"

# (fichier Commons, affirmation VRAIE, explication affichée à la révélation).
# Le nom du fichier décrit lui-même le contenu : c'est ce qui rend le verdict
# incontestable sans avoir à visionner chaque vidéo.
LOT = [
    # --- Biologie : le vivant qui ne se comporte pas comme on l'attend ---
    ("Mimosa pudica leaves folding when touched 1.ogv",
     "Il existe une plante qui replie ses feuilles en moins d'une seconde quand on la touche, "
     "alors qu'elle n'a ni muscles ni système nerveux.",
     "Le Mimosa pudica, ou sensitive. Le mouvement vient d'une chute brutale de pression dans "
     "les cellules de la base des feuilles, pas d'un muscle."),
    ("Mimosa pudica leaves folding when touched 3.ogv",
     "Une plante peut réagir à un contact plus vite qu'un humain ne referme la main.",
     "Le Mimosa pudica replie ses folioles en une fraction de seconde, par un mécanisme "
     "hydraulique et non nerveux."),
    ("Bioluminescent beetle Elateroidea (video).webm",
     "Certains insectes fabriquent leur propre lumière et brillent dans le noir sans aucune "
     "source extérieure.",
     "La bioluminescence : une réaction chimique entre luciférine et luciférase produit de la "
     "lumière presque sans chaleur."),
    ("Cephea cephea.webm",
     "Les méduses n'ont ni cerveau, ni cœur, ni sang, et peuplent les océans depuis plus de "
     "500 millions d'années.",
     "Elles fonctionnent avec un réseau de neurones diffus et échangent gaz et nutriments "
     "directement avec l'eau."),

    # --- Physique / chimie : le contre-intuitif de laboratoire ---
    ("Orange LED changes color when cooled by Liquid Nitrogen.webm",
     "Une LED orange change de couleur quand on la refroidit à l'azote liquide.",
     "Le froid élargit la bande interdite du semi-conducteur : les photons émis gagnent en "
     "énergie, la lumière se décale vers le vert."),
    ("Sugar phosphorescence at liquid nitrogen temperatu.ogv",
     "Du sucre ordinaire, refroidi très fortement, se met à luire dans le noir.",
     "À la température de l'azote liquide, la phosphorescence du saccharose devient visible : "
     "le froid empêche l'énergie de se dissiper en chaleur."),
    ("Thermochromism of sulfur.webm",
     "Le soufre change de couleur selon sa température, sans qu'on lui ajoute quoi que ce soit.",
     "Thermochromisme : la structure des molécules de soufre se réarrange avec la chaleur, ce "
     "qui modifie la lumière absorbée."),
    ("Condensing O2.ogv",
     "L'oxygène que nous respirons devient un liquide si on le refroidit suffisamment.",
     "En dessous de -183 °C, l'oxygène se condense en un liquide bleu pâle, et il est "
     "magnétique."),
    ("A freezing soap bubble in McGregor, Minnesota.webm",
     "Par grand froid, une bulle de savon gèle et se couvre de cristaux qui poussent à vue d'œil.",
     "L'eau du film savonneux cristallise à sa surface avant que la bulle n'éclate ou ne "
     "s'affaisse."),
    ("225W Tesla coil firing.ogv",
     "Un appareil conçu en 1891 fait jaillir des éclairs de plusieurs dizaines de centimètres "
     "dans l'air libre.",
     "La bobine Tesla : un transformateur résonant qui monte à des centaines de milliers de "
     "volts et ionise l'air."),
    ("2010-07-14-Blitze-Zeitlupe-1-32.ogv",
     "Ce qu'on prend pour un seul éclair est en réalité plusieurs décharges successives qui "
     "empruntent le même canal.",
     "Filmé au ralenti, un éclair révèle ses coups de retour successifs — d'où le scintillement "
     "perçu à l'œil nu."),
    ("FlyingLifterv1.ogv",
     "Un engin sans hélice, sans moteur et sans aucune pièce mobile peut décoller grâce à la "
     "seule haute tension.",
     "L'ionocraft, ou « lifter » : la haute tension ionise l'air et le vent ionique produit une "
     "poussée. Effet réel, mais très faible."),

    # --- Histoire : des images d'archives qu'on croirait truquées ---
    ("Hindenberg explodes.ogv",
     "En 1937, le plus grand dirigeable jamais construit a entièrement brûlé en moins d'une "
     "minute, devant les caméras.",
     "L'incendie du Hindenburg à Lakehurst, le 6 mai 1937. L'appareil est détruit en une "
     "trentaine de secondes ; 62 des 97 personnes à bord survivent."),
    ("AP11 FINAL APPROACH.ogv",
     "La descente finale d'Apollo 11 vers le sol lunaire a été filmée en direct depuis le "
     "hublot du module, en 1969.",
     "La caméra 16 mm embarquée a enregistré l'approche jusqu'au contact, le 20 juillet 1969."),
    ("A New Look at the Apollo 11 Landing Site.webm",
     "Une sonde en orbite autour de la Lune a rephotographié le site d'alunissage d'Apollo 11 : "
     "le matériel abandonné et les traces au sol y sont visibles.",
     "Les clichés du Lunar Reconnaissance Orbiter (NASA, 2009 et après) montrent l'étage de "
     "descente et les pistes laissées par les astronautes."),
    ("50th anniversary moon landing coin motion.webm",
     "Pour les 50 ans d'Apollo 11, une pièce de monnaie a été frappée avec une face incurvée "
     "en creux.",
     "La pièce commémorative américaine de 2019 est concave, une forme retenue pour épouser "
     "l'image de l'empreinte de botte et du casque."),

    # --- Géologie : des vidéos déjà en base, dont le texte était à refaire ---
    #
    # Ces fichiers portaient des affirmations du type « cette vidéo montre une
    # avalanche », qui décrivaient simplement ce qu'on voyait : aucun doute
    # possible, donc aucun intérêt. Les vidéos étaient bonnes, on leur redonne
    # un énoncé qui se discute.
    ("Everest April 18th 2014 Massive Avalanche Sweeps.webm",
     "La journée la plus meurtrière jamais connue sur l'Everest n'a tué que des guides "
     "népalais, pas un seul client étranger.",
     "L'avalanche du 18 avril 2014 dans la cascade de glace du Khumbu a tué seize Népalais "
     "qui installaient la voie pour les expéditions. La saison a ensuite été annulée."),
    ("A Six Day Time-lapse of Mauna Loa Erupting (CIRA 2022-12-04 - labels-1).webm",
     "Le plus grand volcan actif de la planète s'est réveillé en 2022 après trente-huit ans "
     "de silence.",
     "Le Mauna Loa, à Hawaï, occupe à lui seul la moitié de l'île. Son éruption de novembre "
     "2022 était la première depuis 1984."),
    ("Clepsydra geyser 20190715 111455 VID.webm",
     "Certains geysers jaillissent avec une régularité telle qu'on affiche l'heure de leur "
     "prochaine éruption aux visiteurs.",
     "À Yellowstone, plusieurs geysers ont un cycle assez stable pour être prévus à quelques "
     "minutes près, et les horaires sont publiés sur place."),
    ("2015 Nepal earthquake 01.ogv",
     "Le séisme de 2015 au Népal a déplacé Katmandou de plusieurs mètres vers le sud en "
     "moins d'une minute.",
     "Les mesures satellitaires ont établi un glissement d'environ trois mètres de la vallée "
     "de Katmandou, et un affaissement de l'Himalaya par endroits."),
    ("Annular Solar Eclipse 2010 Lake Nakuru, Kenya.webm",
     "Il existe des éclipses où la Lune est trop petite pour cacher le Soleil, et où il en "
     "reste un anneau de feu.",
     "Une éclipse annulaire : la Lune se trouve alors près de son point le plus éloigné de la "
     "Terre, son disque apparent ne suffit plus à couvrir celui du Soleil."),
    ("2013 Lushan earthquake aftershock in Chengdu.ogv",
     "Après un gros séisme, les répliques peuvent se poursuivre pendant des semaines, parfois "
     "des mois.",
     "La croûte terrestre se réajuste progressivement autour de la rupture initiale. Le nombre "
     "de répliques décroît selon une loi bien décrite, mais leur fin n'a rien de brutal."),
]

# Le pendant FAUX, dans le même registre. Ici on ne joue PAS sur des images
# truquées : on prend une vidéo authentique et on l'accompagne d'une idée reçue
# tenace. C'est le vrai piège du jeu, et il est symétrique du lot précédent —
# là on croit que c'est faux alors que c'est vrai, ici on croit que c'est vrai
# alors que c'est faux. Chaque énoncé est une erreur ARCHI-documentée, donc la
# clé de réponse reste incontestable.
#
# Aucun fichier n'est réutilisé d'un lot à l'autre : si la même vidéo servait
# une fois pour un VRAI et une fois pour un FAUX, un joueur attentif s'en
# servirait comme indice au lieu de réfléchir à l'énoncé.
LOT_FAUX = [
    ("2010-07-14-Blitze-2.ogv",
     "La foudre ne frappe jamais deux fois au même endroit.",
     "C'est l'inverse : la foudre privilégie les points hauts et conducteurs. L'Empire State "
     "Building est frappé plusieurs dizaines de fois par an."),
    ("Coldfrontthunderstorm1.webm",
     "Pour connaître la distance d'un orage, on compte les secondes entre l'éclair et le "
     "tonnerre : chaque seconde vaut un kilomètre.",
     "Le son parcourt environ 340 m par seconde : il faut donc compter à peu près trois "
     "secondes par kilomètre, pas une."),
    ("Spotted jelly (Mastigias papua) in Vancouver.webm",
     "Uriner sur une piqûre de méduse est le meilleur moyen de calmer la douleur.",
     "L'urine peut au contraire déclencher la décharge des cellules urticantes restées sur la "
     "peau. Les recommandations médicales privilégient le rinçage au vinaigre ou à l'eau de mer."),
    ("Mimosa pudica 1.ogv",
     "Cette plante replie ses feuilles grâce à un système nerveux comparable à celui des animaux.",
     "Aucune plante n'a de système nerveux. Le mouvement vient d'une perte d'eau brutale dans "
     "des cellules situées à la base des feuilles."),
    ("Flyback Powered Tesla Coil.webm",
     "Dès 1900, la bobine Tesla a servi à alimenter des villes entières en électricité sans fil.",
     "La tour de Wardenclyffe, censée le démontrer, n'a jamais fonctionné et le chantier a été "
     "abandonné faute de financement."),
    ("Mini Tesla coil.webm",
     "Nikola Tesla a imposé le courant continu, celui qui alimente aujourd'hui nos prises "
     "électriques.",
     "Tesla défendait le courant ALTERNATIF, contre le continu d'Edison. C'est l'alternatif qui "
     "a été retenu pour la distribution."),
    ("Nitrogen.ogv",
     "L'air que nous respirons est composé en majorité d'oxygène.",
     "Il contient environ 78 % d'azote pour seulement 21 % d'oxygène."),
    ("Bulles de savon.ogv",
     "Un film de bulle de savon est constitué d'une seule couche de molécules de savon.",
     "Il est formé de deux couches de savon enfermant une mince couche d'eau — c'est cette "
     "épaisseur qui produit les irisations."),
    ("Footage of the Hindenburg disaster paired with Herb Morrison's report.webm",
     "Le dirigeable Hindenburg a pris feu parce qu'il était gonflé à l'hélium.",
     "Il était gonflé à l'hydrogène, inflammable. L'hélium, ininflammable, lui avait été refusé "
     "à l'exportation par les États-Unis."),
    ("A New Look at the Apollo 11 Landing Site.ogv",
     "Aucune photographie du site d'alunissage d'Apollo 11 n'a jamais pu être prise depuis "
     "l'orbite lunaire.",
     "Le Lunar Reconnaissance Orbiter de la NASA le photographie depuis 2009 : l'étage de "
     "descente et les traces au sol y sont identifiables."),
    ("Oreo in liquid nitrogen.webm",
     "Au moindre contact avec la peau, une goutte d'azote liquide provoque immédiatement une "
     "brûlure.",
     "L'effet Leidenfrost interpose un film de vapeur : une projection brève roule sur la peau "
     "sans la brûler. Une immersion prolongée, elle, est bel et bien dangereuse."),
]


def _urls_commons(titres: list[str]) -> dict[str, str]:
    """Récupère l'URL de lecture directe de chaque fichier, par lots de 20."""
    trouves: dict[str, str] = {}
    for debut in range(0, len(titres), 20):
        lot = titres[debut:debut + 20]
        for essai in range(4):
            try:
                r = httpx.get(
                    COMMONS_API,
                    params={"action": "query", "format": "json",
                            "titles": "|".join(f"File:{t}" for t in lot),
                            "prop": "imageinfo", "iiprop": "url"},
                    headers={"User-Agent": UA}, timeout=40,
                )
                if r.status_code == 200:
                    for p in r.json().get("query", {}).get("pages", {}).values():
                        info = (p.get("imageinfo") or [{}])[0]
                        if info.get("url"):
                            trouves[p["title"][5:]] = info["url"]
                    break
            except Exception:
                pass
            time.sleep(4)
        time.sleep(2)
    return trouves


def main() -> None:
    tout = [(t, x, e, "TRUE") for t, x, e in LOT] + \
           [(t, x, e, "FALSE") for t, x, e in LOT_FAUX]
    urls = _urls_commons([t for t, _, _, _ in tout])

    with connect() as conn, conn.cursor() as cur:
        cur.execute('SELECT "sourceKey" FROM "Claim" WHERE "sourceKey" IS NOT NULL')
        deja = {r[0] for r in cur.fetchall()}

    alphabet = string.ascii_lowercase + string.digits
    lignes, absents = [], []
    for titre, texte, explication, label in tout:
        url = urls.get(titre)
        if not url:
            absents.append(titre)
            continue
        cle = "wtf:" + hashlib.sha1(titre.encode()).hexdigest()[:16]
        if cle in deja:
            continue
        # La page de description Commons sert de source vérifiable à la révélation.
        page = "https://commons.wikimedia.org/wiki/File:" + titre.replace(" ", "_")
        lignes.append(("c" + "".join(secrets.choice(alphabet) for _ in range(24)),
                       cle, texte, label, "wtf_science", page, url, explication, titre))

    if absents:
        print("Fichiers introuvables (ignorés) : " + ", ".join(absents))
    if not lignes:
        print("Rien à insérer.")
        return

    with connect() as conn, conn.cursor() as cur:
        cur.executemany(
            'INSERT INTO "Claim" (id, "sourceKey", text, "truthLabel", category, '
            '"sourceUrl", "mediaRef", "createdAt") '
            'VALUES (%s, %s, %s, %s::"ClaimTruthLabel", %s, %s, %s, now()) '
            'ON CONFLICT ("sourceKey") DO NOTHING',
            [l[:7] for l in lignes],
        )
        # L'explication de la révélation vit dans ClaimVerdict, pas sur Claim :
        # c'est la table que le front lit pour afficher « pourquoi ce verdict ».
        # confidence = 1.0 car ces faits sont établis, pas estimés par un modèle.
        cur.executemany(
            'INSERT INTO "ClaimVerdict" (id, "claimId", "verdictText", confidence, citations) '
            'VALUES (%s, %s, %s, 1.0, %s::jsonb) ON CONFLICT ("claimId") DO NOTHING',
            [("c" + "".join(secrets.choice(alphabet) for _ in range(24)), l[0], l[7],
              '[{"titre": "Wikimedia Commons", "url": "' + l[5] + '"}]') for l in lignes],
        )
        conn.commit()

    vrais = sum(1 for l in lignes if l[3] == "TRUE")
    print(f"{len(lignes)} claims insérées ({vrais} VRAI / {len(lignes) - vrais} FAUX) :\n")
    for ligne in lignes:
        print(f"  [{ligne[3]:5s}] {ligne[2][:90]}")


if __name__ == "__main__":
    main()
