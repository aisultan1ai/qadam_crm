/**
 * Мастер первого запуска для владельца новой компании:
 * отрасль → отделы → сотрудники → контрагенты → готовые реестры. Любой шаг можно пропустить.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, CheckCircle2, Download, Factory, HardHat, Layers, Plus, ShoppingCart, Briefcase, Code2, Shapes, Upload, Users, Boxes, X } from "lucide-react";
import clsx from "clsx";

import { api, extractApiError } from "@/api/client";
import { Button } from "@/components/lib/Button";
import { EmployeeImport } from "@/components/EmployeeImport";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/store/auth";

type Industry = {
  key: string;
  label: string;
  description: string;
  departments: string[];
  schemas: { code: string; label: string }[];
};
type State = {
  pending: boolean;
  industry?: string | null;
  industries: Industry[];
  departments: string[];
  members: number;
  invitations: number;
  companies: number;
  installed_schemas: string[];
};

const ICON: Record<string, typeof Factory> = {
  mining: Factory, epc: HardHat, trade: ShoppingCart, services: Briefcase, it: Code2, other: Shapes,
};
const STEPS = [
  { key: "industry", label: "Отрасль", icon: Factory },
  { key: "departments", label: "Отделы", icon: Layers },
  { key: "people", label: "Сотрудники", icon: Users },
  { key: "companies", label: "Контрагенты", icon: Building2 },
  { key: "templates", label: "Реестры", icon: Boxes },
] as const;

export default function OnboardingWizard() {
  const { me, fetchMe } = useAuth();
  const pending = !!me?.current_tenant?.onboarding_pending;
  const [dismissed, setDismissed] = useState(false);
  if (!pending || dismissed) return null;
  const close = () => {
    // После мастера не показываем ещё и приветствие «создайте проект».
    try {
      if (me?.current_tenant) window.localStorage.setItem(`qadam:welcome-dismissed:${me.current_tenant.id}`, String(Date.now()));
    } catch {
      // localStorage недоступен — не страшно
    }
    setDismissed(true);
    fetchMe();
  };
  return <Wizard onClose={close} />;
}

function Wizard({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [industry, setIndustry] = useState<string | null>(null);

  const st = useQuery({
    queryKey: ["onboarding"],
    queryFn: async () => (await api.get<State>("/api/onboarding")).data,
  });
  useEffect(() => {
    if (st.data?.industry && !industry) setIndustry(st.data.industry);
  }, [st.data, industry]);

  const complete = useMutation({
    mutationFn: () => api.post("/api/onboarding/complete"),
    onSettled: () => onClose(),
  });
  const saveIndustry = useMutation({
    mutationFn: (key: string) => api.post("/api/onboarding/industry", { industry: key }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["onboarding"] });
      setStep(1);
    },
    onError: (e) => toast.error("Не сохранилось", extractApiError(e).message),
  });

  const ind = st.data?.industries.find((i) => i.key === industry) ?? null;
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Настройка компании">
      <div className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-[#1B1E23]">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <div>
            <div className="text-[15px] font-semibold text-zinc-900 dark:text-white">Настроим компанию за 5 шагов</div>
            <div className="text-[12px] text-zinc-500">Любой шаг можно пропустить и вернуться к нему позже в настройках</div>
          </div>
          <button
            type="button"
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/5"
            onClick={() => complete.mutate()}
            aria-label="Закрыть мастер"
            title="Пропустить настройку"
          >
            <X size={18} />
          </button>
        </div>

        <ol className="flex gap-1 overflow-x-auto border-b border-zinc-200 px-5 py-2 dark:border-zinc-800">
          {STEPS.map((s, i) => (
            <li key={s.key}>
              <button
                type="button"
                disabled={i > 0 && !industry}
                onClick={() => setStep(i)}
                className={clsx(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[12.5px] font-medium disabled:opacity-40",
                  i === step
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                    : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5",
                )}
              >
                <span className={clsx("flex h-5 w-5 items-center justify-center rounded-full text-[11px]",
                  i < step ? "bg-emerald-500 text-white" : i === step ? "bg-brand-600 text-white" : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300")}>
                  {i < step ? <Check size={11} /> : i + 1}
                </span>
                {s.label}
              </button>
            </li>
          ))}
        </ol>

        <div className="min-h-[320px] flex-1 overflow-y-auto px-5 py-5">
          {!st.data ? (
            <div className="h-40 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800/60" />
          ) : step === 0 ? (
            <div>
              <h3 className="mb-1 text-[16px] font-semibold">Чем занимается компания?</h3>
              <p className="mb-4 text-[13px] text-zinc-500">Предложим структуру отделов и готовые реестры под вашу отрасль.</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {st.data.industries.map((i) => {
                  const Icon = ICON[i.key] ?? Shapes;
                  return (
                    <button
                      key={i.key}
                      type="button"
                      onClick={() => {
                        setIndustry(i.key);
                        saveIndustry.mutate(i.key);
                      }}
                      className={clsx(
                        "rounded-xl border p-4 text-left transition-colors",
                        industry === i.key
                          ? "border-brand-500 bg-brand-50/60 dark:bg-brand-500/10"
                          : "border-zinc-200 hover:border-brand-300 dark:border-zinc-700",
                      )}
                    >
                      <Icon size={20} className="mb-2 text-brand-600 dark:text-brand-300" />
                      <div className="text-[14px] font-semibold text-zinc-900 dark:text-white">{i.label}</div>
                      <div className="mt-0.5 text-[12.5px] text-zinc-500">{i.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : step === 1 ? (
            <DepartmentsStep key={industry ?? ""} suggested={ind?.departments ?? []} existing={st.data.departments} onDone={next} />
          ) : step === 2 ? (
            <div>
              <h3 className="mb-1 text-[16px] font-semibold">Пригласите команду</h3>
              <p className="mb-4 text-[13px] text-zinc-500">
                Заполните шаблон Excel: ФИО, email, должность, отдел, роль и руководитель — и все получат приглашения.
                Пригласить по одному можно позже в «Команда → Приглашения».
              </p>
              <EmployeeImport />
            </div>
          ) : step === 3 ? (
            <CompaniesStep count={st.data.companies} />
          ) : (
            <TemplatesStep
              key={industry ?? ""}
              available={ind?.schemas ?? []}
              installed={st.data.installed_schemas}
              onInstalled={() => qc.invalidateQueries({ queryKey: ["onboarding"] })}
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <Button variant="ghost" size="sm" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
            Назад
          </Button>
          {step < STEPS.length - 1 ? (
            <Button variant="primary" size="sm" disabled={!industry} onClick={next}>
              {step === 0 ? "Дальше" : "Дальше (можно пропустить)"}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              isLoading={complete.isPending}
              onClick={() =>
                complete.mutate(undefined, {
                  onSuccess: () => {
                    toast.success("Компания настроена", "Всё можно поменять в любой момент");
                    navigate("/");
                  },
                })
              }
            >
              <CheckCircle2 size={14} /> Готово — начать работу
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function DepartmentsStep({ suggested, existing, onDone }: { suggested: string[]; existing: string[]; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const have = new Set(existing.map((d) => d.toLowerCase()));
  const [list, setList] = useState<{ name: string; on: boolean }[]>(() =>
    suggested.filter((d) => !have.has(d.toLowerCase())).map((name) => ({ name, on: true })),
  );
  const [extra, setExtra] = useState("");

  const save = useMutation({
    mutationFn: async () =>
      (await api.post<{ created: string[] }>("/api/onboarding/departments", { names: list.filter((d) => d.on).map((d) => d.name) })).data,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["onboarding"] });
      qc.invalidateQueries({ queryKey: ["departments"] });
      toast.success(r.created.length ? `Создано отделов: ${r.created.length}` : "Отделы уже есть");
      onDone();
    },
    onError: (e) => toast.error("Не удалось создать отделы", extractApiError(e).message),
  });

  const add = () => {
    const n = extra.trim();
    if (!n || have.has(n.toLowerCase()) || list.some((d) => d.name.toLowerCase() === n.toLowerCase())) return setExtra("");
    setList([...list, { name: n, on: true }]);
    setExtra("");
  };

  return (
    <div>
      <h3 className="mb-1 text-[16px] font-semibold">Структура отделов</h3>
      <p className="mb-4 text-[13px] text-zinc-500">
        Отделы нужны для оргструктуры и прав: сотрудник с правом «задачи своего отдела» видит задачи коллег по отделу.
      </p>
      {existing.length > 0 && (
        <p className="mb-3 text-[12.5px] text-zinc-500">Уже есть: {existing.join(", ")}</p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {list.map((d, i) => (
          <label key={d.name} className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-[13.5px] dark:border-zinc-700">
            <input type="checkbox" checked={d.on} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
            {d.name}
          </label>
        ))}
      </div>
      <div className="mt-3 flex max-w-md gap-2">
        <input
          className="input"
          placeholder="Добавить свой отдел"
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          maxLength={150}
        />
        <Button variant="secondary" onClick={add}><Plus size={14} /></Button>
      </div>
      <div className="mt-4">
        <Button variant="primary" size="sm" isLoading={save.isPending} disabled={!list.some((d) => d.on)} onClick={() => save.mutate()}>
          Создать отделы ({list.filter((d) => d.on).length})
        </Button>
      </div>
    </div>
  );
}

function CompaniesStep({ count }: { count: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [res, setRes] = useState<{ created: number; updated: number; skipped: { row: number; reason: string }[]; skipped_total: number } | null>(null);

  const upload = useMutation({
    mutationFn: async (f: File) => {
      const fd = new FormData();
      fd.append("file", f);
      return (await api.post("/api/companies/import", fd)).data;
    },
    onSuccess: (r) => {
      setRes(r);
      qc.invalidateQueries({ queryKey: ["onboarding"] });
      qc.invalidateQueries({ queryKey: ["companies"] });
    },
    onError: (e) => toast.error("Файл не загружен", extractApiError(e).message),
  });
  const download = async () => {
    try {
      const r = await api.get("/api/companies/import/template", { responseType: "blob" });
      const url = URL.createObjectURL(r.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "qadam-контрагенты.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error("Не удалось скачать шаблон", extractApiError(e).message);
    }
  };

  return (
    <div>
      <h3 className="mb-1 text-[16px] font-semibold">Контрагенты</h3>
      <p className="mb-4 text-[13px] text-zinc-500">
        Загрузите список клиентов, поставщиков и подрядчиков из Excel — подойдёт и выгрузка из 1С (колонки «Наименование»,
        «БИН/ИИН», телефон, email, адрес). БИН проверяем по контрольной сумме, дубли по БИН не создаём.
        {count > 0 && <> Сейчас в базе: <b>{count}</b>.</>}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={download}><Download size={13} /> Шаблон Excel</Button>
        <Button variant="primary" size="sm" isLoading={upload.isPending} onClick={() => fileRef.current?.click()}>
          <Upload size={13} /> Загрузить файл
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
      {res && (
        <div className="mt-4 space-y-2 text-[13px]">
          <div className="rounded-lg bg-emerald-50 p-3 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
            Добавлено: <b>{res.created}</b>, дополнено существующих: <b>{res.updated}</b>
            {res.skipped_total > 0 && <>, пропущено: <b>{res.skipped_total}</b></>}
          </div>
          {res.skipped.length > 0 && (
            <ul className="max-h-40 overflow-y-auto rounded-lg border border-zinc-200 p-2 text-[12.5px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
              {res.skipped.map((s) => <li key={s.row}>Строка {s.row}: {s.reason}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function TemplatesStep({
  available,
  installed,
  onInstalled,
}: {
  available: { code: string; label: string }[];
  installed: string[];
  onInstalled: () => void;
}) {
  const toast = useToast();
  const [codes, setCodes] = useState<Set<string>>(() => new Set(available.map((s) => s.code).filter((c) => !installed.includes(c))));
  const install = useMutation({
    mutationFn: async () => (await api.post<{ installed: string[] }>("/api/onboarding/templates", { codes: [...codes] })).data,
    onSuccess: (r) => {
      toast.success(r.installed.length ? `Добавлены реестры: ${r.installed.join(", ")}` : "Реестры уже установлены");
      setCodes(new Set());
      onInstalled();
    },
    onError: (e) => toast.error("Не удалось установить", extractApiError(e).message),
  });
  return (
    <div>
      <h3 className="mb-1 text-[16px] font-semibold">Готовые реестры</h3>
      <p className="mb-4 text-[13px] text-zinc-500">
        Реестры появятся в «Объектах»: со связями с контрагентами, сделками, проектами и сотрудниками. Поля можно менять под себя.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {available.map((s) => {
          const done = installed.includes(s.code);
          return (
            <label key={s.code} className={clsx("flex items-center gap-2 rounded-lg border px-3 py-2 text-[13.5px]", done ? "border-emerald-300 dark:border-emerald-500/40" : "border-zinc-200 dark:border-zinc-700")}>
              <input
                type="checkbox"
                disabled={done}
                checked={done || codes.has(s.code)}
                onChange={(e) => {
                  const n = new Set(codes);
                  e.target.checked ? n.add(s.code) : n.delete(s.code);
                  setCodes(n);
                }}
              />
              {s.label}
              {done && <span className="ml-auto text-[11.5px] text-emerald-600">установлен</span>}
            </label>
          );
        })}
      </div>
      <div className="mt-4">
        <Button variant="primary" size="sm" isLoading={install.isPending} disabled={!codes.size} onClick={() => install.mutate()}>
          Добавить выбранные ({codes.size})
        </Button>
      </div>
    </div>
  );
}
