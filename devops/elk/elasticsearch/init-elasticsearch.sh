#!/bin/bash

set -euo pipefail

echo "=================================================="
echo " Elasticsearch initialization"
echo "=================================================="

echo "==> Starting Elasticsearch..."

/usr/local/bin/docker-entrypoint.sh eswrapper &
ES_PID=$!

cleanup() {
    echo "==> Stopping Elasticsearch..."
    kill "$ES_PID" 2>/dev/null || true
    wait "$ES_PID" 2>/dev/null || true
}

trap cleanup SIGTERM SIGINT

echo "==> Waiting for Elasticsearch..."

until curl -fsS \
    -u "elastic:${ELASTIC_PASSWORD}" \
    "http://127.0.0.1:9200/_security/_authenticate" \
    >/dev/null
do
    if ! kill -0 "$ES_PID" 2>/dev/null; then
        echo "ERROR: Elasticsearch stopped unexpectedly."
        exit 1
    fi

    sleep 2
done

echo "==> Elasticsearch is healthy."

echo "==> Verifying Elasticsearch authentication..."

curl -fsS \
    -u "elastic:${ELASTIC_PASSWORD}" \
    "http://127.0.0.1:9200/_security/_authenticate" \
    >/dev/null

echo "==> Elasticsearch authentication successful."

echo "==> Configuring snapshot repository..."

curl -fsS \
    -u "elastic:${ELASTIC_PASSWORD}" \
    -X PUT \
    "http://127.0.0.1:9200/_snapshot/factarena_backup" \
    -H "Content-Type: application/json" \
    --data-binary "@/usr/local/share/elasticsearch-config/snapshots/repository.json"

echo "==> Snapshot repository 'factarena_backup' configured."

echo "==> Applying SLM policy..."

curl -fsS \
    -u "elastic:${ELASTIC_PASSWORD}" \
    -X PUT \
    "http://127.0.0.1:9200/_slm/policy/factarena_logs_snapshot" \
    -H "Content-Type: application/json" \
    --data-binary "@/usr/local/share/elasticsearch-config/snapshots/slm-policy.json"

echo "==> SLM policy 'factarena_logs_snapshot' configured."

echo "==> Applying ILM policy..."

curl -fsS \
    -u "elastic:${ELASTIC_PASSWORD}" \
    -X PUT \
    "http://127.0.0.1:9200/_ilm/policy/factarena_logs_policy" \
    -H "Content-Type: application/json" \
    --data-binary "@/usr/local/share/elasticsearch-config/ilm/factarena-logs-30d.json"

echo "==> ILM policy 'factarena_logs_policy' configured."

echo "==> Applying FactArena logs index template..."

curl -fsS \
    -u "elastic:${ELASTIC_PASSWORD}" \
    -X PUT \
    "http://127.0.0.1:9200/_index_template/factarena_logs" \
    -H "Content-Type: application/json" \
    --data-binary "@/usr/local/share/elasticsearch-config/templates/factarena-logs.json"

echo "==> Index template 'factarena_logs' configured."

echo "=================================================="
echo " Elasticsearch initialization completed"
echo "=================================================="

wait "$ES_PID"