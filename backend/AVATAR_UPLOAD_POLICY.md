# Politique d'upload des avatars

Cette politique ne concerne que les avatars. Les clips video des manches sont
des references editoriales (`Claim.mediaRef` et `Claim.videoEndS`) et ne sont
pas traites par le pipeline d'upload d'avatars.

Les fichiers sont d'abord écrits avec une extension temporaire `.upload`.
Le backend vérifie ensuite leur signature binaire et extrait leurs dimensions
pour PNG, JPEG, GIF et WebP. Les dimensions sont limitées à 2048×2048 et
4 millions de pixels.

Après validation, le fichier est renommé avec l'extension réellement détectée
et son nom UUID est enregistré en base. Toute erreur supprime le fichier
temporaire ou le fichier final déjà créé.

Le nettoyage manuel des fichiers orphelins s'effectue avec :

```bash
npm run avatars:cleanup
```

Cette commande supprime les avatars non référencés en base et les fichiers
`.upload` vieux de plus d'une heure.
