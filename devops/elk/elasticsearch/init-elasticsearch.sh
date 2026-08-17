#!/bin/bash

set -euo pipefail

echo "=================================================="
echo " Elasticsearch startup"
echo "=================================================="

echo "==> Starting Elasticsearch..."

exec /usr/local/bin/docker-entrypoint.sh elasticsearch

echo "==> Waiting for Elasticsearch to become ready..."

until curl -fsS \
    -u "elastic:${ELASTIC_PASSWORD}" \
    "http://127.0.0.1:9200/_cluster/health" \
    >/dev/null
do
    if ! kill -0 "$ES_PID" 2>/dev/null; then
        echo "ERROR: Elasticsearch stopped unexpectedly."
        exit 1
    fi

    sleep 2
done

echo "==> Elasticsearch is ready."

echo "==> Creating/updating factarena logs index template..."

curl -fsS \
    -u "elastic:${ELASTIC_PASSWORD}" \
    -X PUT \
    "http://127.0.0.1:9200/_index_template/factarena_logs" \
    -H "Content-Type: application/json" \
    -d '{
        "index_patterns": [
            "factarena-logs-*"
        ],
        "priority": 200,
        "template": {
            "settings": {
                "number_of_replicas": 0
            }
        }
    }'

echo "==> Factarena logs index template configured."

echo "==> Elasticsearch initialization completed."

wait "${ELASTICSEARCH_PID}"

echo "==> Elasticsearch is ready."