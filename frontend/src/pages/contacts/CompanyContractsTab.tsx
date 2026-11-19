/**
 * Вкладка «Договоры» карточки контрагента: договоры с этой компанией из реестра договоров
 * и создание нового договора с уже выбранным контрагентом.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileSignature, Plus } from "lucide-react";

import { api } from "@/api/client";
import { Button } from "@/components/lib/Button";
import { EmptyState, Loader } from "@/components/ui";
import { useLegalEntities } from "@/hooks/useLegalEntities";
import { useAuth } from "@/store/auth";
import {
  ContractFormModal, ContractStatusBadge, ExpiryText, TYPE_LABEL, fmtDate, fmtMoney, type Contract,
} from "./../contracts/shared";

export default function CompanyContractsTab({ companyId, companyName }: { companyId: number; companyName?: string }) {
  const { can, me } = useAuth();
  const isOwner = !!me?.current_tenant?.is_owner;
  const canView = can("contracts.view") || isOwner;
  const canCreate = can("contracts.create") || isOwner;
  const le = useLegalEntities();
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ["contracts", { company_id: companyId }],
    queryFn: async () => (await api.get<Contract[]>("/api/contracts", { params: { company_id: companyId } })).data,
    enabled: canView,
  });

  if (!canView) {
    return (
      <EmptyState
        icon={<FileSignature size={24} />}
        title="Нет доступа к договорам"
        description="В вашей роли нет права на просмотр реестра договоров. Его может выдать администратор компании."
      />
    );
  }

  const newButton = canCreate && (
    <Button variant="secondary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setCreating(true)}>
      Новый договор
    </Button>
  );

  return (
    <div className="space-y-3">
      {isPending ? (
        <Loader />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={<FileSignature size={24} />}
          title="Договоров пока нет"
          description="Договоры с этим контрагентом из реестра договоров появятся здесь."
          action={newButton || undefined}
        />
      ) : (
        <>
          {newButton && <div className="flex justify-end">{newButton}</div>}
          <div className="table-container table-scroll">
            <table className="w-full min-w-[640px]">
              <thead className="table-head">
                <tr>
                  <th className="table-head-cell">Договор</th>
                  <th className="table-head-cell">Тип</th>
                  {le.multi && <th className="table-head-cell">Юрлицо</th>}
                  <th className="table-head-cell text-right">Сумма</th>
                  <th className="table-head-cell">Срок действия</th>
                  <th className="table-head-cell">Статус</th>
                </tr>
              </thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.id} className="table-row">
                    <td className="table-cell">
                      <Link to={`/contracts/${c.id}`} className="font-medium hover:text-brand-700 dark:hover:text-brand-300">
                        № {c.number}
                      </Link>
                      {c.date_signed && <div className="text-xs text-zinc-500">от {fmtDate(c.date_signed)}</div>}
                    </td>
                    <td className="table-cell">{TYPE_LABEL[c.contract_type] ?? c.contract_type}</td>
                    {le.multi && <td className="table-cell text-zinc-600 dark:text-zinc-300">{c.legal_entity?.short_name ?? "—"}</td>}
                    <td className="table-cell whitespace-nowrap text-right tabular-nums">{fmtMoney(c.amount, c.currency)}</td>
                    <td className="table-cell">
                      <ExpiryText c={c} />
                    </td>
                    <td className="table-cell">
                      <ContractStatusBadge status={c.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {creating && (
        <ContractFormModal
          initial={{ company_id: companyId, company_name: companyName ?? null, responsible_user_id: me?.id ?? null }}
          onClose={() => setCreating(false)}
          onSaved={(c) => {
            setCreating(false);
            nav(`/contracts/${c.id}`);
          }}
        />
      )}
    </div>
  );
}
