import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";

import { API_URL } from "@/api/client";

type FormField = {
  key: string;
  label: string;
  type: "text" | "email" | "phone" | "textarea" | "select" | "number";
  required: boolean;
  placeholder?: string | null;
  options?: string[] | null;
};

type PublicConfig = {
  id: number;
  slug: string;
  title: string;
  subtitle: string | null;
  submit_label: string;
  success_message: string;
  brand_color: string;
  fields_config: FormField[];
  tenant_name: string;
};

export default function PublicForm() {
  const { slug = "", formId = "" } = useParams();
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [honeypot, setHoneypot] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentMessage, setSentMessage] = useState<string | null>(null);

  useEffect(() => {
    axios
      .get<PublicConfig>(`${API_URL}/api/f/${slug}/${formId}/config`)
      .then((r) => {
        setConfig(r.data);
        document.title = `${r.data.title} — ${r.data.tenant_name}`;
      })
      .catch((e) => {
        const msg = e?.response?.data?.error?.message || e?.response?.data?.detail || "Форма не найдена";
        setLoadError(msg);
      });
  }, [slug, formId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending || !config) return;
    setError(null);
    setSending(true);
    try {
      const payload: Record<string, string> = { ...values };
      if (honeypot) payload.website_url = honeypot;
      const r = await axios.post<{ message: string }>(
        `${API_URL}/api/f/${slug}/${formId}`,
        { payload },
      );
      setSentMessage(r.data?.message || config.success_message);
    } catch (err) {
      const msg =
        (err as any)?.response?.data?.error?.message ||
        (err as any)?.response?.data?.detail ||
        "Не удалось отправить. Попробуйте позже.";
      setError(msg);
    } finally {
      setSending(false);
    }
  };

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-4 dark:bg-neutral-950">
        <div className="max-w-md text-center">
          <div className="text-lg font-semibold">Форма недоступна</div>
          <p className="mt-2 text-sm text-neutral-500">{loadError}</p>
        </div>
      </div>
    );
  }
  if (!config) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-4 dark:bg-neutral-950">
        <div className="text-sm text-neutral-500">Загружаем…</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-4 dark:bg-neutral-950">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">{config.tenant_name}</div>
        <h1 className="text-xl font-semibold">{config.title}</h1>
        {config.subtitle && <p className="mt-1 text-sm text-neutral-500">{config.subtitle}</p>}

        {sentMessage ? (
          <div className="mt-6 rounded-xl bg-emerald-50 p-4 text-center text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
            {sentMessage}
          </div>
        ) : (
          <form onSubmit={submit} className="mt-4 space-y-3">
            {config.fields_config.map((f) => (
              <label key={f.key} className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
                  {f.label}
                  {f.required && <span className="ml-0.5 text-rose-500">*</span>}
                </span>
                {f.type === "textarea" ? (
                  <textarea
                    className="input min-h-[80px]"
                    required={f.required}
                    placeholder={f.placeholder || ""}
                    value={values[f.key] || ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                ) : f.type === "select" ? (
                  <select
                    className="input"
                    required={f.required}
                    value={values[f.key] || ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  >
                    <option value="">—</option>
                    {(f.options || []).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input"
                    required={f.required}
                    type={
                      f.type === "email" ? "email" :
                      f.type === "phone" ? "tel" :
                      f.type === "number" ? "number" : "text"
                    }
                    placeholder={f.placeholder || ""}
                    value={values[f.key] || ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                )}
              </label>
            ))}

            {/* Honeypot */}
            <input
              type="text"
              name="website_url"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
              className="absolute -left-[9999px] h-1 w-1 opacity-0"
            />

            {error && (
              <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={sending}
              className="w-full rounded-lg py-2.5 text-sm font-medium text-white transition-opacity disabled:opacity-60"
              style={{ background: config.brand_color }}
            >
              {sending ? "Отправляем…" : config.submit_label}
            </button>
          </form>
        )}

        <div className="mt-4 text-center text-[11px] text-neutral-400">
          Работает на <a href="/" className="link">Qadam CRM</a>
        </div>
      </div>
    </div>
  );
}
