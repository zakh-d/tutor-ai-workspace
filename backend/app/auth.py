from dataclasses import dataclass
from functools import lru_cache
import jwt
from fastapi import Request
from .config import settings
from .errors import DomainError, require

@dataclass(frozen=True)
class Actor:
    issuer: str
    subject: str
    client_id: str
    scopes: frozenset[str]
    def permit(self, scope):
        require(scope in self.scopes,'forbidden','Required permission is missing.')
    def tutor(self):
        self.permit('tutor:review')
        require(self.client_id==settings().tutor_client_id,'forbidden','This action requires the tutor website client.')

@lru_cache
def jwks():
    cfg=settings()
    return jwt.PyJWKClient(cfg.keycloak_jwks_url or cfg.keycloak_issuer.rstrip('/')+'/protocol/openid-connect/certs',cache_keys=True,lifespan=300)

def verify(token, audience):
    try:
        key=jwks().get_signing_key_from_jwt(token)
        claims=jwt.decode(token,key.key,algorithms=['RS256'],audience=audience,issuer=settings().keycloak_issuer,options={'require':['exp','iat','sub','iss','aud']})
        if claims.get('typ') in ('ID','id_token'):
            raise ValueError('ID token')
        return Actor(claims['iss'],claims['sub'],claims.get('azp') or claims.get('client_id',''),frozenset(claims.get('scope','').split()))
    except jwt.PyJWKClientConnectionError:
        raise DomainError('provider_unavailable','Identity provider is unavailable.',retryable=True) from None
    except (jwt.PyJWTError,ValueError,KeyError):
        raise DomainError('unauthenticated','A valid access token is required.') from None

def authenticate(request:Request):
    auth=request.headers.get('authorization','')
    require(auth.startswith('Bearer '),'unauthenticated','A bearer access token is required.')
    return verify(auth[7:],settings().api_audience)
