/**
 * Правила обработки входящих писем (для своего ящика) и шаблоны писем компании.
 * Правила применяются к каждому новому входящему письму при синхронизации — см. backend services/mail/rules.py.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, X } from "lucide-react";

import { api, extractApiError } from "@/api/client";
import { Modal } from "@/components/ui";
import { Button } from "@/components/lib/Button";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import { useAuth } from "@/store/auth";

export type MailTemplate = { id: number; name: string; subject: string; body: string; created_by: number | null };

type Cond = { field: string; op: string; value: string };
type Action = { type: string; params?: { project_id?: number; assignee_id?: number } };
type Rule = {
  id: number;
  mailbox_id: number;
  name: string;
  is_active: boolean;
  order_index: number;
  stop_on_match: boolean;
  conditions: Cond[];
  actions: Action[];
};

const FIELDS: Record<string, string> = { from: "Отправитель", to: "Получатели", subject: "Тема", body: "Текст письма" };
const OPS: Record<string, string> = { contains: "содержит", not_contains: "не содержит", equals: "равно", starts_with: "начинается с" };
const ACTIONS: Record<string, string> = {
  mark_read: "Пометить прочитанным",
  archive: "Убрать в архив",
  create_task: "Создать задачу из письма",
  notify: "Уведомить меня",
};

export function useMailTemplates(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["mail-templates"],
    queryFn: async () => (await api.get<MailTemplate[]>("/api/mail/templates")).data,
    staleTime: 30_000,
  });
}

/** Выбор шаблона: подставляет тему и текст. */
export function TemplatePicker({ onPick }: { onPick: (t: MailTemplate) => void }) {
  const { data } = useMailTemplates();
  if (!data?.length) return null;
  return (
    <select
      className="input !h-8 max-w-[220px] !py-0 text-[12.5px]"
      value=""
      onChange={(e) => {
        const t = data.find((x) => x.id === Number(e.target.value));
        if (t) onPick(t);
      }}
      aria-label="Вставить шаблон"
    >
      <option value="">Вставить шаблон…</option>
      {data.map((t) => (
        <option key={t.id} value={t.id}>{t.name}</option>
      ))}
    </select>
  );
}

export function MailRulesModal({ mailboxId, onClose }: { mailboxId: number; onClose: () => void }) {
  const [tab, setTab] = useState<"rules" | "templates">("rules");
  return (
    <Modal open onClose={onClose} title="Правила и шаблоны почты" size="lg">
      <div className="mb-4 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {([["rules", "Правила входящих"], ["templates", "Шаблоны писем"]] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={
              "-mb-px border-b-2 px-3 py-2 text-[13px] font-medium " +
              (tab === k ? "border-brand-600 text-brand-700 dark:text-brand-300" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200")
            }
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "rules" ? <RulesTab mailboxId={mailboxId} /> : <TemplatesTab />}
    </Modal>
  );
}

// ---------------------------------------------------------------- Правила

