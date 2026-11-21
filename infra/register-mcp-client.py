#!/usr/bin/env python3
"""Generate an operator-reviewed Keycloak client import; import using the admin console."""
import argparse
import json
from urllib.parse import urlparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--client-id', required=True)
parser.add_argument('--redirect-uri', required=True)
parser.add_argument('--resource', required=True)
args = parser.parse_args()
redirect = urlparse(args.redirect_uri)
if '*' in args.redirect_uri or not redirect.scheme or not redirect.netloc:
    parser.error('An exact absolute redirect URI is required; wildcards are forbidden')
if not args.resource.startswith('https://'):
    parser.error('The MCP resource must use HTTPS')
print(json.dumps({
    'clientId': args.client_id, 'enabled': True, 'publicClient': True,
    'standardFlowEnabled': True, 'directAccessGrantsEnabled': False,
    'redirectUris': [args.redirect_uri], 'fullScopeAllowed': False,
    'attributes': {'pkce.code.challenge.method': 'S256'},
    'defaultClientScopes': ['basic', 'profile', 'email'],
    'optionalClientScopes': ['workspace:read', 'workspace:write', 'assignments:publish',
                             'calendar:read', 'calendar:write', 'grading:propose',
                             'history:read', 'history:undo'],
    'protocolMappers': [{
        'name': 'MCP resource audience', 'protocol': 'openid-connect',
        'protocolMapper': 'oidc-audience-mapper', 'consentRequired': False,
        'config': {'included.custom.audience': args.resource,
                   'access.token.claim': 'true', 'id.token.claim': 'false'},
    }],
}, indent=2))
