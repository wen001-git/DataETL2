"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-05-03
"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE DATABASE IF NOT EXISTS `etl_meta`")

    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(64), nullable=False, unique=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column(
            "role",
            sa.Enum("admin", "editor", "viewer", name="userrole"),
            nullable=False,
            server_default="viewer",
        ),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
        schema="etl_meta",
    )

    op.create_table(
        "data_sources",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column(
            "source_type",
            sa.Enum("sftp", "upload", name="sourcetype"),
            nullable=False,
        ),
        sa.Column("sftp_host", sa.String(255)),
        sa.Column("sftp_port", sa.Integer, server_default="22"),
        sa.Column("sftp_user", sa.String(100)),
        sa.Column("sftp_password_enc", sa.Text),
        sa.Column("sftp_remote_path", sa.String(500)),
        sa.Column("sftp_file_pattern", sa.String(100), server_default="*.csv"),
        sa.Column("target_raw_table", sa.String(100), nullable=False),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("etl_meta.users.id")),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
        schema="etl_meta",
    )

    op.create_table(
        "field_mappings",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "data_source_id",
            sa.Integer,
            sa.ForeignKey("etl_meta.data_sources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("src_field", sa.String(100), nullable=False),
        sa.Column("dst_field", sa.String(100), nullable=False),
        sa.Column(
            "dst_type",
            sa.Enum("string", "integer", "float", "date", "datetime", "boolean", name="dsttype"),
            server_default="string",
        ),
        sa.Column("default_value", sa.String(255)),
        sa.Column("skip", sa.Boolean, server_default="0"),
        sa.Column("sort_order", sa.Integer, server_default="0"),
        sa.Column("target_dwd_table", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
        schema="etl_meta",
    )

    op.create_table(
        "filter_rules",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "data_source_id",
            sa.Integer,
            sa.ForeignKey("etl_meta.data_sources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("field_name", sa.String(100), nullable=False),
        sa.Column(
            "operator",
            sa.Enum(
                "eq", "ne", "gt", "lt", "gte", "lte",
                "contains", "not_contains", "is_null", "is_not_null",
                name="filteroperator",
            ),
            nullable=False,
        ),
        sa.Column("value", sa.String(500)),
        sa.Column("logic", sa.Enum("AND", "OR", name="filterlogic"), server_default="AND"),
        sa.Column("sort_order", sa.Integer, server_default="0"),
        sa.Column("created_at", sa.DateTime, nullable=False),
        schema="etl_meta",
    )

    op.create_table(
        "agg_rules",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "data_source_id",
            sa.Integer,
            sa.ForeignKey("etl_meta.data_sources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("src_dwd_table", sa.String(100), nullable=False),
        sa.Column("target_dws_table", sa.String(100), nullable=False),
        sa.Column("group_by_fields", sa.JSON),
        sa.Column("agg_functions", sa.JSON),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
        schema="etl_meta",
    )

    op.create_table(
        "ads_rules",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "data_source_id",
            sa.Integer,
            sa.ForeignKey("etl_meta.data_sources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("src_dws_table", sa.String(100), nullable=False),
        sa.Column("target_ads_table", sa.String(100), nullable=False),
        sa.Column("selected_fields", sa.JSON),
        sa.Column("order_by", sa.JSON),
        sa.Column("limit_rows", sa.Integer),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
        schema="etl_meta",
    )

    op.create_table(
        "executions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "data_source_id",
            sa.Integer,
            sa.ForeignKey("etl_meta.data_sources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "layer_from",
            sa.Enum("raw", "dwd", "dws", name="layername_from"),
            nullable=False,
        ),
        sa.Column(
            "layer_to",
            sa.Enum("dwd", "dws", "ads", name="layername_to"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum("running", "success", "failed", name="execstatus"),
            server_default="running",
        ),
        sa.Column("src_file", sa.String(500)),
        sa.Column("rows_success", sa.Integer, server_default="0"),
        sa.Column("rows_failed", sa.Integer, server_default="0"),
        sa.Column("error_message", sa.Text),
        sa.Column("error_sample", sa.JSON),
        sa.Column("started_at", sa.DateTime, nullable=False),
        sa.Column("finished_at", sa.DateTime),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("etl_meta.users.id")),
        schema="etl_meta",
    )


def downgrade() -> None:
    for table in ["executions", "ads_rules", "agg_rules", "filter_rules",
                  "field_mappings", "data_sources", "users"]:
        op.drop_table(table, schema="etl_meta")
