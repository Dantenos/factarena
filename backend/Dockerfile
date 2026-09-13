FROM node:20-alpine AS build
WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl libc6-compat

COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
RUN mkdir -p /app/uploads/avatars && chown -R node:node /app
USER node
EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && node dist/main.js"]
