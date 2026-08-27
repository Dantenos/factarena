#!/usr/bin/env bash

set -euo pipefail

CERT_DIR="/certs"

CA_DIR="${CERT_DIR}/ca"
ES_DIR="${CERT_DIR}/elasticsearch"
HEALTH_DIR="${CERT_DIR}/healthchecker"
KIBANA_DIR="${CERT_DIR}/kibana"
LOGSTASH_DIR="${CERT_DIR}/logstash"
NGINX_DIR="${CERT_DIR}/nginx"

CA_KEY="${CA_DIR}/ca.key"
CA_CERT="${CA_DIR}/ca.crt"

CA_SUBJECT="/C=FR/ST=Hauts-de-France/L=Calais/O=FactArena/OU=ELK/CN=FactArena ELK CA"

echo "======================================"
echo " ELK Certificate Generator"
echo "======================================"

echo "[+] Certificate directory: ${CERT_DIR}"

mkdir -p \
    "$CA_DIR" \
    "$ES_DIR" \
    "$HEALTH_DIR" \
    "$KIBANA_DIR" \
    "$LOGSTASH_DIR" \
    "$NGINX_DIR"

# ============================================================
# CA
# ============================================================

if [[ ! -f "$CA_KEY" || ! -f "$CA_CERT" ]]; then

    echo "[+] Generating CA..."

    openssl genrsa \
        -out "$CA_KEY" \
        4096

    chmod 640 "$CA_KEY"

    openssl req \
        -x509 \
        -new \
        -key "$CA_KEY" \
        -sha256 \
        -days 3650 \
        -out "$CA_CERT" \
        -subj "$CA_SUBJECT"

    chmod 644 "$CA_CERT"

    echo "[+] CA generated"

else

    echo "[+] CA already exists"

fi


# ============================================================
# Certificate generation function
# ============================================================

generate_certificate() {

    local name="$1"
    local output_dir="$2"
    local dns_name="$3"
    local extended_usage="$4"

    local key="${output_dir}/${name}.key"
    local csr="${output_dir}/${name}.csr"
    local cert="${output_dir}/${name}.crt"
    local ext="${output_dir}/${name}.ext"

    if [[ -f "$key" && -f "$cert" ]]; then
        echo "[+] ${name} already exists"
        return
    fi

    echo "[+] Generating ${name}..."

    # OpenSSL extensions
    cat > "$ext" <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=${extended_usage}
subjectAltName=DNS:${dns_name}
EOF

    # Private key
    openssl genrsa \
        -out "$key" \
        4096

    chmod 640 "$key"

    # CSR
    openssl req \
        -new \
        -key "$key" \
        -out "$csr" \
        -subj "/C=FR/ST=Hauts-de-France/L=Calais/O=FactArena/OU=ELK/CN=${name}"

    # Certificate
    openssl x509 \
        -req \
        -in "$csr" \
        -CA "$CA_CERT" \
        -CAkey "$CA_KEY" \
        -CAcreateserial \
        -out "$cert" \
        -days 825 \
        -sha256 \
        -extfile "$ext"

    chmod 644 "$cert"

    # Remove temporary files
    rm -f "$csr" "$ext"

    echo "[+] ${name} generated"

}


# ============================================================
# Elasticsearch
# ============================================================

generate_certificate \
    "elasticsearch" \
    "$ES_DIR" \
    "elasticsearch" \
    "serverAuth"


# ============================================================
# Healthchecker
# ============================================================

generate_certificate \
    "healthchecker" \
    "$HEALTH_DIR" \
    "healthchecker" \
    "clientAuth"


# ============================================================
# Kibana client
# ============================================================

generate_certificate \
    "kibana-client" \
    "$KIBANA_DIR" \
    "kibana" \
    "clientAuth"


# ============================================================
# Kibana server
# ============================================================

generate_certificate \
    "kibana-server" \
    "$KIBANA_DIR" \
    "kibana" \
    "serverAuth"


# ============================================================
# Logstash
# ============================================================

generate_certificate \
    "logstash" \
    "$LOGSTASH_DIR" \
    "logstash" \
    "clientAuth"


# ============================================================
# Nginx client
# ============================================================

generate_certificate \
    "nginx-client" \
    "$NGINX_DIR" \
    "nginx" \
    "clientAuth"


# ============================================================
# Nginx server
# ============================================================

generate_certificate \
    "nginx-server" \
    "$NGINX_DIR" \
    "nginx" \
    "serverAuth"


# ============================================================
# Logstash PKCS#8 key
# ============================================================

if [[ ! -f "${LOGSTASH_DIR}/logstash.pkcs8.key" ]]; then

    echo "[+] Generating Logstash PKCS#8 private key..."

    openssl pkcs8 \
        -topk8 \
        -inform PEM \
        -outform PEM \
        -nocrypt \
        -in "${LOGSTASH_DIR}/logstash.key" \
        -out "${LOGSTASH_DIR}/logstash.pkcs8.key"

    chmod 640 "${LOGSTASH_DIR}/logstash.pkcs8.key"

else

    echo "[+] Logstash PKCS#8 key already exists"

fi


# ============================================================
# Cleanup
# ============================================================

rm -f "${CA_DIR}/ca.srl"

# ============================================================
# Permissions
# ============================================================

echo "[+] Setting certificate permissions..."

# Elasticsearch / Elastic images use UID 1000 and group 0
# chown -R 1000:0 "$CERT_DIR"

# Directories
find "$CERT_DIR" -type d -exec chmod 755 {} \;

# Certificates
find "$CERT_DIR" -type f -name "*.crt" -exec chmod 644 {} \;

# Private keys
find "$CERT_DIR" -type f -name "*.key" -exec chmod 644 {} \;

# ============================================================
# Verification
# ============================================================

echo
echo "======================================"
echo " Generated files"
echo "======================================"

find "$CERT_DIR" -type f -print

echo
echo "[+] Verifying CA..."

openssl x509 \
    -in "$CA_CERT" \
    -noout \
    -subject \
    -issuer \
    -dates

echo
echo "[+] Verifying Elasticsearch certificate..."

openssl x509 \
    -in "${ES_DIR}/elasticsearch.crt" \
    -noout \
    -subject \
    -issuer \
    -ext subjectAltName

echo
echo "======================================"
echo " Certificate generation completed"
echo "======================================"