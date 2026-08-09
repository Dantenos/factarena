#!/bin/sh
# Script de restauration de la base de données PostgreSQL (Disaster Recovery)

if [ -z "$1" ]; then
  echo "Usage: $0 <path_to_backup_file.sql>"
  exit 1
fi

BACKUP_FILE=$1

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "Error: Backup file not found at ${BACKUP_FILE}"
  exit 1
fi

echo "Starting database restoration from ${BACKUP_FILE}..."
PGPASSWORD=${POSTGRES_PASSWORD} pg_restore -h postgres -U ${POSTGRES_USER} -d ${POSTGRES_DB} --clean --no-owner ${BACKUP_FILE}

if [ $? -eq 0 ]; then
  echo "Database successfully restored!"
else
  echo "Error: Database restoration failed!" >&2
  exit 1
fi
