#!/bin/bash

set -euo pipefail

echo "=================================================="
echo " Logstash startup"
echo "=================================================="

echo "==> Waiting for Elasticsearch..."

until curl -fsS \
    -u "elastic:${ELASTIC_PASSWORD}" \
    "http://elasticsearch:9200/_cluster/health" \
    >/dev/null
do
    sleep 2
done

echo "==> Elasticsearch is ready."

# ------------------------------------------------------------------------------
# Logstash role
# ------------------------------------------------------------------------------

echo "==> Creating/updating Logstash role..."

curl -fsS \
    -u "elastic:${ELASTIC_PASSWORD}" \
    -X PUT \
    "http://elasticsearch:9200/_security/role/logstash_writer_role" \
    -H "Content-Type: application/json" \
    --data-binary "@/usr/local/share/logstash/logstash-role.json"

echo "==> Logstash role configured."

# ------------------------------------------------------------------------------
# Factarena logs index template
# ------------------------------------------------------------------------------

echo "==> Creating/updating factarena logs index template..."

curl -fsS \
    -u "elastic:${ELASTIC_PASSWORD}" \
    -X PUT \
    "http://elasticsearch:9200/_index_template/factarena_logs" \
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

# ------------------------------------------------------------------------------
# Logstash user
# ------------------------------------------------------------------------------

echo "==> Creating/updating Logstash user..."

curl -fsS \
    -u "elastic:${ELASTIC_PASSWORD}" \
    -X PUT \
    "http://elasticsearch:9200/_security/user/logstash_writer" \
    -H "Content-Type: application/json" \
    -d "{
        \"password\": \"${LOGSTASH_PASSWORD}\",
        \"roles\": [
            \"logstash_writer_role\"
        ],
        \"full_name\": \"Logstash writer\"
    }"

echo "==> Logstash user configured."

echo "==> Elasticsearch Logstash configuration completed."

# ------------------------------------------------------------------------------
# Start Logstash
# ------------------------------------------------------------------------------

echo "==> Starting Logstash..."

exec /usr/local/bin/docker-entrypoint