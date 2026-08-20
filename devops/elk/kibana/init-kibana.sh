#!/bin/bash

set -euo pipefail

echo "=================================================="
echo " Kibana startup"
echo "=================================================="

echo "==> Waiting for Elasticsearch..."

until curl -fsS \
    -u "elastic:${ELASTIC_PASSWORD}" \
    "http://elasticsearch:9200/_cluster/health?wait_for_status=yellow" \
    >/dev/null
do
    sleep 2
done

echo "==> Elasticsearch is ready."

echo "==> Configuring kibana_system password..."

curl -fsS \
    -u "elastic:${ELASTIC_PASSWORD}" \
    -X POST \
    "http://elasticsearch:9200/_security/user/kibana_system/_password" \
    -H "Content-Type: application/json" \
    -d "{\"password\":\"${KIBANA_PASSWORD}\"}"

echo
echo "==> kibana_system password configured."

echo "==> Starting Kibana..."

/usr/local/bin/kibana-docker &
KIBANA_PID=$!

echo "==> Waiting for Kibana..."

until curl -fsS \
    "http://127.0.0.1:5601/kibana/api/status" \
    2>/dev/null \
    | grep -q '"level":"available"'
do
    if ! kill -0 "$KIBANA_PID" 2>/dev/null; then
        echo "ERROR: Kibana process stopped unexpectedly."
        exit 1
    fi

    sleep 2
done

# echo "==> Kibana is fully ready."

echo "==> Importing Kibana saved objects..."

curl -fsS \
    -u "elastic:${ELASTIC_PASSWORD}" \
    -X POST \
    "http://127.0.0.1:5601/kibana/api/saved_objects/_import?overwrite=true" \
    -H "kbn-xsrf: true" \
    --form file=@/usr/share/kibana/config/dashboard.ndjson

echo "==> Configuring user..."

curl -fsS -X PUT \
  -u "elastic:${ELASTIC_PASSWORD}" \
  -H 'Content-Type: application/json' \
  "http://elasticsearch:9200/_security/role/user_kibana" \
  --data-binary "@/usr/local/share/kibana/kibana-user-role.json"

  curl -fsS -X PUT \
  -u "elastic:${ELASTIC_PASSWORD}" \
  -H 'Content-Type: application/json' \
  "http://elasticsearch:9200/_security/user/factarena" \
  -d '{
    "password": "'"${KIBANA_APP_PASSWORD}"'",
    "roles": [
      "user_kibana"
    ],
    "full_name": "FactArena Kibana User"
  }'


echo "==> Kibana saved objects imported successfully."

echo "==> Kibana is running."

wait "$KIBANA_PID"