#!/bin/bash

set -euo pipefail

echo "=================================================="
echo " Kibana startup"
echo "=================================================="

echo "==> Waiting for Elasticsearch..."

until curl -fsS \
    --cacert /usr/share/kibana/config/certs/ca/ca.crt \
    --cert /usr/share/kibana/config/certs/kibana/kibana-client.crt \
    --key /usr/share/kibana/config/certs/kibana/kibana-client.key \
    -u "elastic:${ELASTIC_PASSWORD}" \
    "https://elasticsearch:9200/_cluster/health?wait_for_status=yellow" \
    >/dev/null
do
    sleep 2
done

echo "==> Elasticsearch is ready."

echo "==> Configuring kibana_system password..."

curl -fsS \
    --cacert /usr/share/kibana/config/certs/ca/ca.crt \
    --cert /usr/share/kibana/config/certs/kibana/kibana-client.crt \
    --key /usr/share/kibana/config/certs/kibana/kibana-client.key \
    -u "elastic:${ELASTIC_PASSWORD}" \
    -X POST \
    "https://elasticsearch:9200/_security/user/kibana_system/_password" \
    -H "Content-Type: application/json" \
    -d "{\"password\":\"${KIBANA_PASSWORD}\"}"


echo "==> kibana_system password configured."

echo "==> Starting Kibana..."

/usr/local/bin/kibana-docker &
KIBANA_PID=$!

echo "==> Waiting for Kibana..."

until curl -fsS \
    --cacert /usr/share/kibana/config/certs/ca/ca.crt \
    --cert /usr/share/kibana/config/certs/kibana/kibana-client.crt \
    --key /usr/share/kibana/config/certs/kibana/kibana-client.key \
    "https://kibana:5601/kibana/api/status" \
    2>/dev/null \
    | grep -q '"level":"available"'
do
    if ! kill -0 "$KIBANA_PID" 2>/dev/null; then
        echo "ERROR: Kibana process stopped unexpectedly."
        exit 1
    fi

    sleep 2
done

echo "==> Kibana is ready for setups."

echo "==> Importing Kibana saved objects..."

curl -fsS \
    --cacert /usr/share/kibana/config/certs/ca/ca.crt \
    --cert /usr/share/kibana/config/certs/kibana/kibana-client.crt \
    --key /usr/share/kibana/config/certs/kibana/kibana-client.key \
    -u "elastic:${ELASTIC_PASSWORD}" \
    -X POST \
    "https://kibana:5601/kibana/api/saved_objects/_import?overwrite=true" \
    -H "kbn-xsrf: true" \
    --form file=@/usr/share/kibana/config/dashboard.ndjson

echo "==> Configuring user..."

curl -fsS \
    --cacert /usr/share/kibana/config/certs/ca/ca.crt \
    --cert /usr/share/kibana/config/certs/kibana/kibana-client.crt \
    --key /usr/share/kibana/config/certs/kibana/kibana-client.key \
    -u "elastic:${ELASTIC_PASSWORD}" \
    -H 'Content-Type: application/json' \
    -X PUT \
    "https://elasticsearch:9200/_security/role/user_kibana" \
    --data-binary "@/usr/local/share/kibana/kibana-user-role.json"

echo "==> Kibana role configured."

curl -fsS \
    --cacert /usr/share/kibana/config/certs/ca/ca.crt \
    --cert /usr/share/kibana/config/certs/kibana/kibana-client.crt \
    --key /usr/share/kibana/config/certs/kibana/kibana-client.key \
    -u "elastic:${ELASTIC_PASSWORD}" \
    -H 'Content-Type: application/json' \
    -X PUT \
    "https://elasticsearch:9200/_security/user/factarena" \
    -d '{
        "password": "'"${KIBANA_APP_PASSWORD}"'",
        "roles": [
        "user_kibana"
        ],
        "full_name": "FactArena Kibana User"
    }'


echo "==> Kibana saved objects imported successfully and FactArena user configured."

echo "==> Kibana is running."

wait "$KIBANA_PID"