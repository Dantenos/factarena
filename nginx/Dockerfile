# ============================================================
# nginx — reverse proxy HTTPS/WSS, seul point d'entrée exposé.
# Génère un certificat AUTO-SIGNÉ au build (suffisant en dev : Chrome
# affiche un avertissement acceptable en local). Le certificat vit dans
# l'image, jamais dans le dépôt (cf. .gitignore : nginx/certs/).
# ============================================================
FROM nginx:1.27-alpine

# openssl pour générer le certificat auto-signé au moment du build.
# On ajoute un subjectAltName : les navigateurs modernes ignorent le CN et
# exigent un SAN (sans lui, le certificat est carrément invalide, pas juste
# "auto-signé").
RUN apk add --no-cache openssl \
    && mkdir -p /etc/nginx/certs \
    && openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
       -keyout /etc/nginx/certs/privkey.pem \
       -out /etc/nginx/certs/fullchain.pem \
       -subj "/C=FR/ST=Dev/L=Dev/O=FactArena/CN=localhost" \
       -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

# Notre configuration remplace la conf de site par défaut de l'image.
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80 443
