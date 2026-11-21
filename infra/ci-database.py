"""Bootstrap and check the disposable PostgreSQL database used by CI.

Production uses infra/postgres/init.sh with separate migration/runtime roles.
Only run this helper against an isolated test database owned by the CI role.
"""
import argparse

from sqlalchemy import inspect, text
from app.db import Base, engine


def prepare():
    with engine.begin() as connection:
        connection.execute(text('CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION CURRENT_USER'))
        connection.execute(text('ALTER ROLE CURRENT_USER SET search_path TO app'))
    print('CI app schema and role search_path prepared')


def verify():
    expected = set(Base.metadata.tables) | {'alembic_version'}
    with engine.connect() as connection:
        inspector = inspect(connection)
        missing = expected - set(inspector.get_table_names(schema='app'))
        misplaced = expected & set(inspector.get_table_names(schema='public'))
        if missing or misplaced:
            raise RuntimeError(f'Invalid migration layout: missing={sorted(missing)}, public={sorted(misplaced)}')
        if connection.scalar(text('SELECT current_schema()')) != 'app':
            raise RuntimeError('CI runtime role search_path does not resolve app')
        if connection.scalar(text('SELECT count(*) FROM app.alembic_version')) != 1:
            raise RuntimeError('Expected one applied migration head')
    print(f'CI migration layout verified: {len(expected)} tables in app, none in public')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'verify'])
    args = parser.parse_args()
    if engine.dialect.name != 'postgresql':
        raise RuntimeError('CI requires PostgreSQL')
    {'prepare': prepare, 'verify': verify}[args.action]()
