# ============================================================
# frontend (React + Vite) — build du SPA puis service via `vite preview`.
# POURQUOI `vite preview` (et pas le serveur de dev) : il sert le BUILD de
# production, sans HMR, donc aucun WebSocket de dev qui polluerait la console
# derrière nginx. nginx proxifie / -> frontend:4173.
# ============================================================
FROM node:20-alpine
WORKDIR /app

# Dépendances d'abord, code ensuite : ça permet à Docker de garder cette couche
# en cache tant qu'on ne touche pas au package.json.
# « npm ci » et pas « npm install » : il installe pile ce que dit le
# package-lock.json, donc on a tous exactement le même front, aujourd'hui comme
# dans trois mois. (Même raisonnement que dans backend/Dockerfile.)
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Produit les fichiers statiques optimisés dans /app/dist.
RUN npm run build

EXPOSE 4173
# Sert le build sur 0.0.0.0:4173 (joignable par nginx sur le réseau interne).
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4173"]
