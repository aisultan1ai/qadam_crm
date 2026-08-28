"""External channels: Telegram/WhatsApp/Instagram inbox

Revision ID: 0016_external_channels
Revises: 0015_manager_availability
Create Date: 2026-08-27
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0016_external_channels"
down_revision: Union[str, None] = "0015_manager_availability"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    channel_kind = sa.Enum("telegram", "whatsapp", "instagram", name="channel_kind")
    msg_direction = sa.Enum("inbound", "outbound", name="external_message_direction")
    msg_status = sa.Enum("pending", "sent", "delivered", "read", "failed", name="external_message_status")
    auto_reply_kind = sa.Enum("welcome", "off_hours", "keyword", name="auto_reply_kind")

    op.create_table(
        "external_channels",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", channel_kind, nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("provider_config", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("external_identifier", sa.String(length=200), nullable=True),
        sa.Column("webhook_secret", sa.String(length=120), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_external_channels_tenant_id", "external_channels", ["tenant_id"])
    op.create_index("ix_external_channels_tenant_kind", "external_channels", ["tenant_id", "kind"])

    op.create_table(
        "external_contacts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel_id", sa.Integer(), sa.ForeignKey("external_channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("external_id", sa.String(length=200), nullable=False),
        sa.Column("username", sa.String(length=200), nullable=True),
        sa.Column("display_name", sa.String(length=300), nullable=True),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column("avatar_url", sa.String(length=500), nullable=True),
        sa.Column("linked_lead_id", sa.Integer(), sa.ForeignKey("tenant_leads.id", ondelete="SET NULL"), nullable=True),
        sa.Column("is_blocked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("channel_id", "external_id", name="uq_external_contacts_channel_external"),
    )
    op.create_index("ix_external_contacts_tenant_id", "external_contacts", ["tenant_id"])
    op.create_index("ix_external_contacts_channel_id", "external_contacts", ["channel_id"])
    op.create_index("ix_external_contacts_linked_lead_id", "external_contacts", ["linked_lead_id"])

    op.create_table(
        "external_conversations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel_id", sa.Integer(), sa.ForeignKey("external_channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("contact_id", sa.Integer(), sa.ForeignKey("external_contacts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("assignee_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_message_preview", sa.String(length=500), nullable=True),
        sa.Column("unread_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_closed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("channel_id", "contact_id", name="uq_external_conversations_channel_contact"),
    )
    op.create_index("ix_external_conversations_tenant_id", "external_conversations", ["tenant_id"])
    op.create_index("ix_external_conversations_channel_id", "external_conversations", ["channel_id"])
    op.create_index("ix_external_conversations_contact_id", "external_conversations", ["contact_id"])
    op.create_index("ix_external_conversations_assignee_id", "external_conversations", ["assignee_id"])
    op.create_index(
        "ix_external_conversations_tenant_last", "external_conversations", ["tenant_id", "last_message_at"]
    )
    op.create_index(
        "ix_external_conversations_channel_last", "external_conversations", ["channel_id", "last_message_at"]
    )

    op.create_table(
        "external_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("conversation_id", sa.Integer(), sa.ForeignKey("external_conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("direction", msg_direction, nullable=False),
        sa.Column("status", msg_status, nullable=False, server_default="pending"),
        sa.Column("sender_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("external_message_id", sa.String(length=200), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("media", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("is_auto", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_external_messages_tenant_id", "external_messages", ["tenant_id"])
    op.create_index("ix_external_messages_conversation_id", "external_messages", ["conversation_id"])
    op.create_index("ix_external_messages_external_message_id", "external_messages", ["external_message_id"])
    op.create_index("ix_external_messages_conv_created", "external_messages", ["conversation_id", "created_at"])
    op.create_index("ix_external_messages_tenant_created", "external_messages", ["tenant_id", "created_at"])

    op.create_table(
        "auto_reply_rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel_id", sa.Integer(), sa.ForeignKey("external_channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", auto_reply_kind, nullable=False),
        sa.Column("trigger_config", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("response_text", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_auto_reply_rules_tenant_id", "auto_reply_rules", ["tenant_id"])
    op.create_index("ix_auto_reply_rules_channel_id", "auto_reply_rules", ["channel_id"])
    op.create_index("ix_auto_reply_rules_channel_kind", "auto_reply_rules", ["channel_id", "kind"])

    op.create_table(
        "message_templates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("kind", sa.String(length=40), nullable=False, server_default="text"),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("language", sa.String(length=10), nullable=False, server_default="ru"),
        sa.Column("whatsapp_template_name", sa.String(length=200), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_message_templates_tenant_id", "message_templates", ["tenant_id"])
    op.create_index("ix_message_templates_tenant_kind", "message_templates", ["tenant_id", "kind"])


def downgrade() -> None:
    for tbl in ("message_templates", "auto_reply_rules", "external_messages",
                "external_conversations", "external_contacts", "external_channels"):
        op.drop_table(tbl)
    for enum_name in ("auto_reply_kind", "external_message_status", "external_message_direction", "channel_kind"):
        sa.Enum(name=enum_name).drop(op.get_bind(), checkfirst=True)
