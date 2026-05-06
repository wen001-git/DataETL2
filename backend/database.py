# SQLAlchemy engine + session factory.
# `engine` connects to the `etl_meta` schema (system tables: users, data_sources,
# field_mappings, etc.) and is also reused by services to read/write the four
# data-layer schemas (etl_raw, etl_dwd, etl_dws, etl_ads).
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from config import get_settings

settings = get_settings()

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_recycle=3600,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
