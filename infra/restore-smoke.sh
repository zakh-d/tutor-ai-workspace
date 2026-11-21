#!/bin/sh
# Restore a live dump into an isolated, disposable PostgreSQL container.
set -eu
compose_env=${COMPOSE_ENV_FILE:-.env}
backup_dir=$(mktemp -d)
restore_container=tutor-restore-smoke-$$
cleanup() {
  docker rm -f "$restore_container" >/dev/null 2>&1 || true
  rm -rf "$backup_dir"
}
trap cleanup EXIT HUP INT TERM
umask 077
docker compose --env-file "$compose_env" exec -T postgres pg_dumpall -U postgres --globals-only > "$backup_dir/globals.sql"
docker compose --env-file "$compose_env" exec -T postgres pg_dump -U postgres -d tutor -Fc > "$backup_dir/tutor.dump"
docker run -d --name "$restore_container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17.4-bookworm >/dev/null
ready=0
for i in $(seq 1 30); do
  if docker exec "$restore_container" pg_isready -U postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ] || { echo 'Restore PostgreSQL failed readiness' >&2; exit 1; }
# Global role passwords are intentionally omitted: restore smoke validates schema/data.
for role in app_migrator app_runtime keycloak; do
  docker exec "$restore_container" psql -v ON_ERROR_STOP=1 -U postgres -c "CREATE ROLE $role;" >/dev/null
done
docker exec "$restore_container" createdb -U postgres tutor
docker exec -i "$restore_container" pg_restore -U postgres -d tutor --exit-on-error < "$backup_dir/tutor.dump"
docker exec "$restore_container" psql -v ON_ERROR_STOP=1 -U postgres -d tutor -c "SELECT schemaname, count(*) FROM pg_tables WHERE schemaname IN ('app','keycloak') GROUP BY schemaname;"
printf 'Isolated PostgreSQL dump/restore passed. Object completeness remains a separate check.\n'
