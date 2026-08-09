# ============================================================
# back-core (NestJS) — image de production multi-étapes.
# POURQUOI multi-étapes : on compile avec toutes les devDependencies, mais
# l'image finale ne réinstalle rien et ne dépend d'aucun accès réseau au
# démarrage.
# ============================================================

# ---- Étape build ----
FROM node:20-alpine AS build
WORKDIR /app
# openssl + libc6-compat : requis par le moteur Prisma sur Alpine (musl) pour
# 'prisma generate' (ici) et 'prisma db push' (au runtime). Sans eux, Prisma
# échoue à charger libssl (erreur classique Prisma + Alpine au 1er démarrage).
RUN apk add --no-cache openssl libc6-compat
# Je copie les deux manifestes AVANT le reste du code : tant qu'on ne touche
# pas aux dépendances, Docker réutilise cette couche et le build reste rapide.
#
# J'utilise « npm ci » et pas « npm install », et c'est important : npm ci
# installe EXACTEMENT ce qui est écrit dans package-lock.json, à la virgule
# près. Avec npm install, le « ^10.4.4 » du package.json veut dire « 10.4.4 ou
# n'importe quelle version supérieure compatible » : on est 5 à builder à des
# jours différents, donc chacun se retrouverait avec des versions différentes,
# et on passerait des soirées sur des bugs « bah chez moi ça marche ».
# En prime, npm ci est plus rapide et il refuse de builder si le lock n'est plus
# synchro avec le package.json — ce qui nous prévient au lieu de nous surprendre.
COPY package.json package-lock.json ./
RUN npm ci
# Le schéma Prisma est nécessaire pour générer le client avant le build.
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN npm run build

# ---- Étape runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# libssl (via openssl) pour le moteur Prisma appelé au démarrage ('db push').
RUN apk add --no-cache openssl libc6-compat
# On récupère les dépendances DÉJÀ installées à l'étape build (dont la CLI
# `prisma` ET le client généré). Copier tout node_modules garantit que
# `prisma db push` fonctionne hors-ligne au démarrage — donc pas de
# téléchargement réseau, et le « docker compose up » unique tient.
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
RUN mkdir -p /app/uploads/avatars && chown -R node:node /app/uploads
# Utilisateur non-root (sécurité).
USER node
EXPOSE 3000
# Au démarrage : `prisma db push` crée/synchronise la table users depuis le
# schéma (pas encore de migrations versionnées au stade squelette), PUIS on
# lance l'API. --skip-generate : le client est déjà généré à l'étape build.
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && node dist/main.js"]