function RulesTab({ mailboxId }: { mailboxId: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  const { data: rules, isPending } = useQuery({
    queryKey: ["mail-rules", mailboxId],
    queryFn: async () => (await api.get<Rule[]>("/api/mail/rules", { params: { mailbox_id: mailboxId } })).data,
  });
  const toggle = useMutation({
    mutationFn: (r: Rule) => api.patch(`/api/mail/rules/${r.id}`, { is_active: !r.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mail-rules"] }),
    onError: (e) => toast.error("Не удалось сохранить", extractApiError(e).message),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/mail/rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mail-rules"] }),
  });

  if (editing) {
    return <RuleForm mailboxId={mailboxId} rule={editing === "new" ? null : editing} nextOrder={rules?.length ?? 0} onDone={() => setEditing(null)} />;
  }
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-zinc-500">
        Правила срабатывают на новые входящие письма вашего ящика по порядку сверху вниз. Уже полученные письма не меняются.
      </p>
      {isPending ? null : !rules?.length ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-[13px] text-zinc-500 dark:border-zinc-700">
          Правил пока нет. Например: письма с темой «счёт» — создать задачу бухгалтеру.
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {rules.map((r) => (
            <li key={r.id} className="flex items-start gap-3 px-3 py-2.5">
              <input type="checkbox" className="mt-1" checked={r.is_active} onChange={() => toggle.mutate(r)} aria-label="Правило включено" />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium text-zinc-900 dark:text-zinc-100">{r.name}</div>
                <div className="text-[12px] text-zinc-500">
                  Если {r.conditions.map((c) => `${(FIELDS[c.field] ?? c.field).toLowerCase()} ${OPS[c.op] ?? c.op} «${c.value}»`).join(" и ")}
                  {" → "}
                  {r.actions.map((a) => (ACTIONS[a.type] ?? a.type).toLowerCase()).join(", ")}
                  {r.stop_on_match && " · дальше не проверять"}
                </div>
              </div>
              <button type="button" className="p-1 text-zinc-400 hover:text-zinc-700" onClick={() => setEditing(r)} aria-label="Изменить">
                <Pencil size={14} />
              </button>
              <button
                type="button"
                className="p-1 text-zinc-400 hover:text-rose-600"
                aria-label="Удалить"
                onClick={() => confirm({ title: "Удалить правило?", message: `«${r.name}»`, danger: true, confirmLabel: "Удалить", onConfirm: () => del.mutateAsync(r.id) })}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" onClick={() => setEditing("new")}>
        <Plus size={14} /> Новое правило
      </Button>
    </div>
  );
}

function RuleForm({ mailboxId, rule, nextOrder, onDone }: { mailboxId: number; rule: Rule | null; nextOrder: number; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(rule?.name ?? "");
  const [conds, setConds] = useState<Cond[]>(rule?.conditions?.length ? rule.conditions : [{ field: "subject", op: "contains", value: "" }]);
  const [actions, setActions] = useState<Action[]>(rule?.actions?.length ? rule.actions : [{ type: "create_task", params: {} }]);
  const [stop, setStop] = useState(rule?.stop_on_match ?? false);
  const needsTask = actions.some((a) => a.type === "create_task");

  const { data: projects } = useQuery({
    enabled: needsTask,
    queryKey: ["projects", "brief"],
    queryFn: async () => (await api.get<{ items: { id: number; name: string }[] }>("/api/projects", { params: { per_page: 200 } })).data.items,
  });
  const { data: users } = useQuery({
    enabled: needsTask,
    queryKey: ["users", "brief-200"],
    queryFn: async () => (await api.get<{ items: { id: number; name: string }[] }>("/api/users", { params: { per_page: 200 } })).data.items,
  });

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), conditions: conds, actions, stop_on_match: stop };
      return rule ? api.patch(`/api/mail/rules/${rule.id}`, body) : api.post("/api/mail/rules", { ...body, mailbox_id: mailboxId, order_index: nextOrder });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mail-rules"] });
      toast.success("Правило сохранено");
      onDone();
    },
    onError: (e) => toast.error("Не удалось сохранить", extractApiError(e).message),
  });

  const setCond = (i: number, patch: Partial<Cond>) => setConds(conds.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const setAction = (i: number, patch: Partial<Action>) => setActions(actions.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const unusedActions = Object.keys(ACTIONS).filter((k) => !actions.some((a) => a.type === k));
  const valid = name.trim() && conds.every((c) => c.value.trim()) && conds.length > 0 && actions.length > 0;

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-500">Название правила</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Что делает правило" />
      </label>

      <div>
        <div className="mb-1 text-xs font-medium text-zinc-500">Если выполняются все условия</div>
        <div className="space-y-2">
          {conds.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select className="input w-auto" value={c.field} onChange={(e) => setCond(i, { field: e.target.value })}>
                {Object.entries(FIELDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select className="input w-auto" value={c.op} onChange={(e) => setCond(i, { op: e.target.value })}>
                {Object.entries(OPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input className="input min-w-[160px] flex-1" value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} placeholder="Слово, фраза или адрес" />
              {conds.length > 1 && (
                <button type="button" className="p-1 text-zinc-400 hover:text-rose-600" onClick={() => setConds(conds.filter((_, j) => j !== i))} aria-label="Убрать условие">
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button type="button" className="link mt-2 text-[12.5px]" onClick={() => setConds([...conds, { field: "from", op: "contains", value: "" }])}>
          + условие
        </button>
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-zinc-500">То</div>
        <div className="space-y-2">
          {actions.map((a, i) => (
            <div key={i} className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <select className="input w-auto" value={a.type} onChange={(e) => setAction(i, { type: e.target.value, params: {} })}>
                  {[a.type, ...unusedActions].map((k) => <option key={k} value={k}>{ACTIONS[k]}</option>)}
                </select>
                <span className="flex-1" />
                {actions.length > 1 && (
                  <button type="button" className="p-1 text-zinc-400 hover:text-rose-600" onClick={() => setActions(actions.filter((_, j) => j !== i))} aria-label="Убрать действие">
                    <X size={14} />
                  </button>
                )}
              </div>
              {a.type === "create_task" && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-[11.5px] text-zinc-500">Проект</span>
                    <select className="input" value={a.params?.project_id ?? ""} onChange={(e) => setAction(i, { params: { ...a.params, project_id: e.target.value ? Number(e.target.value) : undefined } })}>
                      <option value="">Без проекта</option>
                      {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11.5px] text-zinc-500">Исполнитель</span>
                    <select className="input" value={a.params?.assignee_id ?? ""} onChange={(e) => setAction(i, { params: { ...a.params, assignee_id: e.target.value ? Number(e.target.value) : undefined } })}>
                      <option value="">Я (владелец ящика)</option>
                      {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
        {unusedActions.length > 0 && (
          <button type="button" className="link mt-2 text-[12.5px]" onClick={() => setActions([...actions, { type: unusedActions[0], params: {} }])}>
            + действие
          </button>
        )}
      </div>

      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={stop} onChange={(e) => setStop(e.target.checked)} />
        Если правило сработало — следующие правила не проверять
      </label>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>Отмена</Button>
        <Button variant="primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>Сохранить</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Шаблоны

function TemplatesTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const me = useAuth((s) => s.me);
  const isAdmin = useAuth((s) => s.can("settings.dictionaries") || !!s.me?.current_tenant?.is_owner);
  const [editing, setEditing] = useState<MailTemplate | "new" | null>(null);
  const { data, isPending } = useMailTemplates();
  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/mail/templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mail-templates"] }),
    onError: (e) => toast.error("Не удалось удалить", extractApiError(e).message),
  });

  if (editing) return <TemplateForm tpl={editing === "new" ? null : editing} onDone={() => setEditing(null)} />;
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-zinc-500">
        Шаблоны общие для компании: их можно вставить в новое письмо или ответ. Меняет шаблон его автор или администратор.
      </p>
      {isPending ? null : !data?.length ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-[13px] text-zinc-500 dark:border-zinc-700">
          Шаблонов пока нет.
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {data.map((t) => {
            const canEdit = isAdmin || t.created_by === me?.id;
            return (
              <li key={t.id} className="flex items-start gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium text-zinc-900 dark:text-zinc-100">{t.name}</div>
                  <div className="truncate text-[12px] text-zinc-500">{t.subject || "(без темы)"} — {t.body.slice(0, 120)}</div>
                </div>
                {canEdit && (
                  <>
                    <button type="button" className="p-1 text-zinc-400 hover:text-zinc-700" onClick={() => setEditing(t)} aria-label="Изменить">
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="p-1 text-zinc-400 hover:text-rose-600"
                      aria-label="Удалить"
                      onClick={() => confirm({ title: "Удалить шаблон?", message: `«${t.name}»`, danger: true, confirmLabel: "Удалить", onConfirm: () => del.mutateAsync(t.id) })}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Button variant="secondary" onClick={() => setEditing("new")}>
        <Plus size={14} /> Новый шаблон
      </Button>
    </div>
  );
}

function TemplateForm({ tpl, onDone }: { tpl: MailTemplate | null; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(tpl?.name ?? "");
  const [subject, setSubject] = useState(tpl?.subject ?? "");
  const [body, setBody] = useState(tpl?.body ?? "");
  const save = useMutation({
    mutationFn: () => {
      const data = { name: name.trim(), subject, body };
      return tpl ? api.patch(`/api/mail/templates/${tpl.id}`, data) : api.post("/api/mail/templates", data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mail-templates"] });
      toast.success("Шаблон сохранён");
      onDone();
    },
    onError: (e) => toast.error("Не удалось сохранить", extractApiError(e).message),
  });
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-500">Название</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Как шаблон будет называться в списке" />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-500">Тема письма</span>
        <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-500">Текст</span>
        <textarea className="input min-h-[180px]" value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>Отмена</Button>
        <Button variant="primary" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>Сохранить</Button>
      </div>
    </div>
  );
}
