FROM alpine:3.22

RUN apk add --no-cache bash openssl

COPY generate-certs.sh /usr/local/bin/generate-certs.sh

RUN chmod +x /usr/local/bin/generate-certs.sh

ENTRYPOINT ["/usr/local/bin/generate-certs.sh"]