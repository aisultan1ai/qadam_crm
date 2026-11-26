/**
 * Настройки → ИИ-помощник: включение для компании и расход запросов за месяц.
 * Пока выключено, кнопки ИИ нигде не показываются и тексты компании никуда не отправляются.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";

import { api, extractApiError } from "@/api/client";
import { useToast } from "@/components/Toast";
import { SettingsRow, SettingsSection } from "@/components/page";
import { Loader } from "@/components/ui";
import { useAuth } from "@/store/auth";
import { useAi } from "@/hooks/useAi";

type UsageRow = { feature: string; label: string; requests: number; off_topic: number; errors: number };
type Usage = { limit: number; used: number; features: UsageRow[] };

export default function AiSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { can, me } = useAuth();
  const canSystem = can("settings.system") || !!me?.current_tenant?.is_owner;
  const { status, isPending } = useAi();

  const usage = useQuery({
    queryKey: ["ai-usage"],
    queryFn: async () => (await api.get<Usage>("/api/ai/usage")).data,
    enabled: canSystem && !!status?.enabled,
  });

  const toggle = useMutation({
    mutationFn: (value: boolean) => api.put("/api/ai/settings", { enabled: value }),
    onSuccess: (_r, value) => {
      qc.invalidateQueries({ queryKey: ["ai-status"] });
      qc.invalidateQueries({ queryKey: ["ai-usage"] });
      toast.success(value ? "ИИ-помощник включён" : "ИИ-помощник выключен");
    },
    onError: (e) => toast.error("Не удалось сохранить", extractApiError(e).message),
  });

  if (isPending || !status) return <Loader />;

  return (
    <div className="space-y-5">
      <SettingsSection
        title="ИИ-помощник"
        description="Сводки переписки, задачи из писем, разбор договоров, черновики писем и ответы на вопросы по данным компании. Работает на Claude (Anthropic)."
      >
        <SettingsRow
          label="Использовать ИИ"
          hint="Когда включено, тексты, которые сотрудник отправляет помощнику (письма, документы, записи CRM), передаются в Claude API для обработки. Помощник видит только данные вашей компании и только то, что доступно самому сотруднику."
        >
          <label className={clsx("inline-flex items-center gap-2 text-sm", !canSystem && "opacity-60")}>
            <input
              type="checkbox"
              checked={status.enabled}
              disabled={!canSystem || toggle.isPending}
              onChange={(e) => toggle.mutate(e.target.checked)}
            />
            {status.enabled ? "Включено" : "Выключено"}
          </label>
          {!canSystem && (
            <div className="mt-1 text-xs text-zinc-500">Включать и выключать может владелец компании или сотрудник с правом «Системные настройки».</div>
          )}
          {!status.configured && (
            <div className="mt-2 text-xs text-amber-700 dark:text-amber-400">ИИ не подключён на сервере: администратор платформы должен указать ключ Claude API.</div>
          )}
          {status.configured && status.limit <= 0 && (
            <div className="mt-2 text-xs text-amber-700 dark:text-amber-400">ИИ-помощник входит в тариф Plan X. Сменить тариф можно в разделе «Тариф».</div>
          )}
        </SettingsRow>
        <SettingsRow label="Запросов в этом месяце" hint="Лимит зависит от тарифа и обновляется 1-го числа.">
          <div className="text-sm tabular-nums">
            {status.used} из {status.limit}
          </div>
          <div className="mt-1.5 h-1.5 w-48 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
            <div
              className={clsx("h-full", status.limit > 0 && status.used >= status.limit ? "bg-rose-500" : "bg-brand-500")}
              style={{ width: `${status.limit > 0 ? Math.min(100, (status.used / status.limit) * 100) : 0}%` }}
            />
          </div>
        </SettingsRow>
      </SettingsSection>

      {canSystem && status.enabled && usage.data && usage.data.features.length > 0 && (
        <SettingsSection title="Расход по функциям" description="Только количество запросов: тексты запросов не сохраняются.">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="py-1.5 font-medium">Функция</th>
                <th className="py-1.5 text-right font-medium">Запросов</th>
                <th className="py-1.5 text-right font-medium">Не по теме</th>
              </tr>
            </thead>
            <tbody>
              {usage.data.features.map((f) => (
                <tr key={f.feature} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1.5">{f.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{f.requests}</td>
                  <td className="py-1.5 text-right tabular-nums text-zinc-500">{f.off_topic}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SettingsSection>
      )}
    </div>
  );
}
