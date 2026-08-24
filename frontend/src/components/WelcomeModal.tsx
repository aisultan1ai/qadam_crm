import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FolderKanban, Sparkles } from "lucide-react";

import { api } from "@/api/client";
import { useAuth } from "@/store/auth";
import { Modal } from "./ui";

const DISMISS_KEY = (tenantId: number) => `qadam:welcome-dismissed:${tenantId}`;

/**
 * Один раз на компанию показывает приветственную модалку, если проектов нет.
 * После dismiss / создания проекта — не показывается повторно на этом устройстве.
 */
export default function WelcomeModal() {
  const { me, can } = useAuth();
  const navigate = useNavigate();
  const tenantId = me?.current_tenant?.id;

  const [open, setOpen] = useState(false);

  // Проектов нет — новый tenant. Не грузим для гостей и пока email не подтверждён
  // (тогда сверху уже висит другой баннер, не спамим модалкой).
  const enabled = !!me && !!tenantId && me.email_verified !== false;

  const { data: projectsMeta, isSuccess } = useQuery({
    enabled,
    queryKey: ["projects-count", tenantId],
    queryFn: async () =>
      (await api.get<{ total: number }>("/api/projects", { params: { page: 1, per_page: 1 } })).data,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!enabled || !isSuccess || !tenantId) return;
    if ((projectsMeta?.total ?? 0) > 0) return;
    try {
      if (window.localStorage.getItem(DISMISS_KEY(tenantId))) return;
    } catch {
      // localStorage может быть недоступен
    }
    setOpen(true);
  }, [enabled, isSuccess, projectsMeta, tenantId]);

  const dismiss = () => {
    if (tenantId) {
      try {
        window.localStorage.setItem(DISMISS_KEY(tenantId), String(Date.now()));
      } catch {
        // ignore
      }
    }
    setOpen(false);
  };

  const goToProjects = () => {
    dismiss();
    navigate("/projects");
  };

  if (!enabled) return null;

  return (
    <Modal open={open} onClose={dismiss} title="Добро пожаловать в Qadam CRM" size="md">
      <div className="space-y-5">
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
            <Sparkles size={22} />
          </div>
          <div>
            <p className="text-sm text-neutral-700 dark:text-neutral-300">
              Ваша компания создана. Осталось запустить первый проект — задачи, аналитика и участники
              появятся автоматически.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="flex items-start gap-3">
            <FolderKanban size={18} className="mt-0.5 text-brand-600 dark:text-brand-300" />
            <div className="flex-1 text-sm">
              <div className="font-medium">Что делать дальше</div>
              <ol className="mt-1 list-decimal space-y-1 pl-4 text-neutral-600 dark:text-neutral-400">
                <li>Создайте проект — контейнер для задач</li>
                <li>Пригласите команду в Настройках → Команда</li>
                <li>Добавьте задачи и распределите их по статусам</li>
              </ol>
            </div>
          </div>
        </div>

        <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
          <button type="button" className="btn-ghost" onClick={dismiss}>
            Пропустить
          </button>
          {can("projects.create") ? (
            <button type="button" className="btn-primary" onClick={goToProjects}>
              Создать первый проект
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={dismiss}>
              Начать работу
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
