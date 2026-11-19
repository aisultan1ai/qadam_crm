/**
 * Реестр договоров (/contracts): таблица с фильтрами и создание договора.
 * /contracts?new=1&deal_id=ID — сразу открывает форму, заполненную из сделки;
 * /contracts?new=1&company_id=ID — с выбранным контрагентом.
 */
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileSignature, Paperclip, Plus } from "lucide-react";

import { api, extractApiError } from "@/api/client";
import { Button } from "@/components/lib/Button";
import { DataTable, type Column } from "@/components/lib/DataTable";
import { FilterSelect, Page, PageHeader, SearchInput, Toolbar } from "@/components/page";
import { EmptyState } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { useLegalEntities } from "@/hooks/useLegalEntities";
import { useAuth } from "@/store/auth";
import {
  ContractFormModal, ContractStatusBadge, ExpiryText, STATUS_LABEL, TYPE_LABEL, fmtDate, fmtMoney, useContractPeople,
  type Contract, type ContractDraft, type ContractStatus, type ContractType,
} from "./contracts/shared";

type PrefillResp = {
  deal_id: number | null;
  deal_title: string | null;
  company_id: number | null;
  company_name: string | null;
  legal_entity_id: number | null;
  amount: string | number | null;
  currency: string | null;
  subject: string | null;
  contract_type: ContractType | null;
  project_id: number | null;
};

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function Contracts() {
  const { can, me } = useAuth();
  const isOwner = !!me?.current_tenant?.is_owner;
  const canView = can("contracts.view") || isOwner;
  const canCreate = can("contracts.create") || isOwner;
  const nav = useNavigate();
  const toast = useToast();
  const le = useLegalEntities();
  const people = useContractPeople(canView);
  const [sp, setSp] = useSearchParams();

  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [legalEntity, setLegalEntity] = useState("");
  const [responsible, setResponsible] = useState("");
  const [expiring, setExpiring] = useState("");
  const [creating, setCreating] = useState<ContractDraft | null>(null);

  // Открытие формы по ссылке: ?new=1[&deal_id=..|&company_id=..]
  useEffect(() => {
    if (sp.get("new") !== "1") return;
    const dealId = Number(sp.get("deal_id")) || null;
    const companyId = Number(sp.get("company_id")) || null;
    const next = new URLSearchParams(sp);
    ["new", "deal_id", "company_id"].forEach((k) => next.delete(k));
    setSp(next, { replace: true });
    if (!canCreate) return;
    if (!dealId && !companyId) {
      setCreating({ responsible_user_id: me?.id ?? null });
      return;
    }
    api
      .get<PrefillResp>("/api/contracts/prefill", { params: { deal_id: dealId ?? undefined, company_id: companyId ?? undefined } })
      .then(({ data }) =>
        setCreating({
          responsible_user_id: me?.id ?? null,
          deal_id: data.deal_id,
          deal_title: data.deal_title,
          company_id: data.company_id,
          company_name: data.company_name,
          legal_entity_id: data.legal_entity_id,
          amount: data.amount,
          currency: data.currency,
          subject: data.subject,
          contract_type: data.contract_type ?? undefined,
          project_id: data.project_id,
        }),
      )
      .catch((e) => {
        toast.error("Не удалось заполнить договор из сделки", extractApiError(e).message);
        setCreating({ responsible_user_id: me?.id ?? null });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, canCreate]);

  const params = {
    q: dq.trim() || undefined,
    type: type || undefined,
    status: status || undefined,
    legal_entity_id: legalEntity || undefined,
    responsible: responsible || undefined,
    expiring: expiring || undefined,
  };
  const { data, isPending, error } = useQuery({
    queryKey: ["contracts", params],
    queryFn: async () => (await api.get<Contract[]>("/api/contracts", { params })).data,
    enabled: canView,
  });

  if (!canView) {
    return (
      <EmptyState
        icon={<FileSignature size={32} />}
        title="Нет доступа к договорам"
        description="В вашей роли нет права на просмотр реестра договоров. Его может выдать администратор компании."
      />
    );
  }

  const columns: Column<Contract>[] = [
    {
      key: "number",
      header: "Номер",
      sortable: true,
      sortAccessor: (c) => c.number,
      render: (c) => (
        <span className="inline-flex items-center gap-1 font-medium">
          № {c.number}
          {c.files_count > 0 && (
            <span title={`Файлов: ${c.files_count}`} className="text-zinc-400">
              <Paperclip size={12} />
            </span>
          )}
        </span>
      ),
    },
    {
      key: "date",
      header: "Дата",
      width: 100,
      sortable: true,
      sortAccessor: (c) => c.date_signed ?? "",
      render: (c) => <span className="tabular-nums text-zinc-600 dark:text-zinc-300">{fmtDate(c.date_signed)}</span>,
    },
    ...(le.multi
      ? [
          {
            key: "le",
            header: "Юрлицо",
            hideOnMobile: true,
            render: (c: Contract) => <span className="text-zinc-600 dark:text-zinc-300">{c.legal_entity?.short_name ?? "—"}</span>,
          } as Column<Contract>,
        ]
      : []),
    {
      key: "company",
      header: "Контрагент",
      sortable: true,
      sortAccessor: (c) => c.company?.name ?? "",
      render: (c) => c.company?.name ?? <span className="text-zinc-400">—</span>,
    },
    {
      key: "type",
      header: "Тип",
      hideOnMobile: true,
      render: (c) => TYPE_LABEL[c.contract_type] ?? c.contract_type,
    },
    {
      key: "subject",
      header: "Предмет",
      hideOnMobile: true,
      render: (c) => (
        <span className="line-clamp-2 max-w-[260px] text-zinc-600 dark:text-zinc-300" title={c.subject ?? undefined}>
          {c.subject || "—"}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Сумма",
      align: "right",
      sortable: true,
      sortAccessor: (c) => Number(c.amount ?? 0),
      render: (c) => <span className="whitespace-nowrap tabular-nums">{fmtMoney(c.amount, c.currency)}</span>,
    },
    {
      key: "valid",
      header: "Срок действия",
      sortable: true,
      sortAccessor: (c) => c.valid_until ?? "9999",
      render: (c) => <ExpiryText c={c} />,
    },
    {
      key: "status",
      header: "Статус",
      sortable: true,
      sortAccessor: (c) => c.status,
      render: (c) => <ContractStatusBadge status={c.status} />,
    },
    {
      key: "resp",
      header: "Ответственный",
      hideOnMobile: true,
      render: (c) => c.responsible?.name ?? <span className="text-zinc-400">—</span>,
    },
  ];

  const filtered = !!(q || type || status || legalEntity || responsible || expiring);

  return (
    <Page>
      <PageHeader
        title="Договоры"
        subtitle="Реестр договоров с контрагентами: сроки, суммы, файлы и ответственные"
        actions={
          canCreate && (
            <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setCreating({ responsible_user_id: me?.id ?? null })}>
              Новый договор
            </Button>
          )
        }
      />
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Номер, предмет или контрагент" />
        <FilterSelect label="Тип" value={type} onChange={setType}>
          <option value="">Все типы</option>
          {(Object.keys(TYPE_LABEL) as ContractType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Статус" value={status} onChange={setStatus}>
          <option value="">Все статусы</option>
          {(Object.keys(STATUS_LABEL) as ContractStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </FilterSelect>
        {le.multi && (
          <FilterSelect label="Юрлицо" value={legalEntity} onChange={setLegalEntity}>
            <option value="">Все юрлица</option>
            {le.all.map((x) => (
              <option key={x.id} value={x.id}>
                {x.short_name}
              </option>
            ))}
          </FilterSelect>
        )}
        <FilterSelect label="Ответственный" value={responsible} onChange={setResponsible}>
          <option value="">Все ответственные</option>
          {me && <option value={me.id}>Я</option>}
          {(people.data ?? [])
            .filter((p) => p.id !== me?.id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </FilterSelect>
        <FilterSelect label="Срок действия" value={expiring} onChange={setExpiring}>
          <option value="">Любой срок</option>
          <option value="7">Истекают за 7 дней</option>
          <option value="30">Истекают за 30 дней</option>
          <option value="60">Истекают за 60 дней</option>
          <option value="90">Истекают за 90 дней</option>
        </FilterSelect>
      </Toolbar>

      {error ? (
        <EmptyState icon={<FileSignature size={28} />} title="Не удалось загрузить договоры" description={extractApiError(error).message} />
      ) : (
        <DataTable
          columns={columns}
          rows={data ?? []}
          rowKey={(c) => c.id}
          isLoading={isPending}
          onRowClick={(c) => nav(`/contracts/${c.id}`)}
          empty={
            <EmptyState
              icon={<FileSignature size={28} />}
              title={filtered ? "Ничего не найдено" : "Договоров пока нет"}
              description={
                filtered
                  ? "Измените условия поиска или сбросьте фильтры."
                  : "Добавьте первый договор: номер, контрагент, сумма и срок действия. Файлы можно приложить в карточке."
              }
              action={
                !filtered && canCreate ? (
                  <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setCreating({ responsible_user_id: me?.id ?? null })}>
                    Новый договор
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}

      {creating && (
        <ContractFormModal
          initial={creating}
          onClose={() => setCreating(null)}
          onSaved={(c) => {
            setCreating(null);
            toast.success("Договор создан");
            nav(`/contracts/${c.id}`);
          }}
        />
      )}
    </Page>
  );
}
