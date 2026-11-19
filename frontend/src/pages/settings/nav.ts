/** Разделы настроек: общие для панели модуля в каркасе и для маршрутов страницы настроек. */
import {
  BookText, CalendarClock, Clock, CreditCard, Hash, KeyRound, Link2, Mail, MessageCircle, Palette, Puzzle, Save, Shield, Zap,
  type LucideIcon,
} from "lucide-react";
import { Landmark } from "lucide-react";
import { Factory } from "lucide-react";

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
  { to: "api", label: "API", icon: KeyRound, perm: "settings.system" },
  { to: "task-statuses", label: "Статусы задач", icon: Hash, perm: "settings.dictionaries" },
  { to: "directories", label: "Справочники", icon: BookText },
  // Читать могут все (нужно для выбора юрлица в формах), менять — с правом «Управление справочниками»
  { to: "legal-entities", label: "Юрлица", icon: Landmark },
  // Смотреть могут все, включать offtake — «Системные настройки», продукты — «Управление справочниками»
  { to: "offtake", label: "Продажи и offtake", icon: Factory },
];

export function settingsTabVisible(t: SettingsTab, can: (code: string) => boolean, isOwner: boolean): boolean {
  if (t.ownerOnly) return isOwner;
  return !t.perm || isOwner || can(t.perm);
}
