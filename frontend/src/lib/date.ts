import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

export function fromNow(input: string | number | Date): string {
  const d = typeof input === "string" || typeof input === "number" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "";
  return formatDistanceToNow(d, { addSuffix: true, locale: ru });
}

export function formatDateTime(input: string | number | Date): string {
  const d = typeof input === "string" || typeof input === "number" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU");
}
