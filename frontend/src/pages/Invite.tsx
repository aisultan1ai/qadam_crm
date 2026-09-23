import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, extractApiError } from "@/api/client";
import { useAuth } from "@/store/auth";
import { LogoMark, Wordmark } from "@/components/Logo";
import { passwordSchema } from "@/lib/validation";
import { FormError } from "@/components/ui";
import { FormField } from "@/components/lib/FormField";
import { Button } from "@/components/lib/Button";

type InviteInfo = {
  token: string;
  email: string;
  tenant: { id: number; name: string; slug: string; logo_url: string | null };
  expires_at: string;
  requires_signup: boolean;
};

const schema = z.object({
  full_name: z.string().trim().min(2, "Минимум 2 символа").max(200),
  password: passwordSchema,
});
type InviteForm = z.infer<typeof schema>;

export default function Invite() {
  const { token = "" } = useParams();
  const nav = useNavigate();
  const { fetchMe } = useAuth();

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<InviteForm>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: "", password: "" },
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get<InviteInfo>(`/api/invitations/${token}`);
        if (!cancelled) setInfo(data);
      } catch (e) {
        if (!cancelled) setError(extractApiError(e).message || "Приглашение недействительно");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const acceptSimple = async () => {
    if (!info) return;
    setServerError(null);
    try {
      await api.post(`/api/invitations/${token}/accept`, {});
      await fetchMe();
      nav("/", { replace: true });
    } catch (e) {
      setServerError(extractApiError(e).message || "Не удалось принять приглашение");
    }
  };

  const acceptWithSignup = handleSubmit(async (data) => {
    if (!info) return;
    setServerError(null);
    try {
      await api.post(`/api/invitations/${token}/accept`, {
        full_name: data.full_name,
        password: data.password,
      });
      await fetchMe();
      nav("/", { replace: true });
    } catch (e) {
      setServerError(extractApiError(e).message || "Не удалось принять приглашение");
    }
  });

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-neutral-500">Загрузка…</div>
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="card max-w-sm p-6 text-center">
          <div className="mb-2 text-lg font-semibold">Приглашение недействительно</div>
          <div className="text-sm text-neutral-500">{error ?? "Ссылка просрочена или уже использована."}</div>
        </div>
      </div>
    );
  }

  const onSubmit = info.requires_signup
    ? acceptWithSignup
    : (e: React.FormEvent) => {
        e.preventDefault();
        acceptSimple();
      };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F6F7F9] p-4 dark:bg-[#0D0F13]">
      <form onSubmit={onSubmit} className="card w-full max-w-sm p-8" noValidate>
        <div className="mb-4 flex flex-col items-center gap-2">
          <LogoMark size={48} className="rounded-[12px]" />
          <Wordmark />
        </div>

        <div className="mb-4 text-center">
          <div className="text-sm text-neutral-500">Вас пригласили в компанию</div>
          <div className="mt-1 text-lg font-semibold">{info.tenant.name}</div>
          <div className="mt-1 text-xs text-neutral-500">{info.email}</div>
        </div>

        {info.requires_signup && (
          <>
            <FormField label="Ваше имя" error={errors.full_name?.message} className="mb-3">
              <input className="input" type="text" autoComplete="name" {...register("full_name")} />
            </FormField>
            <FormField label="Пароль" error={errors.password?.message} className="mb-4">
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                {...register("password")}
              />
            </FormField>
          </>
        )}

        {serverError && <FormError msg={serverError} />}

        <Button
          type="submit"
          variant="primary"
          fullWidth
          isLoading={isSubmitting}
          className="mt-3 disabled:opacity-60"
        >
          {isSubmitting ? "Принимаем…" : "Принять приглашение"}
        </Button>
      </form>
    </div>
  );
}
