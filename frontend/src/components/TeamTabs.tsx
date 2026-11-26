/**
 * Шапка раздела «Сотрудники»: один раздел вместо двух («Сотрудники» и «Пользователи»).
 * Вкладки ведут на прежние страницы, каждая видна только с её правом:
 * карточки — hr.view_profiles, доступ и роли / отделы — users.view, приглашения — users.create или владелец.
 */
import { useNavigate, useLocation } from "react-router-dom";

import { Tabs } from "@/components/page";
import { useAuth } from "@/store/auth";

type Key = "/people" | "/users/list" | "/users/invitations" | "/users/departments";

export function useTeamTabs() {
  const { can, me } = useAuth();
  const isOwner = !!me?.current_tenant?.is_owner;
  return [
    { key: "/people" as Key, label: "Карточки", hidden: !can("hr.view_profiles") },
    { key: "/users/list" as Key, label: "Доступ и роли", hidden: !can("users.view") },
    { key: "/users/invitations" as Key, label: "Приглашения", hidden: !(can("users.create") || isOwner) },
    { key: "/users/departments" as Key, label: "Отделы", hidden: !can("users.view") },
  ];
}

export function TeamTabs() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const items = useTeamTabs();
  const value = (items.find((i) => pathname.startsWith(i.key))?.key ?? "/people") as Key;
  return (
    <div className="space-y-4">
      <div className="page-header">
        <div>
          <div className="mb-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">Команда</div>
          <h1 className="page-title">Сотрудники</h1>
        </div>
      </div>
      <Tabs label="Разделы сотрудников" size="sm" value={value} onChange={(k) => nav(k)} items={items} />
    </div>
  );
}
