#!/usr/bin/env python3
"""Real Keycloak authorization-code/PKCE and app/MCP smoke, with temporary identities.

Run with uv run python infra/oauth-smoke.py after starting the loopback test override.
Environment: KEYCLOAK_ADMIN_PASSWORD (required), KC_TEST_URL, APP_TEST_URL.
The temporary user and clients are always deleted; no credentials/tokens are printed.
"""
import base64
import hashlib
from html.parser import HTMLParser
import json
import os
import secrets
from urllib.parse import parse_qs, urlparse, urlunparse
from uuid import uuid4
import httpx

KC=os.getenv('KC_TEST_URL','http://127.0.0.1:58080')
APP=os.getenv('APP_TEST_URL','http://127.0.0.1:58000')
ISSUER=os.getenv('KEYCLOAK_ISSUER','https://auth.localhost/realms/tutor')
RESOURCE=os.getenv('MCP_AUDIENCE','https://app.localhost/mcp')
REDIRECT=os.getenv('PUBLIC_BASE_URL','https://app.localhost')+'/'
REALM='tutor'

class LoginForm(HTMLParser):
    action=None
    fields=None
    def __init__(self):
        super().__init__(); self.fields={}
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag=='form' and attrs.get('id')=='kc-form-login': self.action=attrs['action']
        if tag=='input' and attrs.get('type')=='hidden' and attrs.get('name'):
            self.fields[attrs['name']]=attrs.get('value','')

def claims(token):
    return json.loads(base64.urlsafe_b64decode(token.split('.')[1]+'==='))

def login(client_id,username,password,scope,resource=None):
    verifier=secrets.token_urlsafe(48)
    challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
    state=secrets.token_urlsafe(24)
    params={'client_id':client_id,'redirect_uri':REDIRECT,'response_type':'code',
            'scope':'openid '+scope,'state':state,'code_challenge':challenge,'code_challenge_method':'S256'}
    if resource: params['resource']=resource
    with httpx.Client(headers={'X-Forwarded-Proto':'https'},timeout=30) as browser:
        page=browser.get(KC+f'/realms/{REALM}/protocol/openid-connect/auth',params=params)
        assert page.status_code==200, f'Authorization page failed: {page.status_code}'
        form=LoginForm();form.feed(page.text)
        assert form.action, 'Keycloak login form missing'
        parsed=urlparse(form.action)
        action=KC+urlunparse(('', '',parsed.path,parsed.params,parsed.query,parsed.fragment))
        # This is a loopback-only transport override: Keycloak secure session cookies
        # are preserved while requests connect directly to the private HTTP listener.
        cookies='; '.join(f'{c.name}={c.value}' for c in browser.cookies.jar)
        response=browser.post(action,data={**form.fields,'username':username,'password':password},headers={'Cookie':cookies})
        assert response.status_code in (302,303), f'Login failed: {response.status_code}'
        query=parse_qs(urlparse(response.headers['location']).query)
        assert query.get('state')==[state] and 'code' in query, 'Authorization callback failed'
        result=browser.post(KC+f'/realms/{REALM}/protocol/openid-connect/token',data={
            'grant_type':'authorization_code','client_id':client_id,'redirect_uri':REDIRECT,
            'code':query['code'][0],'code_verifier':verifier})
        result.raise_for_status()
        return result.json()

