/**
 * Документ: загрузка файла с выбором юрлица и контрагента, или правка этих свойств у уже загруженного.
 * Поле «Юрлицо» показываем, только когда у компании несколько активных юрлиц.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api, extractApiError } from "@/api/client";
import { Modal, FormError } from "@/components/ui";
import { Button } from "@/components/lib/Button";
import { FormField } from "@/components/lib/FormField";
import { RecordPicker } from "@/components/RecordPicker";
import { useAuth } from "@/store/auth";
import { legalEntityOptions, useLegalEntities } from "@/hooks/useLegalEntities";

export type DocMeta = {
  id: number;
  name: string;
  legal_entity_id?: number | null;
  company_id?: number | null;
  company?: { id: number; name: string } | null;
};

export function DocumentMetaModal({
  file,
  doc,
  folderId,
  fixedCompany,
  onClose,
  onDone,
}: {
  /** Новый файл — режим загрузки. */
  file?: File | null;
  /** Существующий документ — режим правки свойств. */
  doc?: DocMeta | null;
  folderId?: number | null;
  /** Контрагент задан заранее (загрузка из карточки компании). */
  fixedCompany?: { id: number; name: string } | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const le = useLegalEntities();
  const [legalId, setLegalId] = useState<number | null>(doc?.legal_entity_id ?? null);
  const [companyId, setCompanyId] = useState<number | null>(fixedCompany?.id ?? doc?.company_id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const knownCompany = fixedCompany ?? doc?.company ?? null;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        if (folderId != null) fd.append("folder_id", String(folderId));
        if (le.multi && legalId) fd.append("legal_entity_id", String(legalId));
        if (companyId) fd.append("company_id", String(companyId));
        await api.post("/api/documents/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      } else if (doc) {
        await api.patch(`/api/documents/${doc.id}`, {
          ...(le.multi && legalId ? { legal_entity_id: legalId } : {}),
          company_id: companyId ?? 0,
        });
      }
      qc.invalidateQueries({ queryKey: ["docs"] });
      qc.invalidateQueries({ queryKey: ["company-docs"] });
      onDone?.();
      onClose();
    } catch (e) {
      setError(extractApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={file ? "Загрузка документа" : "Свойства документа"} size="md">
      <div className="space-y-3">
        <div className="truncate text-sm font-medium">{file ? file.name : doc?.name}</div>
        {le.multi && (
          <FormField label="Юрлицо">
            <select
              className="input"
              value={String(legalId ?? doc?.legal_entity_id ?? le.defaultEntity?.id ?? "")}
              onChange={(e) => setLegalId(e.target.value ? Number(e.target.value) : null)}
            >
              {legalEntityOptions(le.all, doc?.legal_entity_id).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.short_name}
                  {e.is_default ? " — по умолчанию" : ""}
                </option>
              ))}
            </select>
          </FormField>
        )}
        {fixedCompany ? (
          <FormField label="Контрагент">
            <div className="text-sm">{fixedCompany.name}</div>
          </FormField>
        ) : (
          can("contacts.view") && (
            <FormField label="Контрагент">
              <RecordPicker
                target="company"
                value={companyId}
                known={knownCompany ? [{ id: knownCompany.id, label: knownCompany.name }] : []}
                onChange={(v) => setCompanyId(typeof v === "number" ? v : null)}
                placeholder="Найдите компанию по названию"
              />
            </FormField>
          )
        )}
        <FormError msg={error} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" isLoading={busy} onClick={save}>
            {file ? "Загрузить" : "Сохранить"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
