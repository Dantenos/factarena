# Politique des transitions de jeu

- Une manche ne peut être ouverte qu'une seule fois (`COUNTDOWN -> OPEN`).
- Une manche ne peut être verrouillée qu'une seule fois (`OPEN -> LOCKED`) et
  uniquement lorsque `locksAt` est atteint, y compris lors d'un appel manuel.
- Une manche doit contenir au moins un claim.
- Une manche sans prédiction peut être révélée ; aucun payout n'est créé.
- La révélation utilise une transition conditionnelle `LOCKED -> REVEALED`.
  Une seule requête concurrente peut donc régler les prédictions.
- Le règlement final `REVEALED -> FINISHED` est idempotent.
- Les opérations de jeu sont refusées ou ignorées pour une room `FINISHED`.
- Le `GameLoopService` ne conserve pas l'état de la manche en mémoire : au
  redémarrage, il relit les manches persistées et reprend les transitions
  dues (`COUNTDOWN`, `OPEN`, `LOCKED`, `REVEALED`).
