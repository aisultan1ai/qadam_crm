/**
 * Разделы настроек и где каждый показывается в каркасе.
 *
 * Все разделы — маршруты /settings/<to> (адреса не менялись), но в меню они разложены по месту использования:
 * - company — «Настройки компании» (кнопка внизу полосы модулей, для админа), по группам;
 * - personal — «Мои настройки» (меню аватара): то, что у каждого сотрудника своё;
 * - модуль (crm, work, inbox, calendar) — блок «Настройки» внизу панели этого модуля.
 */
import {
  BookText, Bot, CalendarClock, Clock, CreditCard, Factory, FormInput, Hash, HardDrive, KeyRound, Landmark, Link2, Mail,
  MessageCircle, Palette, Save, Shield, Sparkles,
  type LucideIcon,
} from "lucide-react";

export type SettingsPlace = "company" | "personal" | "crm" | "work" | "inbox" | "calendar";

export type SettingsTab = {
  to: string;
  label: string;
  icon: LucideIcon;
  place: SettingsPlace;
  /** Группа в «Настройках компании». */
  group?: "Компания" | "Доступ" | "Тариф и сервисы";
  /** Только владелец компании. */
  ownerOnly?: boolean;
  /** Право, без которого раздел скрыт (владельцу доступно всегда). */
  perm?: string;
};

export const SETTINGS_TABS: SettingsTab[] = [
  // Настройки компании
  { to: "branding", label: "Брендинг", icon: Palette, place: "company", group: "Компания", ownerOnly: true },
  // Страницы открыты всем (юрлица нужны в формах), но в меню — только тем, кто ими управляет
  { to: "legal-entities", label: "Юрлица", icon: Landmark, place: "company", group: "Компания", perm: "settings.dictionaries" },
  { to: "directories", label: "Справочники", icon: BookText, place: "company", group: "Компания", perm: "settings.dictionaries" },
  { to: "roles", label: "Роли и права", icon: Save, place: "company", group: "Доступ", perm: "roles.manage" },
  { to: "security", label: "Безопасность", icon: Shield, place: "company", group: "Доступ", perm: "settings.system" },
  { to: "api", label: "API", icon: KeyRound, place: "company", group: "Доступ", perm: "settings.system" },
  { to: "billing", label: "Тариф", icon: CreditCard, place: "company", group: "Тариф и сервисы", ownerOnly: true },
  // Страница открыта всем (видно, включён ли ИИ), в меню и включение — «Системные настройки»
  { to: "ai", label: "ИИ-помощник", icon: Sparkles, place: "company", group: "Тариф и сервисы", perm: "settings.system" },

  // Мои настройки
  { to: "mailbox", label: "Почтовый ящик", icon: Mail, place: "personal", perm: "mail.use" },
  { to: "integrations", label: "Google-календарь", icon: Link2, place: "personal", perm: "calendar.use" },
  { to: "services", label: "Сервисы и хранилища", icon: HardDrive, place: "personal" },

  // Настройки модулей
  // Смотреть могут все, включать offtake — «Системные настройки», продукты — «Управление справочниками»
  { to: "offtake", label: "Offtake", icon: Factory, place: "crm" },
  { to: "forms", label: "Формы захвата лидов", icon: FormInput, place: "crm", perm: "leads.manage_forms" },
  { to: "manager-availability", label: "Распределение лидов", icon: Clock, place: "crm", perm: "leads.view" },
  { to: "task-statuses", label: "Статусы задач", icon: Hash, place: "work", perm: "settings.dictionaries" },
  { to: "messengers", label: "Каналы открытых линий", icon: MessageCircle, place: "inbox", perm: "messengers.manage" },
  { to: "booking", label: "Страницы записи", icon: CalendarClock, place: "calendar", perm: "booking.use" },
];

/** Автоматизации живут своей страницей, но в меню — в «Настройках компании → Доступ». */
export const AUTOMATIONS_ICON: LucideIcon = Bot;

export function settingsTabVisible(t: SettingsTab, can: (code: string) => boolean, isOwner: boolean): boolean {
  if (t.ownerOnly) return isOwner;
  return !t.perm || isOwner || can(t.perm);
}

export function settingsTabsFor(place: SettingsPlace): SettingsTab[] {
  return SETTINGS_TABS.filter((t) => t.place === place);
}
