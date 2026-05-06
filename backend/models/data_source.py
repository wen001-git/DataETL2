from sqlalchemy import String, Integer, Text, DateTime, Enum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime, timezone
import enum
from database import Base


class SourceType(str, enum.Enum):
    sftp = "sftp"
    upload = "upload"


class DataSource(Base):
    __tablename__ = "data_sources"
    __table_args__ = {"schema": "etl_meta"}

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    source_type: Mapped[SourceType] = mapped_column(Enum(SourceType), nullable=False)

    # SFTP fields (encrypted at application layer)
    sftp_host: Mapped[str | None] = mapped_column(String(255))
    sftp_port: Mapped[int | None] = mapped_column(Integer, default=22)
    sftp_user: Mapped[str | None] = mapped_column(String(100))
    sftp_password_enc: Mapped[str | None] = mapped_column(Text)
    sftp_remote_path: Mapped[str | None] = mapped_column(String(500))
    sftp_file_pattern: Mapped[str | None] = mapped_column(String(100), default="*.csv")

    # Target raw table (user-defined)
    target_raw_table: Mapped[str] = mapped_column(String(100), nullable=False)

    created_by: Mapped[int | None] = mapped_column(ForeignKey("etl_meta.users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
