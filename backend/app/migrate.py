"""Apply versioned migrations once under the app schema owner role."""
from pathlib import Path
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from .db import engine

def main():
    config = Config()
    config.set_main_option('script_location', str(Path(__file__).resolve().parents[1] / 'alembic'))
    with engine.begin() as connection:
        connection.execute(text('SELECT pg_advisory_xact_lock(718279003)'))
        connection.execute(text('SET LOCAL search_path TO app'))
        config.attributes['connection'] = connection
        command.upgrade(config, 'head')

if __name__ == '__main__':
    main()
