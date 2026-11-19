import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, extractApiError } from "@/api/client";
import { History } from "lucide-react";
import { Button } from "@/components/lib/Button";
import { FormError } from "@/components/ui";

type AuditItem = {
  id: number;
  action: string;
  entity: string | null;
  entity_id: number | null;
  detail: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  user: { id: number; name: string; email?: string | null } | null;
};
type AuditPage = { items: AuditItem[]; total: number; page: number; pages: number; per_page: number };

const ACTIONS: Record<string, string> = {
  login: "Вход",
  logout: "Выход",
  create: "Создал(а)",
  update: "Изменил(а)",
  delete: "Удалил(а)",
  bulk_update: "Массово изменил(а)",
  bulk_delete: "Массово удалил(а)",
  import: "Импорт",
  upload: "Загрузил(а) файл",
  invite: "Пригласил(а)",
  accept_invite: "Принял(а) приглашение",
  password_reset: "Сбросил(а) пароль",
  email_changed: "Сменил(а) почту",
  connect: "Подключил(а)",
  disconnect: "Отключил(а)",
  revoke: "Отозвал(а)",
  archive: "В архив",
  comment: "Комментарий",
};

const ENTITIES: Record<string, string> = {
  user: "сотрудник",
  task: "задача",
  project: "проект",
  lead: "лид",
  contact: "контакт",
  company: "компания-клиент",
  deal: "сделка",
  tenant: "компания",
  role: "роль",
  department: "отдел",
  api_token: "API-токен",
  wiki_article: "статья",
  attachment: "файл",
};

const DETAILS: Record<string, string> = {
  "2fa_required_on": "потребовал(а) двухфакторный вход",
  "2fa_required_off": "отменил(а) требование двухфакторного входа",
  handoff: "переход на адрес компании",
};

const PER_PAGE = 50;

/** Журнал действий компании с IP-адресами — для владельца и администратора (settings.system). */
export function AuditLogSection() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const { data, isPending, error } = useQuery({
    queryKey: ["audit-log", page, action],
    queryFn: async () =>
      (await api.get<AuditPage>("/api/audit-log", { params: { page, per_page: PER_PAGE, action: action || undefined } })).data,
  });

  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <History size={18} /> Журнал действий
        </h2>
        <select
          className="input max-w-[200px]"
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(1); }}
          aria-label="Тип действия"
        >
          <option value="">Все действия</option>
          {Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <p className="text-xs text-neutral-500">
        Кто, что и откуда делал в компании. IP-адреса видят только владелец и администратор.
        Записи до этого обновления сохранены без IP.
      </p>
      {isPending ? (
        <div className="h-40 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/60" />
      ) : error ? (
        <FormError msg={extractApiError(error).message} />
      ) : !data || data.items.length === 0 ? (
        <div className="py-6 text-center text-sm text-neutral-500">Записей пока нет</div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-neutral-50 text-left text-xs text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <th className="px-3 py-2 font-medium">Когда</th>
                  <th className="px-3 py-2 font-medium">Кто</th>
                  <th className="px-3 py-2 font-medium">Действие</th>
                  <th className="px-3 py-2 font-medium">IP-адрес</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a.id} className="border-t border-neutral-100 align-top dark:border-neutral-800">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-neutral-600 dark:text-neutral-400">
                      {new Date(a.created_at).toLocaleString("ru-RU")}
                    </td>
                    <td className="px-3 py-2">{a.user?.name ?? <span className="text-neutral-400">система</span>}</td>
                    <td className="px-3 py-2">
                      {ACTIONS[a.action] ?? a.action}
                      {a.entity && (
                        <span className="text-neutral-500">
                          {" · "}{ENTITIES[a.entity] ?? a.entity}{a.entity_id ? ` #${a.entity_id}` : ""}
                        </span>
                      )}
                      {a.detail && DETAILS[a.detail] && (
                        <span className="text-neutral-500"> — {DETAILS[a.detail]}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-neutral-600 dark:text-neutral-400" title={a.user_agent ?? undefined}>
                      {a.ip || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.pages > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Назад</Button>
              <span className="text-neutral-500">{page} из {data.pages}</span>
              <Button variant="ghost" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>Дальше</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