def main():
    suffix=uuid4().hex[:12]
    username='infra-smoke-'+suffix
    password=secrets.token_urlsafe(32)
    temporary=[]; user_id=None
    with httpx.Client(timeout=30,headers={'X-Forwarded-Proto':'https'}) as client:
        token=client.post(KC+'/realms/master/protocol/openid-connect/token',data={
            'grant_type':'password','client_id':'admin-cli','username':os.getenv('KEYCLOAK_ADMIN','admin'),
            'password':os.environ['KEYCLOAK_ADMIN_PASSWORD']})
        token.raise_for_status()
        admin=KC+'/admin/realms/'+REALM
        headers={'Authorization':'Bearer '+token.json()['access_token']}
        try:
            scopes=client.get(admin+'/client-scopes',headers=headers).json()
            scope_ids={x['name']:x['id'] for x in scopes}
            created=client.post(admin+'/users',headers=headers,json={
                'username':username,'enabled':True,'email':username+'@example.invalid','emailVerified':True,
                'firstName':'Infrastructure','lastName':'Smoke',
                'credentials':[{'type':'password','value':password,'temporary':False}]})
            created.raise_for_status();user_id=created.headers['location'].rsplit('/',1)[1]
            for kind,audience in [('mcp',RESOURCE),('review','tutor-api')]:
                cid='infra-smoke-'+kind+'-'+suffix
                definition={'clientId':cid,'protocol':'openid-connect','enabled':True,'publicClient':True,
                    'standardFlowEnabled':True,'directAccessGrantsEnabled':False,'fullScopeAllowed':False,
                    'redirectUris':[REDIRECT],'attributes':{'pkce.code.challenge.method':'S256'},
                    'protocolMappers':[{'name':'audience','protocol':'openid-connect','protocolMapper':'oidc-audience-mapper',
                    'config':{'included.custom.audience':audience,'access.token.claim':'true','id.token.claim':'false'}}]}
                result=client.post(admin+'/clients',headers=headers,json=definition);result.raise_for_status()
                ident=result.headers['location'].rsplit('/',1)[1];temporary.append(ident)
                names=['basic','workspace:read']+(['tutor:review'] if kind=='review' else [])
                for name in names:
                    client.put(admin+f'/clients/{ident}/default-client-scopes/{scope_ids[name]}',headers=headers).raise_for_status()
            tutor=login('tutor-web',username,password,'workspace:read tutor:review')
            mcp_id='infra-smoke-mcp-'+suffix
            mcp=login(mcp_id,username,password,'workspace:read',RESOURCE)
            review=login('infra-smoke-review-'+suffix,username,password,'workspace:read tutor:review')
            assert claims(tutor['access_token'])['iss']==ISSUER
            assert RESOURCE in ([claims(mcp['access_token'])['aud']] if isinstance(claims(mcp['access_token'])['aud'],str) else claims(mcp['access_token'])['aud'])
            def auth(tokens):return {'Authorization':'Bearer '+tokens['access_token']}
            response=client.get(APP+'/api/v1/workspace',headers=auth(tutor))
            assert response.status_code==200, f'REST tutor failed {response.status_code}; claims aud={claims(tutor["access_token"]).get("aud")}, typ={claims(tutor["access_token"]).get("typ")}'
            assert client.get(APP+'/api/v1/workspace',headers=auth(mcp)).status_code==401
            release='/api/v1/assignments/'+str(uuid4())+'/reopen'
            denied=client.post(APP+release,headers={**auth(review),'Idempotency-Key':str(uuid4()),'If-Match':'"1"'},json={})
            assert denied.status_code==403, f'Non-tutor review authority not rejected: {denied.status_code}'
            endpoint=APP+os.getenv('MCP_TEST_PATH','/mcp')
            initialize={'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':'infra-httpx-smoke','version':httpx.__version__}}}
            accept={'Accept':'application/json, text/event-stream'}
            wrong=client.post(endpoint,headers={**auth(tutor),**accept},json=initialize,follow_redirects=True)
            assert wrong.status_code==401, f'REST audience accepted by MCP: {wrong.status_code}'
            good=client.post(endpoint,headers={**auth(mcp),**accept},json=initialize,follow_redirects=True)
            assert good.status_code==200 and 'protocolVersion' in good.text, f'MCP initialize failed: {good.status_code}'
            listed=client.post(endpoint,headers={**auth(mcp),**accept},json={'jsonrpc':'2.0','id':2,'method':'tools/list','params':{}},follow_redirects=True)
            assert listed.status_code==200 and 'tools' in listed.text
            assert all(name not in listed.text for name in ['release_grade','grading_release','reopen_submission','assignments_reopen'])
            refreshed=client.post(KC+f'/realms/{REALM}/protocol/openid-connect/token',data={'grant_type':'refresh_token','client_id':mcp_id,'refresh_token':mcp['refresh_token']})
            refreshed.raise_for_status()
            refresh=refreshed.json()['refresh_token']
            client.post(KC+f'/realms/{REALM}/protocol/openid-connect/revoke',data={'client_id':mcp_id,'token':refresh,'token_type_hint':'refresh_token'}).raise_for_status()
            revoked=client.post(KC+f'/realms/{REALM}/protocol/openid-connect/token',data={'grant_type':'refresh_token','client_id':mcp_id,'refresh_token':refresh})
            assert revoked.status_code==400 and revoked.json().get('error')=='invalid_grant'
            print('PASS: real PKCE tutor/MCP login, audience isolation, tutor-client restriction, MCP initialize/tools, refresh and revocation')
        finally:
            if user_id: client.delete(admin+'/users/'+user_id,headers=headers).raise_for_status()
            for ident in temporary: client.delete(admin+'/clients/'+ident,headers=headers).raise_for_status()
            print('Temporary Keycloak user and clients removed; app smoke workspace may remain for audit.')

if __name__=='__main__':main()
