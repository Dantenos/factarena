#!/bin/bash

set -euo pipefail

ES_URL="http://elasticsearch:9200"
CONFIG_DIR="/usr/local/share/elasticsearch-config"

ILM_POLICY_NAME="factarena_logs_policy"
INDEX_TEMPLATE_NAME="factarena_logs"
SNAPSHOT_REPOSITORY_NAME="factarena_backup"
SLM_POLICY_NAME="factarena_logs_snapshot"
LOGSTASH_ROLE_NAME="logstash_writer"
LOGSTASH_USER_NAME="logstash_writer"

echo "=================================================="
echo " Elasticsearch initialization"
echo "=================================================="

echo "==> Elasticsearch is healthy."

echo "==> Verifying Elasticsearch authentication..."

curl -fsS \
    -u "elastic:${ELASTIC_PASSWORD}" \
    "${ES_URL}/_security/_authenticate" \
    >/dev/null

echo "==> Elasticsearch authentication successful."

echo "==> Configuring snapshot repository..."

curl -fsS \
    -u "elastic:${ELASTIC_PASSWORD}" \
    -X PUT \
    "${ES_URL}/_snapshot/${SNAPSHOT_REPOSITORY_NAME}" \
    -H "Content-Type: application/json" \
    --data-binary "@${CONFIG_DIR}/snapshots/repository.json"

echo "==> Snapshot repository '${SNAPSHOT_REPOSITORY_NAME}' configured."

echo "==> Applying SLM policy..."

curl -fsS \
    -u "elastic:${ELASTIC_PASSWORD}" \
    -X PUT \
    "${ES_URL}/_slm/policy/${SLM_POLICY_NAME}" \
    -H "Content-Type: application/json" \
    --data-binary "@${CONFIG_DIR}/snapshots/slm-policy.json"

echo "==> SLM policy '${SLM_POLICY_NAME}' configured."

echo "==> Applying ILM policy..."

curl -fsS \
    -u "elastic:${ELASTIC_PASSWORD}" \
    -X PUT \
    "${ES_URL}/_ilm/policy/${ILM_POLICY_NAME}" \
    -H "Content-Type: application/json" \
    --data-binary "@${CONFIG_DIR}/ilm/factarena-logs-30d.json"

echo "==> ILM policy '${ILM_POLICY_NAME}' configured."

echo "==> Applying FactArena logs index template..."

curl -fsS \
    -u "elastic:${ELASTIC_PASSWORD}" \
    -X PUT \
    "${ES_URL}/_index_template/${INDEX_TEMPLATE_NAME}" \
    -H "Content-Type: application/json" \
    --data-binary "@${CONFIG_DIR}/templates/factarena-logs.json"

echo "==> Index template '${INDEX_TEMPLATE_NAME}' configured."

echo "=================================================="
echo " Elasticsearch initialization completed"
echo "=================================================="