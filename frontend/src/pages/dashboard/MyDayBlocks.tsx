/**
 * Блоки «Моего дня», которые зависят от прав: контракты без движения, истекающие договоры,
 * обязательства на неделю, непрочитанные письма. Данные — один запрос /api/my-day;
 * блок без права не приходит (allowed=false) и не показывается.
 */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, ArrowRight, FileSignature, Hourglass, Mail } from "lucide-react";
import clsx from "clsx";
import type { ReactNode } from "react";

import { api } from "@/api/client";
import { Skeleton } from "@/components/Skeleton";
import { fromNow } from "@/lib/date";

type Block<T> = { allowed: boolean; total: number; items: T[] };
type DealItem = { id: number; title: string; stage?: string | null; company?: string | null; last_change?: string | null; url: string };
type ContractItem = { id: number; number: string; company?: string | null; valid_until?: string | null; days_left?: number | null; url: string };
type ObligationItem = { id: number; title: string; due_date: string; overdue: boolean; contract_number: string; url: string };
type MailItem = { id: number; subject: string; unread: number; last_message_at?: string | null; url: string };

export type MyDay = {
  pipeline: "offtake" | "sales";
  stale_days: number;
  stale_deals: Block<DealItem>;
  expiring_contracts: Block<ContractItem>;
  expiring_days: number;
  obligations: Block<ObligationItem>;
  obligation_days: number;
  unread_mail: Block<MailItem> & { connected?: boolean };
};

export function useMyDay() {
  return useQuery({
    queryKey: ["my-day"],
    queryFn: async () => (await api.get<MyDay>("/api/my-day")).data,
    staleTime: 30_000,
    refetchOnMount: "always",
  });
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

function DayCard({
  icon,
  title,
  total,
  all,
  children,
}: {
  icon: ReactNode;
  title: string;
  total: number;
  all?: { to: string; label: string };
  children: ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title flex items-center gap-2">
          <span className="text-zinc-400">{icon}</span>
          {title}
          {total > 0 && <span className="text-[13px] font-medium tabular-nums text-zinc-400">{total}</span>}
        </h2>
        {all && total > 0 && (
          <Link to={all.to} className="inline-flex items-center gap-1 text-[13px] text-brand-700 hover:underline dark:text-brand-300">
            {all.label} <ArrowRight size={13} />
          </Link>
        )}
      </div>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800/70">{children}</div>
    </section>
  );
}

function Row({ to, title, meta, tone }: { to: string; title: string; meta?: ReactNode; tone?: "bad" | "warn" }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 px-5 py-2.5 text-[13px] transition-colors hover:bg-zinc-50 dark:hover:bg-white/[0.03]"
    >
      <span
        className={clsx(
          "h-2 w-2 shrink-0 rounded-full",
          tone === "bad" ? "bg-rose-500" : tone === "warn" ? "bg-amber-500" : "bg-zinc-300 dark:bg-zinc-600",
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate font-medium text-zinc-800 dark:text-zinc-100">{title}</span>
      {meta && <span className="shrink-0 text-xs tabular-nums text-zinc-500">{meta}</span>}
    </Link>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="px-5 py-4 text-[13px] text-zinc-500">{children}</div>;
}

export function MyDayBlocks({ data, isPending }: { data?: MyDay; isPending: boolean }) {
  if (isPending || !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  const offtake = data.pipeline === "offtake";
  const blocks: ReactNode[] = [];

  if (data.stale_deals.allowed) {
    blocks.push(
      <DayCard
        key="stale"
        icon={<Hourglass size={15} />}
        title={offtake ? `Контракты без движения ${data.stale_days}+ дней` : `Сделки без движения ${data.stale_days}+ дней`}
        total={data.stale_deals.total}
        all={{ to: "/deals", label: offtake ? "Все контракты" : "Все сделки" }}
      >
        {data.stale_deals.items.length === 0 ? (
          <Empty>{offtake ? "Все открытые контракты в движении." : "Все открытые сделки в движении."}</Empty>
        ) : (
          data.stale_deals.items.map((d) => (
            <Row
              key={d.id}
              to={d.url}
              title={d.title}
              tone="warn"
              meta={[d.stage, d.last_change ? `изменён ${fromNow(d.last_change)}` : null].filter(Boolean).join(" · ")}
            />
          ))
        )}
      </DayCard>,
    );
  }

  if (data.obligations.allowed) {
    blocks.push(
      <DayCard key="obl" icon={<AlarmClock size={15} />} title="Обязательства по договорам на неделю" total={data.obligations.total}>
        {data.obligations.items.length === 0 ? (
          <Empty>На ближайшие {data.obligation_days} дней обязательств со сроком нет.</Empty>
        ) : (
          data.obligations.items.map((o) => (
            <Row
              key={o.id}
              to={o.url}
              title={o.title}
              tone={o.overdue ? "bad" : "warn"}
              meta={`№ ${o.contract_number} · ${o.overdue ? "просрочено, " : ""}до ${shortDate(o.due_date)}`}
            />
          ))
        )}
      </DayCard>,
    );
  }

  if (data.expiring_contracts.allowed) {
    blocks.push(
      <DayCard
        key="exp"
        icon={<FileSignature size={15} />}
        title={`Договоры истекают в ближайшие ${data.expiring_days} дней`}
        total={data.expiring_contracts.total}
        all={{ to: `/contracts?expiring=${data.expiring_days}`, label: "Все" }}
      >
        {data.expiring_contracts.items.length === 0 ? (
          <Empty>В ближайшие {data.expiring_days} дней ни один договор не истекает.</Empty>
        ) : (
          data.expiring_contracts.items.map((c) => (
            <Row
              key={c.id}
              to={c.url}
              title={`№ ${c.number}${c.company ? ` · ${c.company}` : ""}`}
              tone={(c.days_left ?? 99) <= 7 ? "bad" : "warn"}
              meta={c.valid_until ? `до ${shortDate(c.valid_until)}` : undefined}
            />
          ))
        )}
      </DayCard>,
    );
  }

  if (data.unread_mail.allowed) {
    blocks.push(
      <DayCard
        key="mail"
        icon={<Mail size={15} />}
        title="Непрочитанные письма"
        total={data.unread_mail.total}
        all={{ to: "/mail", label: "Открыть почту" }}
      >
        {!data.unread_mail.connected ? (
          <Empty>
            Почтовый ящик не подключён.{" "}
            <Link to="/settings/mailbox" className="text-brand-700 hover:underline dark:text-brand-300">
              Подключить
            </Link>
          </Empty>
        ) : data.unread_mail.items.length === 0 ? (
          <Empty>Все письма прочитаны.</Empty>
        ) : (
          data.unread_mail.items.map((m) => (
            <Row key={m.id} to={m.url} title={m.subject} meta={m.last_message_at ? fromNow(m.last_message_at) : undefined} />
          ))
        )}
      </DayCard>,
    );
  }

  if (blocks.length === 0) return null;
  return <div className="space-y-6">{blocks}</div>;
}
