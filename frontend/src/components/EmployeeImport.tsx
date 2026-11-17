/**
 * Импорт сотрудников из Excel/CSV: шаблон → загрузка → проверка каждой строки → применение.
 * Используется в «Приглашениях» и в мастере первого запуска.
 */
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Copy, Download, FileSpreadsheet, Upload } from "lucide-react";
import clsx from "clsx";

import { api, extractApiError } from "@/api/client";
import { Button } from "@/components/lib/Button";
import { useToast } from "@/components/Toast";

type Row = { row: number; full_name: string; email: string; position: string; department: string; role: string; manager: string };
type RowResult = Row & { action: "invite" | "update" | "error"; errors: string[]; notes: string[] };
type Preview = {
  rows: RowResult[];
  invite: number;
  update: number;
  errors: number;
  new_departments: string[];
  roles: string[];
  limit_error?: string | null;
};
type CommitResult = {
  invited: number;
  updated: number;
  skipped: number;
  departments_created: string[];
  invites: { email: string; full_name: string; invite_url: string }[];
  email_sent: boolean;
};

const ACTION: Record<RowResult["action"], { label: string; cls: string }> = {
  invite: { label: "Приглашение", cls: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" },
  update: { label: "Обновим", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  error: { label: "Ошибка", cls: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" },
};

export function EmployeeImport({ onDone }: { onDone?: (r: CommitResult) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [sendEmails, setSendEmails] = useState(true);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const download = async () => {
    try {
      const r = await api.get("/api/people-import/template", { responseType: "blob" });
      const url = URL.createObjectURL(r.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "qadam-сотрудники.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error("Не удалось скачать шаблон", extractApiError(e).message);
    }
  };

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return (await api.post<Preview>("/api/people-import/preview", fd)).data;
    },
    onSuccess: (p) => {
      setPreview(p);
      setResult(null);
      setOnlyProblems(p.errors > 0);
    },
    onError: (e) => toast.error("Файл не прочитан", extractApiError(e).message),
  });

  const commit = useMutation({
    mutationFn: async () =>
      (await api.post<CommitResult>("/api/people-import/commit", {
        rows: preview!.rows.map(({ row, full_name, email, position, department, role, manager }) => ({
          row, full_name, email, position, department, role, manager,
        })),
        send_emails: sendEmails,
      })).data,
    onSuccess: (r) => {
      setResult(r);
      setPreview(null);
      qc.invalidateQueries({ queryKey: ["invitations"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["departments"] });
      qc.invalidateQueries({ queryKey: ["hr", "org-chart"] });
      onDone?.(r);
    },
    onError: (e) => toast.error("Импорт не выполнен", extractApiError(e).message),
  });

  const copyAll = async () => {
    if (!result) return;
    const text = result.invites.map((i) => `${i.full_name || i.email}\t${i.email}\t${i.invite_url}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Ссылки скопированы", "Вставьте в Excel или мессенджер");
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  if (result) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-[13px] text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <div>
            Приглашено: <b>{result.invited}</b>, обновлено: <b>{result.updated}</b>
            {result.skipped > 0 && <>, пропущено с ошибками: <b>{result.skipped}</b></>}.
            {result.departments_created.length > 0 && <> Созданы отделы: {result.departments_created.join(", ")}.</>}
            <div className="mt-1">
              {result.invited === 0
                ? null
                : result.email_sent
                  ? "Письма с приглашениями отправлены."
                  : "Письма не отправлялись — разошлите ссылки сами (кнопка ниже)."}
              {" "}Руководители свяжутся автоматически, когда люди примут приглашения.
            </div>
          </div>
        </div>
        {result.invites.length > 0 && (
          <Button variant="secondary" size="sm" onClick={copyAll}>
            <Copy size={13} /> Скопировать ссылки-приглашения ({result.invites.length})
          </Button>
        )}
        <div>
          <Button variant="ghost" size="sm" onClick={() => setResult(null)}>Загрузить ещё файл</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={download}>
          <Download size={13} /> Шаблон Excel
        </Button>
        <Button variant="primary" size="sm" isLoading={upload.isPending} onClick={() => fileRef.current?.click()}>
          <Upload size={13} /> {preview ? "Загрузить другой файл" : "Загрузить файл"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload.mutate(f);
            e.target.value = "";
          }}
        />
      </div>
      {!preview && (
        <p className="text-[12.5px] text-zinc-500">
          Колонки: ФИО, Email, Должность, Отдел, Роль, Руководитель (email или ФИО). Новые люди получат приглашения,
          уже работающие — обновятся. Сначала покажем, что произойдёт с каждой строкой.
        </p>
      )}

      {preview && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <FileSpreadsheet size={15} className="text-zinc-400" />
            <span>Пригласим: <b>{preview.invite}</b></span>
            <span>· Обновим: <b>{preview.update}</b></span>
            <span className={clsx(preview.errors > 0 && "text-rose-600")}>· С ошибками: <b>{preview.errors}</b></span>
            {preview.new_departments.length > 0 && <span>· Новые отделы: {preview.new_departments.join(", ")}</span>}
            <label className="ml-auto flex items-center gap-1.5 text-[12.5px] text-zinc-500">
              <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
              Только строки с ошибками
            </label>
          </div>
          {preview.limit_error && (
            <div className="flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-[13px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              <AlertCircle size={15} className="mt-0.5 shrink-0" /> {preview.limit_error}
            </div>
          )}
          <div className="max-h-[50vh] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-[12.5px]">
              <thead className="table-head sticky top-0">
                <tr>
                  <th className="table-head-cell w-12">Стр.</th>
                  <th className="table-head-cell">Сотрудник</th>
                  <th className="table-head-cell">Должность · отдел · роль</th>
                  <th className="table-head-cell">Руководитель</th>
                  <th className="table-head-cell">Что сделаем</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows
                  .filter((r) => !onlyProblems || r.action === "error")
                  .map((r) => (
                    <tr key={r.row} className="table-row align-top">
                      <td className="table-cell tabular-nums text-zinc-400">{r.row}</td>
                      <td className="table-cell">
                        <div className="font-medium">{r.full_name || "—"}</div>
                        <div className="text-zinc-500">{r.email || "—"}</div>
                      </td>
                      <td className="table-cell text-zinc-600 dark:text-zinc-400">
                        {[r.position, r.department, r.role || "Сотрудник"].filter(Boolean).join(" · ")}
                      </td>
                      <td className="table-cell text-zinc-600 dark:text-zinc-400">{r.manager || "—"}</td>
                      <td className="table-cell">
                        <span className={clsx("rounded px-1.5 py-0.5 text-[11px] font-medium", ACTION[r.action].cls)}>
                          {ACTION[r.action].label}
                        </span>
                        {[...r.errors, ...r.notes].map((m, i) => (
                          <div key={i} className={clsx("mt-1", i < r.errors.length ? "text-rose-600 dark:text-rose-400" : "text-zinc-500")}>
                            {m}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-[13px]">
              <input type="checkbox" checked={sendEmails} onChange={(e) => setSendEmails(e.target.checked)} />
              Отправить приглашения на почту
            </label>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>Отмена</Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!!preview.limit_error || preview.invite + preview.update === 0}
                isLoading={commit.isPending}
                onClick={() => commit.mutate()}
              >
                Применить ({preview.invite + preview.update})
                {preview.errors > 0 && `, пропустить ${preview.errors}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
