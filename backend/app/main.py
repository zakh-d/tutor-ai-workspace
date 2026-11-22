from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from .config import settings
from .db import engine
from .errors import DomainError, STATUS
from .api import router
from .public import router as public_router
from . import storage
from .calendar_api import router as calendar_router
from .mcp import http_app
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app):
    async with http_app.lifespan(app):
        yield

app=FastAPI(title='AI tutor workspace',version=settings().app_version,lifespan=lifespan)
app.add_middleware(CORSMiddleware,allow_origins=settings().cors_origins.split(','),allow_credentials=True,allow_methods=['GET','POST','PATCH','PUT'],allow_headers=['Authorization','Content-Type','Idempotency-Key','If-Match','X-CSRF-Token'])
@app.exception_handler(DomainError)
async def domain_error(request,exc):
    headers={}
    if exc.code=='unauthenticated':headers['WWW-Authenticate']='Bearer resource_metadata="'+settings().public_base_url+'/.well-known/oauth-protected-resource/mcp"'
    if exc.code=='rate_limited':headers['Retry-After']='60'
    return JSONResponse(exc.payload(),status_code=STATUS.get(exc.code,500),headers=headers)
@app.exception_handler(RequestValidationError)
async def validation_error(request,exc):
    return JSONResponse(DomainError('validation_error','Request validation failed.',{'fields':[{'loc':list(x['loc']),'message':x['msg']} for x in exc.errors()]}).payload(),status_code=422)
@app.middleware('http')
async def security_headers(request:Request,call_next):
    response=await call_next(request)
    response.headers.update({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store'})
    if request.url.path.startswith(('/public/','/a/')):
        response.headers['X-Robots-Tag']='noindex, nofollow'
        response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'" if request.url.path.startswith('/a/') else "default-src 'none'; frame-ancestors 'none'"
    return response
@app.get('/api/v1/version')
def version() -> dict[str, str]:
    return {'version': settings().app_version}

@app.get('/health/live')
def live():return {'status':'ok'}
@app.get('/health/ready')
def ready():
    try:
        with engine.connect() as conn:conn.execute(text('SELECT 1 FROM app.alembic_version LIMIT 1'))
        storage.client().head_bucket(Bucket=settings().s3_bucket)
        return {'status':'ready'}
    except Exception:return JSONResponse({'status':'not_ready'},status_code=503)
@app.get('/.well-known/oauth-protected-resource')
@app.get('/.well-known/oauth-protected-resource/mcp')
def resource_metadata():return {'resource':settings().mcp_audience,'authorization_servers':[settings().keycloak_issuer],'scopes_supported':['workspace:read','workspace:write','assignments:publish','grading:propose','history:read','history:undo','calendar:read','calendar:write'],'bearer_methods_supported':['header']}
app.include_router(router)
app.include_router(public_router)

app.include_router(calendar_router)
@app.api_route('/mcp',methods=['GET','POST','DELETE'],include_in_schema=False)
def mcp_redirect():
    from fastapi.responses import RedirectResponse
    return RedirectResponse('/mcp/',status_code=307)
app.mount("/mcp",http_app)

from .google_provider import GoogleError
@app.exception_handler(GoogleError)
async def google_error(request,exc):
    status=503 if exc.retryable else (403 if exc.status==403 else 409)
    code='provider_unavailable' if exc.retryable else ('forbidden' if status==403 else 'external_conflict')
    return JSONResponse(DomainError(code,'Google Calendar request failed.',retryable=exc.retryable).payload(),status_code=status)

from pathlib import Path
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os
web_root=Path(os.environ.get('FRONTEND_DIST','frontend/dist'))
if web_root.is_dir():
    if (web_root/'assets').is_dir():app.mount('/assets',StaticFiles(directory=web_root/'assets'),name='assets')
    @app.get('/{path:path}',include_in_schema=False)
    def spa(path:str):
        if path.startswith(('api/','public/','mcp','health/','.well-known/')):
            return JSONResponse(DomainError('not_found','Route not found.').payload(),status_code=404)
        return FileResponse(web_root/'index.html',headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'})
