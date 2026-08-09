#!/bin/sh
# Script de sauvegarde automatique de la base de données PostgreSQL

BACKUP_DIR="/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/backup_${POSTGRES_DB}_${TIMESTAMP}.sql"

mkdir -p ${BACKUP_DIR}

echo "Starting database backup for ${POSTGRES_DB}..."
PGPASSWORD=${POSTGRES_PASSWORD} pg_dump -h postgres -U ${POSTGRES_USER} -d ${POSTGRES_DB} -F c -f ${BACKUP_FILE}

if [ $? -eq 0 ]; then
  echo "Backup successfully created: ${BACKUP_FILE}"
  # Conserver uniquement les 7 dernières sauvegardes (politique de rétention)
  find ${BACKUP_DIR} -type f -name "backup_*.sql" -mtime +7 -delete
else
  echo "Error: Database backup failed!" >&2
  exit 1
fi
