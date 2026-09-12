FROM nginx:1.27-alpine

RUN apk add --no-cache openssl \
    && mkdir -p /etc/nginx/certs \
    && openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
       -keyout /etc/nginx/certs/privkey.pem \
       -out /etc/nginx/certs/fullchain.pem \
       -subj "/C=FR/ST=Dev/L=Dev/O=FactArena/CN=localhost" \
       -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80 443
