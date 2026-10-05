/** Разделы настроек: общие для панели модуля в каркасе и для маршрутов страницы настроек. */
import {
  BookText, CalendarClock, Clock, CreditCard, Hash, Link2, Mail, MessageCircle, Palette, Puzzle, Save, Shield, UserPlus, Zap,
  type LucideIcon,
} from "lucide-react";

export type SettingsTab = {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Только владелец компании. */
  ownerOnly?: boolean;
  /** Право, без которого раздел скрыт (владельцу доступно всегда). */
  perm?: string;
};

export const SETTINGS_TABS: SettingsTab[] = [
  { to: "roles", label: "Роли и права", icon: Save, perm: "roles.manage" },
  { to: "team", label: "Команда", icon: UserPlus, perm: "users.create" },
  { to: "forms", label: "Формы захвата", icon: Zap, perm: "leads.manage_forms" },
  { to: "manager-availability", label: "Расписание менеджеров", icon: Clock, perm: "leads.view" },
  { to: "messengers", label: "Открытые линии", icon: MessageCircle, perm: "messengers.manage" },
  { to: "mailbox", label: "Почта", icon: Mail, perm: "mail.use" },
  { to: "booking", label: "Букинг", icon: CalendarClock, perm: "booking.use" },
  { to: "integrations", label: "Интеграции", icon: Link2, perm: "calendar.use" },
  { to: "branding", label: "Брендинг", icon: Palette, ownerOnly: true },
  { to: "billing", label: "Тариф", icon: CreditCard, ownerOnly: true },
  { to: "security", label: "Безопасность", icon: Shield, perm: "settings.system" },
  { to: "services", label: "Сервисы и хранилища", icon: Puzzle },
  { to: "task-statuses", label: "Статусы задач", icon: Hash, perm: "settings.dictionaries" },
  { to: "directories", label: "Справочники", icon: BookText },
];

export function settingsTabVisible(t: SettingsTab, can: (code: string) => boolean, isOwner: boolean): boolean {
  if (t.ownerOnly) return isOwner;
  return !t.perm || isOwner || can(t.perm);
}
