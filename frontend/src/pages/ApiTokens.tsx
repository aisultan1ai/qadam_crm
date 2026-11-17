/** Настройки → API: токены компании для интеграций (1С, BI, скрипты) и ссылка на документацию. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import clsx from "clsx";

import { api, extractApiError } from "@/api/client";
import { EmptyState, FormError, Loader, Modal } from "@/components/ui";
import { Button } from "@/components/lib/Button";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import { useAuth } from "@/store/auth";

type Token = {
  id: number;
  name: string;
  token_prefix: string;
  permission_codes: string[];
  created_by_name?: string | null;
  last_used_at?: string | null;
  expires_at?: string | null;
  revoked_at?: string | null;
  created_at: string;
};
type Meta = {
  plan: string;
  rate_per_min: number;
  docs_url: string;
  permission_groups: { group: string; items: { code: string; label: string }[] }[];
};

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "—");

export default function ApiTokens() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);

  const meta = useQuery({ queryKey: ["api-tokens", "meta"], queryFn: async () => (await api.get<Meta>("/api/api-tokens/meta")).data });
  const list = useQuery({ queryKey: ["api-tokens"], queryFn: async () => (await api.get<Token[]>("/api/api-tokens")).data });
  const revoke = useMutation({
    mutationFn: (id: number) => api.delete(`/api/api-tokens/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-tokens"] });
      toast.success("Токен отозван");
    },
    onError: (e) => toast.error("Не удалось отозвать", extractApiError(e).message),
  });

  if (meta.isPending || list.isPending) return <Loader />;
  const labels = new Map(meta.data?.permission_groups.flatMap((g) => g.items.map((i) => [i.code, i.label] as const)));

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="text-[13px] text-zinc-600 dark:text-zinc-300">
          <div className="font-semibold text-zinc-900 dark:text-white">API для интеграций</div>
          Подключайте 1С, BI и свои скрипты. Лимит вашего тарифа:{" "}
          <b className="tabular-nums">{meta.data?.rate_per_min} запросов в минуту</b> на компанию.
        </div>
        <div className="flex gap-2">
          <a className="btn-secondary" href={meta.data?.docs_url ?? "/api/docs"} target="_blank" rel="noreferrer">
            <BookOpen size={14} /> Документация API
          </a>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={14} /> Новый токен
          </Button>
        </div>
      </div>

      {!list.data?.length ? (
        <EmptyState
          icon={<KeyRound size={20} />}
          title="Токенов пока нет"
          description="Токен — ключ для внешней системы. Он работает от вашего имени и только с выбранными правами."
        />
      ) : (
        <div className="table-container">
          <table className="w-full">
            <thead className="table-head">
              <tr>
                <th className="table-head-cell">Название</th>
                <th className="table-head-cell">Права</th>
                <th className="table-head-cell">Выпустил</th>
                <th className="table-head-cell">Последнее использование</th>
                <th className="table-head-cell">Действует до</th>
                <th className="table-head-cell" />
              </tr>
            </thead>
            <tbody>
              {list.data.map((t) => {
                const expired = !!t.expires_at && new Date(t.expires_at) < new Date();
                const off = !!t.revoked_at || expired;
                return (
                  <tr key={t.id} className={clsx("table-row", off && "opacity-60")}>
                    <td className="table-cell">
                      <div className="font-medium">{t.name}</div>
                      <div className="font-mono text-[11.5px] text-zinc-500">{t.token_prefix}…</div>
                    </td>
                    <td className="table-cell max-w-[280px] text-[12px] text-zinc-600 dark:text-zinc-400">
                      {t.permission_codes.map((c) => labels.get(c) ?? c).join(", ")}
                    </td>
                    <td className="table-cell text-[13px]">{t.created_by_name ?? "—"}</td>
                    <td className="table-cell text-[13px] tabular-nums">{fmt(t.last_used_at)}</td>
                    <td className="table-cell text-[13px]">
                      {t.revoked_at ? <span className="text-rose-600">Отозван</span> : expired ? <span className="text-rose-600">Истёк</span> : t.expires_at ? fmt(t.expires_at) : "Бессрочно"}
                    </td>
                    <td className="table-cell text-right">
                      {!off && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-rose-600"
                          onClick={() =>
                            confirm({
                              title: `Отозвать «${t.name}»?`,
                              message: "Система, которая использует этот токен, сразу потеряет доступ.",
                              danger: true,
                              confirmLabel: "Отозвать",
                              onConfirm: () => revoke.mutateAsync(t.id),
                            })
                          }
                        >
                          <Trash2 size={13} /> Отозвать
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {creating && meta.data && (
        <CreateTokenModal
          meta={meta.data}
          onClose={() => setCreating(false)}
          onIssued={(raw) => {
            setCreating(false);
            setIssued(raw);
            qc.invalidateQueries({ queryKey: ["api-tokens"] });
          }}
        />
      )}
      {issued && (
        <Modal open onClose={() => setIssued(null)} title="Токен выпущен" size="md">
          <div className="space-y-3">
            <p className="text-[13px] text-zinc-600 dark:text-zinc-300">
              Скопируйте токен сейчас — <b>больше он не будет показан</b>. Храните его как пароль.
            </p>
            <div className="flex items-center gap-2 rounded-lg bg-zinc-100 p-2 dark:bg-white/5">
              <code className="min-w-0 flex-1 break-all text-[12.5px]">{issued}</code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  navigator.clipboard?.writeText(issued).then(() => toast.success("Скопировано"), () => {});
                }}
              >
                <Copy size={13} /> Копировать
              </Button>
            </div>
            <p className="text-[12px] text-zinc-500">
              Пример: <code>curl -H "Authorization: Bearer {issued.slice(0, 10)}…" {window.location.origin}/api/tasks</code>
            </p>
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => setIssued(null)}>Готово</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CreateTokenModal({ meta, onClose, onIssued }: { meta: Meta; onClose: () => void; onIssued: (raw: string) => void }) {
  const { can, me } = useAuth();
  const isOwner = !!me?.current_tenant?.is_owner;
  const [name, setName] = useState("");
  const [days, setDays] = useState<string>("365");
  const [codes, setCodes] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () =>
      (await api.post<{ token: string }>("/api/api-tokens", {
        name: name.trim(),
        permission_codes: [...codes],
        expires_in_days: days ? Number(days) : null,
      })).data,
    onSuccess: (r) => onIssued(r.token),
    onError: (e) => setErr(extractApiError(e).message),
  });

  const toggle = (c: string) =>
    setCodes((s) => {
      const n = new Set(s);
      n.has(c) ? n.delete(c) : n.add(c);
      return n;
    });

  return (
    <Modal open onClose={onClose} title="Новый API-токен" size="lg">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setErr(null);
          create.mutate();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
          <label className="block">
            <span className="label">Название — для чего токен</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Обмен с 1С" maxLength={100} autoFocus />
          </label>
          <label className="block">
            <span className="label">Срок действия</span>
            <select className="input" value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="30">30 дней</option>
              <option value="90">90 дней</option>
              <option value="365">1 год</option>
              <option value="">Бессрочно</option>
            </select>
          </label>
        </div>
        <div>
          <span className="label">Что разрешено токену</span>
          <p className="mb-2 text-[12px] text-zinc-500">Только то, что нужно интеграции. Права, которых нет у вас, выдать нельзя.</p>
          <div className="max-h-[45vh] space-y-3 overflow-y-auto rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            {meta.permission_groups.map((g) => (
              <div key={g.group}>
                <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-zinc-500">{g.group}</div>
                <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                  {g.items.map((i) => {
                    const mine = isOwner || can(i.code);
                    return (
                      <label key={i.code} className={clsx("flex items-center gap-2 text-[13px]", !mine && "opacity-40")}>
                        <input type="checkbox" disabled={!mine} checked={codes.has(i.code)} onChange={() => toggle(i.code)} />
                        {i.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
        <FormError msg={err} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={!name.trim() || !codes.size} isLoading={create.isPending}>
            Выпустить токен
          </Button>
        </div>
      </form>
    </Modal>
  );
}
