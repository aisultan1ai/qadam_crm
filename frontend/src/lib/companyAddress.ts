/**
 * Адрес компании (soli.qcrm.kz). У каждого адреса своя сессия, поэтому перенос делаем
 * одноразовым кодом: сервер выдаёт ссылку /auth/handoff?code=… на адресе компании,
 * там код меняется на сессию — человек оказывается внутри без повторного ввода пароля.
 */
import { api } from "@/api/client";

/** Открыт ли сайт на адресе этой компании. */
export function onCompanyHost(subdomain: string | null | undefined): boolean {
  if (!subdomain) return false;
  return window.location.hostname.toLowerCase().startsWith(`${subdomain.toLowerCase()}.`);
}

/** Открыт ли сайт на чьём-то адресе компании (а не на основном). */
export function onAnySubdomain(): boolean {
  const parts = window.location.hostname.split(".");
  const h = window.location.hostname;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h === "localhost") return false;
  if (h.endsWith(".localhost")) return parts.length === 2;
  return parts.length >= 3 && parts[0] !== "www";
}

/** Перейти в компанию на её адресе (или на основной сайт, если своего адреса нет), уже вошедшим. */
export async function goToCompany(tenantId: number, path = "/"): Promise<void> {
  const { data } = await api.post<{ url: string }>("/api/auth/handoff", { tenant_id: tenantId });
  const url = new URL(data.url);
  if (path && path !== "/") url.searchParams.set("next", path);
  window.location.assign(url.toString());
}
