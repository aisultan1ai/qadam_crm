"""Mail: mailboxes + threads + messages + attachments

Revision ID: 0017_mailboxes
Revises: 0016_external_channels
Create Date: 2026-08-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0017_mailboxes"
down_revision: Union[str, None] = "0016_external_channels"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    mail_direction = sa.Enum("inbound", "outbound", name="mail_direction")
    mail_status = sa.Enum("pending", "sent", "failed", "received", name="mail_status")

    op.create_table(
        "mailboxes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("reply_to_name", sa.String(length=200), nullable=True),
        sa.Column("imap_host", sa.String(length=200), nullable=False),
        sa.Column("imap_port", sa.Integer(), nullable=False, server_default="993"),
        sa.Column("imap_ssl", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("imap_user", sa.String(length=200), nullable=False),
        sa.Column("imap_password_enc", sa.Text(), nullable=True),
        sa.Column("imap_folder", sa.String(length=100), nullable=False, server_default="INBOX"),
        sa.Column("smtp_host", sa.String(length=200), nullable=False),
        sa.Column("smtp_port", sa.Integer(), nullable=False, server_default="587"),
        sa.Column("smtp_tls", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("smtp_user", sa.String(length=200), nullable=False),
        sa.Column("smtp_password_enc", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sync_interval_sec", sa.Integer(), nullable=False, server_default="120"),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_seen_uid", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "user_id", name="uq_mailboxes_tenant_user"),
    )
    op.create_index("ix_mailboxes_tenant_id", "mailboxes", ["tenant_id"])
    op.create_index("ix_mailboxes_user_id", "mailboxes", ["user_id"])
    op.create_index("ix_mailboxes_email", "mailboxes", ["email"])

    op.create_table(
        "mail_threads",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mailbox_id", sa.Integer(), sa.ForeignKey("mailboxes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("subject", sa.String(length=500), nullable=True),
        sa.Column("normalized_subject", sa.String(length=500), nullable=True),
        sa.Column("participants", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("linked_lead_id", sa.Integer(), sa.ForeignKey("tenant_leads.id", ondelete="SET NULL"), nullable=True),
        sa.Column("linked_task_id", sa.Integer(), sa.ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True),
        sa.Column("first_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_message_preview", sa.String(length=500), nullable=True),
        sa.Column("unread_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_mail_threads_tenant_id", "mail_threads", ["tenant_id"])
    op.create_index("ix_mail_threads_mailbox_id", "mail_threads", ["mailbox_id"])
    op.create_index("ix_mail_threads_normalized_subject", "mail_threads", ["normalized_subject"])
    op.create_index("ix_mail_threads_linked_lead_id", "mail_threads", ["linked_lead_id"])
    op.create_index("ix_mail_threads_linked_task_id", "mail_threads", ["linked_task_id"])
    op.create_index("ix_mail_threads_tenant_last", "mail_threads", ["tenant_id", "last_message_at"])
    op.create_index("ix_mail_threads_mailbox_last", "mail_threads", ["mailbox_id", "last_message_at"])

    op.create_table(
        "mail_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mailbox_id", sa.Integer(), sa.ForeignKey("mailboxes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("thread_id", sa.Integer(), sa.ForeignKey("mail_threads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("direction", mail_direction, nullable=False),
        sa.Column("status", mail_status, nullable=False, server_default="received"),
        sa.Column("message_id", sa.String(length=500), nullable=False),
        sa.Column("in_reply_to", sa.String(length=500), nullable=True),
        sa.Column("references", sa.Text(), nullable=True),
        sa.Column("imap_uid", sa.BigInteger(), nullable=True),
        sa.Column("from_addr", sa.String(length=320), nullable=False),
        sa.Column("from_name", sa.String(length=320), nullable=True),
        sa.Column("to_addrs", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("cc_addrs", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("subject", sa.String(length=500), nullable=True),
        sa.Column("body_text", sa.Text(), nullable=True),
        sa.Column("body_html", sa.Text(), nullable=True),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("mailbox_id", "message_id", name="uq_mail_messages_mailbox_msgid"),
    )
    op.create_index("ix_mail_messages_tenant_id", "mail_messages", ["tenant_id"])
    op.create_index("ix_mail_messages_mailbox_id", "mail_messages", ["mailbox_id"])
    op.create_index("ix_mail_messages_thread_id", "mail_messages", ["thread_id"])
    op.create_index("ix_mail_messages_thread_created", "mail_messages", ["thread_id", "sent_at"])
    op.create_index("ix_mail_messages_mailbox_uid", "mail_messages", ["mailbox_id", "imap_uid"])

    op.create_table(
        "mail_attachments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("message_id", sa.Integer(), sa.ForeignKey("mail_messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.String(length=500), nullable=False),
        sa.Column("content_type", sa.String(length=200), nullable=True),
        sa.Column("size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("stored_path", sa.String(length=500), nullable=False),
        sa.Column("content_id", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_mail_attachments_tenant_id", "mail_attachments", ["tenant_id"])
    op.create_index("ix_mail_attachments_message_id", "mail_attachments", ["message_id"])


def downgrade() -> None:
    for tbl in ("mail_attachments", "mail_messages", "mail_threads", "mailboxes"):
        op.drop_table(tbl)
    for enum_name in ("mail_status", "mail_direction"):
        sa.Enum(name=enum_name).drop(op.get_bind(), checkfirst=True)
