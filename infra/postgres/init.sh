#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_password="$APP_DB_PASSWORD" --set=migration_password="$MIGRATION_DB_PASSWORD" --set=keycloak_password="$KEYCLOAK_DB_PASSWORD" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE ROLE app_migrator LOGIN PASSWORD :'migration_password';
CREATE ROLE app_runtime LOGIN PASSWORD :'app_password';
CREATE ROLE keycloak LOGIN PASSWORD :'keycloak_password';
CREATE SCHEMA app AUTHORIZATION app_migrator;
CREATE SCHEMA keycloak AUTHORIZATION keycloak;
GRANT USAGE ON SCHEMA app TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
ALTER ROLE app_migrator SET search_path = app;
ALTER ROLE app_runtime SET search_path = app;
ALTER ROLE keycloak SET search_path = keycloak;
SQL
