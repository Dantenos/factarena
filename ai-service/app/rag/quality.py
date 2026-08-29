"""Contrôle qualité des affirmations, appliqué AVANT insertion en base.

POURQUOI ICI PLUTÔT QU'APRÈS : jusqu'ici les mauvaises claims entraient, puis on
les nettoyait à la main sur une page de revue. C'est le mauvais sens. Une
affirmation qui annonce sa réponse ou qui est incompréhensible hors contexte n'a
aucune raison d'atteindre la base.

Les règles viennent toutes de défauts RÉELLEMENT rencontrés en jouant :

  - « Tim Walz affirme avoir combattu en Afghanistan alors que c'est faux » :
    la réponse est dans la phrase ;
  - « Cette vidéo montre une VÉRITABLE éruption » : 18 claims vraies écrites par
    nous annonçaient leur propre réponse ;
  - « Cette vidéo de duel entre un mini-cerf et un rhinocéros est-elle générée
    par IA ? » : une question, pas une affirmation ;
  - « Une vidéo prouve que le vol de Katy Perry est une arnaque » : reprend le
    point de vue du vérificateur, pas celui de la rumeur.

Ce module ne fait que des contrôles DÉTERMINISTES et gratuits. Le jugement plus
fin (ironie, cadrage implicite) reste du ressort de audit_claims.py, qui
interroge le modèle — trop coûteux pour être appliqué à chaque insertion.
"""
import re
import unicodedata


def _sans_accents(t: str) -> str:
    t = t.lower()
    t = unicodedata.normalize("NFD", t)
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


# Mots qui, dans une affirmation, révèlent qu'elle est VRAIE.
MARQUEURS_VRAI = re.compile(
    r"\b(veritable\w*|vraie?s?|authentiq\w+|reelle?s?|bien reel\w*|avere\w*)\b"
)
# Mots qui révèlent qu'elle est FAUSSE.
MARQUEURS_FAUX = re.compile(
    r"\b(fausse?s?|faux|truqu\w+|deepfake|manipul\w+|montage|canular|intox|"
    r"generee? par (l')?ia|arnaque|mise en scene|pretendu\w*|soi-disant)\b"
)
# Tournures du vérificateur : l'affirmation doit exprimer la RUMEUR, pas sa
# réfutation. « prouve que », « démontre que » trahissent l'article de débunk.
MARQUEURS_VERIFICATEUR = re.compile(r"\b(prouve\w*|demontre\w*|dementi\w*|contrairement a)\b")

LONGUEUR_MIN = 25
LONGUEUR_MAX = 300


def probleme(texte: str, label: str) -> str | None:
    """Renvoie la raison du rejet, ou None si l'affirmation est exploitable.

    `label` vaut 'TRUE' ou 'FALSE' : on ne cherche les marqueurs « vrai » que
    sur une claim vraie, et inversement. Une claim fausse a parfaitement le
    droit de contenir le mot « faux » si c'est la rumeur elle-même qui l'emploie
    (« les vidéos montrent de faux blessés »)... mais l'expérience montre que
    ces formulations viennent presque toujours du vérificateur. On les rejette,
    quitte à perdre quelques items : mieux vaut moins de claims que des claims
    devinables.
    """
    brut = texte.strip()
    if len(brut) < LONGUEUR_MIN:
        return "trop court pour être compris hors contexte"
    if len(brut) > LONGUEUR_MAX:
        return "trop long pour être lu en jeu"
    if brut.endswith("?"):
        return "formulée en question, pas en affirmation"

    normalise = _sans_accents(brut)
    if label == "TRUE" and MARQUEURS_VRAI.search(normalise):
        return "annonce qu'elle est vraie"
    if label == "FALSE" and MARQUEURS_FAUX.search(normalise):
        return "annonce qu'elle est fausse"
    if MARQUEURS_VERIFICATEUR.search(normalise):
        return "reprend le point de vue du vérificateur"
    return None


def filtrer(claims, index_texte: int, index_label: int):
    """Sépare les claims exploitables des rejetées.

    `claims` est une liste de tuples ; on indique où lire le texte et le label.
    Renvoie (gardees, [(claim, raison), ...]).
    """
    gardees, rejetees = [], []
    for claim in claims:
        raison = probleme(claim[index_texte], claim[index_label])
        if raison:
            rejetees.append((claim, raison))
        else:
            gardees.append(claim)
    return gardees, rejetees
