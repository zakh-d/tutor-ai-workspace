#!/bin/sh
# Local operator-only verification; no passwords or bearer tokens are printed.
set -eu
compose_env=${COMPOSE_ENV_FILE:-.env}
docker compose --env-file "$compose_env" exec -T keycloak sh -ec '
/opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080 --realm master --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null
/opt/keycloak/bin/kcadm.sh get clients -r tutor --fields clientId,protocol,defaultClientScopes
/opt/keycloak/bin/kcadm.sh get client-scopes -r tutor --fields name
'
docker compose --env-file "$compose_env" exec -T postgres psql -U postgres -d tutor -c "SELECT nspname, has_schema_privilege('app_runtime',oid,'USAGE') AS runtime_usage, has_schema_privilege('app_runtime',oid,'CREATE') AS runtime_create FROM pg_namespace WHERE nspname IN ('app','keycloak');"
