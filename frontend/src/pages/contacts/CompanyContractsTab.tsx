/**
 * Вкладка «Договоры» карточки контрагента.
 *
 * Точка подключения реестра договоров: когда он появится, замените содержимое этого
 * компонента списком договоров контрагента (companyId). Карточка уже передаёт id компании
 * и показывает вкладку всем, у кого есть доступ к контактам.
 */
import { FileSignature } from "lucide-react";

import { EmptyState } from "@/components/ui";

export default function CompanyContractsTab({ companyId: _companyId }: { companyId: number }) {
  return (
    <EmptyState
      icon={<FileSignature size={24} />}
      title="Договоров пока нет"
      description="Договоры появятся здесь после подключения реестра договоров"
    />
  );
}
