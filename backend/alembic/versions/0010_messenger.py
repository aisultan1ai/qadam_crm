"""Messenger: channels, messages, reactions, attachments, polls

Revision ID: 0010_messenger
Revises: 0009_lead_forms
Create Date: 2026-08-24
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0010_messenger"
down_revision: Union[str, None] = "0009_lead_forms"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "channels",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=True),
        sa.Column("topic", sa.String(length=500), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "project_id", name="uq_channels_tenant_project"),
    )
    op.create_index("ix_channels_tenant_id", "channels", ["tenant_id"])
    op.create_index("ix_channels_kind", "channels", ["kind"])
    op.create_index("ix_channels_tenant_kind", "channels", ["tenant_id", "kind"])
    op.create_index("ix_channels_last_message_at", "channels", ["last_message_at"])

    op.create_table(
        "channel_members",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("channel_id", sa.Integer(), sa.ForeignKey("channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False, server_default="member"),
        sa.Column("muted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("last_read_message_id", sa.Integer(), nullable=True),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("channel_id", "user_id", name="uq_channel_members_channel_user"),
    )
    op.create_index("ix_channel_members_channel_id", "channel_members", ["channel_id"])
    op.create_index("ix_channel_members_user_id", "channel_members", ["user_id"])
    op.create_index("ix_channel_members_user", "channel_members", ["user_id"])

    op.create_table(
        "messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel_id", sa.Integer(), sa.ForeignKey("channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("reply_to_id", sa.Integer(), sa.ForeignKey("messages.id", ondelete="SET NULL"), nullable=True),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_messages_tenant_id", "messages", ["tenant_id"])
    op.create_index("ix_messages_channel_id", "messages", ["channel_id"])
    op.create_index("ix_messages_created_at", "messages", ["created_at"])
    op.create_index("ix_messages_channel_created", "messages", ["channel_id", "created_at"])
    op.create_index("ix_messages_channel_id_desc", "messages", ["channel_id", "id"])

    op.create_table(
        "message_attachments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("message_id", sa.Integer(), sa.ForeignKey("messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("attachment_id", sa.Integer(), sa.ForeignKey("attachments.id", ondelete="CASCADE"), nullable=False),
    )
    op.create_index("ix_message_attachments_message_id", "message_attachments", ["message_id"])
    op.create_index("ix_message_attachments_attachment_id", "message_attachments", ["attachment_id"])

    op.create_table(
        "message_reactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("message_id", sa.Integer(), sa.ForeignKey("messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("emoji", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("message_id", "user_id", "emoji", name="uq_message_reactions_msg_user_emoji"),
    )
    op.create_index("ix_message_reactions_message_id", "message_reactions", ["message_id"])
    op.create_index("ix_message_reactions_user_id", "message_reactions", ["user_id"])

    op.create_table(
        "polls",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("message_id", sa.Integer(), sa.ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("question", sa.String(length=300), nullable=False),
        sa.Column("allow_multiple", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("anonymous", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("closes_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_polls_message_id", "polls", ["message_id"])

    op.create_table(
        "poll_options",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("poll_id", sa.Integer(), sa.ForeignKey("polls.id", ondelete="CASCADE"), nullable=False),
        sa.Column("text", sa.String(length=300), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_poll_options_poll_id", "poll_options", ["poll_id"])

    op.create_table(
        "poll_votes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("poll_id", sa.Integer(), sa.ForeignKey("polls.id", ondelete="CASCADE"), nullable=False),
        sa.Column("option_id", sa.Integer(), sa.ForeignKey("poll_options.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("option_id", "user_id", name="uq_poll_votes_option_user"),
    )
    op.create_index("ix_poll_votes_poll_id", "poll_votes", ["poll_id"])
    op.create_index("ix_poll_votes_option_id", "poll_votes", ["option_id"])
    op.create_index("ix_poll_votes_user_id", "poll_votes", ["user_id"])


def downgrade() -> None:
    for idx, tbl in [
        ("ix_poll_votes_user_id", "poll_votes"),
        ("ix_poll_votes_option_id", "poll_votes"),
        ("ix_poll_votes_poll_id", "poll_votes"),
    ]:
        op.drop_index(idx, table_name=tbl)
    op.drop_table("poll_votes")

    op.drop_index("ix_poll_options_poll_id", table_name="poll_options")
    op.drop_table("poll_options")

    op.drop_index("ix_polls_message_id", table_name="polls")
    op.drop_table("polls")

    op.drop_index("ix_message_reactions_user_id", table_name="message_reactions")
    op.drop_index("ix_message_reactions_message_id", table_name="message_reactions")
    op.drop_table("message_reactions")

    op.drop_index("ix_message_attachments_attachment_id", table_name="message_attachments")
    op.drop_index("ix_message_attachments_message_id", table_name="message_attachments")
    op.drop_table("message_attachments")

    op.drop_index("ix_messages_channel_id_desc", table_name="messages")
    op.drop_index("ix_messages_channel_created", table_name="messages")
    op.drop_index("ix_messages_created_at", table_name="messages")
    op.drop_index("ix_messages_channel_id", table_name="messages")
    op.drop_index("ix_messages_tenant_id", table_name="messages")
    op.drop_table("messages")

    op.drop_index("ix_channel_members_user", table_name="channel_members")
    op.drop_index("ix_channel_members_user_id", table_name="channel_members")
    op.drop_index("ix_channel_members_channel_id", table_name="channel_members")
    op.drop_table("channel_members")

    op.drop_index("ix_channels_last_message_at", table_name="channels")
    op.drop_index("ix_channels_tenant_kind", table_name="channels")
    op.drop_index("ix_channels_kind", table_name="channels")
    op.drop_index("ix_channels_tenant_id", table_name="channels")
    op.drop_table("channels")
