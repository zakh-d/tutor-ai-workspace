#!/bin/sh
# Call after importing Caddy's local CA or with production certificates.
set -eu
base=${PUBLIC_BASE_URL:-https://app.localhost}
issuer=${KEYCLOAK_ISSUER:-https://auth.localhost/realms/tutor}
curl --fail --silent --show-error "$base/health/live"
curl --fail --silent --show-error "$base/health/ready"
curl --fail --silent --show-error "$issuer/.well-known/openid-configuration" > /dev/null
code=$(curl --silent --output /dev/null --write-out '%{http_code}' "$base/api/v1/students")
[ "$code" = 401 ] || { echo "Expected unauthenticated REST 401, got $code" >&2; exit 1; }
curl --fail --silent --show-error "$base/.well-known/oauth-protected-resource" > /dev/null
printf '\nHealth, discovery and unauthenticated rejection passed.\n'
