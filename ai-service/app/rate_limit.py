"""Limiteur de débit simple, en mémoire (fenêtre glissante).

POURQUOI maison et pas une lib (slowapi...) : le besoin est simple — limiter le
nombre d'appels au LLM, qui coûte cher. Une lib serait une dépendance de plus à
justifier ; une fenêtre glissante de quelques lignes se lit et s'explique en
soutenance.

LIMITE ASSUMÉE : c'est un compteur EN MÉMOIRE, par processus. Il repart à zéro au
redémarrage et ne serait pas partagé entre plusieurs instances. C'est suffisant
pour notre service IA (un seul processus uvicorn) et pour démontrer le module ;
en production multi-instances on passerait par un stockage partagé (Redis).
"""
import time
from collections import defaultdict, deque


class RateLimiter:
    def __init__(self, max_requests: int, window_seconds: float):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        # Pour chaque clé (ex. une IP), on garde les horodatages des appels
        # récents. deque = on retire efficacement les plus vieux par la gauche.
        self._hits: dict[str, deque] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        """True si l'appel est autorisé, False s'il dépasse la limite."""
        now = time.monotonic()
        hits = self._hits[key]
        # On oublie les appels sortis de la fenêtre de temps.
        while hits and now - hits[0] > self.window_seconds:
            hits.popleft()
        if len(hits) >= self.max_requests:
            return False
        hits.append(now)
        return True
