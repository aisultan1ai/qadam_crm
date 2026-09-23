import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, extractApiError } from "@/api/client";
import { Shield, Save } from "lucide-react";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/lib/Button";

type Policy = {
  password_min_length: number;
  password_require_upper: boolean;
  password_require_number: boolean;
  password_require_special: boolean;
  password_rotation_days: number | null;
  session_timeout_minutes: number | null;
  ip_allowlist: string[];
  require_2fa: boolean;
  require_2fa_for_admins: boolean;
};

export default function SecurityPolicyPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({
    queryKey: ["security-policy"],
    queryFn: async () => (await api.get<Policy>("/api/security-policy")).data,
  });

  const [form, setForm] = useState<Policy | null>(null);
  const [ipInput, setIpInput] = useState("");

  useEffect(() => {
    if (data && !form) {
      setForm(data);
      setIpInput((data.ip_allowlist || []).join("\n"));
    }
  }, [data, form]);

  const save = useMutation({
    mutationFn: (patch: Partial<Policy>) => api.patch("/api/security-policy", patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["security-policy"] });
      toast.success("Политики сохранены");
    },
    onError: (e) => toast.error("Не удалось сохранить", extractApiError(e).message),
  });

  if (!form) return <div className="h-40 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800/60" />;

  const submit = () => {
    save.mutate({
      ...form,
      ip_allowlist: ipInput.split("\n").map((s) => s.trim()).filter(Boolean),
    });
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <Shield size={20} /> Безопасность компании
        </h1>
        <p className="page-subtitle">Политики паролей, IP-ограничения, сессии, 2FA</p>
      </div>

      <div className="card p-4 space-y-4">
        <h2 className="text-lg font-semibold">Пароли</h2>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Минимальная длина</span>
          <input type="number" min={4} max={64} className="input max-w-[120px]" value={form.password_min_length} onChange={(e) => setForm({ ...form, password_min_length: Number(e.target.value) })} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.password_require_upper} onChange={(e) => setForm({ ...form, password_require_upper: e.target.checked })} />
          Обязательна заглавная буква
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.password_require_number} onChange={(e) => setForm({ ...form, password_require_number: e.target.checked })} />
          Обязательна цифра
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.password_require_special} onChange={(e) => setForm({ ...form, password_require_special: e.target.checked })} />
          Обязательный спецсимвол
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Ротация пароля (дней; пусто = не требовать)</span>
          <input type="number" min={0} className="input max-w-[120px]" value={form.password_rotation_days ?? ""} onChange={(e) => setForm({ ...form, password_rotation_days: e.target.value ? Number(e.target.value) : null })} />
        </label>
      </div>

      <div className="card p-4 space-y-4">
        <h2 className="text-lg font-semibold">2FA (двухфакторка)</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.require_2fa} onChange={(e) => setForm({ ...form, require_2fa: e.target.checked })} />
          Обязательна для всех
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.require_2fa_for_admins} onChange={(e) => setForm({ ...form, require_2fa_for_admins: e.target.checked })} />
          Обязательна для админов
        </label>
      </div>

      <div className="card p-4 space-y-4">
        <h2 className="text-lg font-semibold">IP-ограничения</h2>
        <p className="text-xs text-neutral-500">Список CIDR/IP, с которых разрешён доступ (по одному в строку). Пусто = без ограничений.</p>
        <textarea className="input min-h-[120px] font-mono text-xs" value={ipInput} onChange={(e) => setIpInput(e.target.value)} placeholder="192.168.0.0/24&#10;10.0.0.5" />
        <div className="text-xs text-amber-600">⚠️ Осторожно: неверный CIDR может заблокировать вас же. Проверьте свой IP.</div>
      </div>

      <div className="card p-4 space-y-3">
        <h2 className="text-lg font-semibold">Сессии</h2>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Таймаут неактивности (мин; пусто = без таймаута)</span>
          <input type="number" min={0} className="input max-w-[120px]" value={form.session_timeout_minutes ?? ""} onChange={(e) => setForm({ ...form, session_timeout_minutes: e.target.value ? Number(e.target.value) : null })} />
        </label>
      </div>

      <div className="flex justify-end">
        <Button variant="primary" onClick={submit} disabled={save.isPending}>
          <Save size={15} /> Сохранить
        </Button>
      </div>
    </div>
  );
}
