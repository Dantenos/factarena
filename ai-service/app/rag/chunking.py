"""Découpage de texte en passages (chunks) pour la vectorisation.

Partagé par les deux scripts d'ingestion (dump Wikipédia généraliste et
Wikipédia politique via l'API). Un passage = un morceau cohérent d'environ
CHUNK_CHARS caractères, coupé sur des frontières de paragraphe (jamais au milieu
d'une phrase), pour qu'un vecteur porte une idée complète.
"""

DEFAULT_CHUNK_CHARS = 800


def chunk_text(text: str, size: int = DEFAULT_CHUNK_CHARS) -> list[str]:
    chunks: list[str] = []
    current = ""
    for para in text.split("\n"):
        para = para.strip()
        if not para:
            continue
        # Si ajouter ce paragraphe dépasse la taille cible, on ferme le passage
        # courant et on repart. Sinon on accumule.
        if current and len(current) + len(para) + 1 > size:
            chunks.append(current)
            current = para
        else:
            current = f"{current}\n{para}" if current else para
    if current:
        chunks.append(current)
    return chunks
