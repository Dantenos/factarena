#!/bin/bash

set -euo pipefail

echo "==> Configuring Elasticsearch snapshot volume permissions..."

chown 1000:0 /snapshots
chmod 0750 /snapshots

echo "==> Snapshot volume permissions configured."