import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, extractApiError } from "@/api/client";
import { useAuth } from "@/store/auth";
import { passwordSchema } from "@/lib/validation";
import { FormError, Loader } from "@/components/ui";
import { FormField } from "@/components/lib/FormField";
import { Button } from "@/components/lib/Button";
import { AuthLayout } from "@/components/AuthLayout";

type InviteInfo = {
  token: string;
  email: string;
  tenant: { id: number; name: string; slug: string; logo_url: string | null };
  expires_at: string;
  requires_signup: boolean;
};

const signupSchema = z.object({
  full_name: z.string().trim().min(2, "Минимум 2 символа").max(200),
  password: passwordSchema,
});
type SignupForm = z.infer<typeof signupSchema>;

/**
 * Приглашение в компанию.
 * Новый человек: задаёт имя и пароль → сразу внутри компании.
 * Уже есть аккаунт: если вошёл под ним — одна кнопка; иначе подтверждает своим паролем
 * (одной ссылки мало — её видит и тот, кто приглашал).
 */
export default function Invite() {
  const { token = "" } = useParams();
  const nav = useNavigate();
  const { me, fetchMe } = useAuth();

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [existingPassword, setExistingPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupForm>({ resolver: zodResolver(signupSchema), defaultValues: { full_name: "", password: "" } });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get<InviteInfo>(`/api/invitations/${token}`);
        if (!cancelled) setInfo(data);
      } catch (e) {
        if (!cancelled) setError(extractApiError(e).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const done = async () => {
    await fetchMe();
    nav("/", { replace: true });
  };

  const accept = async (body: Record<string, string>) => {
    setServerError(null);
    setBusy(true);
    try {
      await api.post(`/api/invitations/${token}/accept`, body);
      await done();
    } catch (e) {
      setServerError(extractApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loader />;

  if (error || !info) {
    return (
      <AuthLayout
        title="Приглашение недействительно"
        subtitle={error ?? "Ссылка просрочена или уже использована."}
        footer={
          <>
            Попросите администратора компании прислать новое приглашение или{" "}
            <Link to="/login" className="link font-medium">войдите</Link>.
          </>
        }
      >
        <div />
      </AuthLayout>
    );
  }

  const signedInAsInvitee = !!me && me.email?.toLowerCase() === info.email.toLowerCase();
  const subtitle = (
    <>
      Вас пригласили в компанию <b className="text-zinc-900 dark:text-white">{info.tenant.name}</b>
      <br />
      <span className="text-[13px]">{info.email}</span>
    </>
  );

  // Новый пользователь: имя + пароль.
  if (info.requires_signup) {
    return (
      <AuthLayout title="Присоединиться к команде" subtitle={subtitle}>
        <form onSubmit={handleSubmit((d) => accept({ full_name: d.full_name, password: d.password }))} className="space-y-4" noValidate>
          <FormField label="Ваше имя" htmlFor="inv-name" error={errors.full_name?.message}>
            <input id="inv-name" className="input input-lg" type="text" autoComplete="name" autoFocus {...register("full_name")} />
          </FormField>
          <FormField label="Придумайте пароль" htmlFor="inv-pass" error={errors.password?.message}>
            <input id="inv-pass" className="input input-lg" type="password" autoComplete="new-password" {...register("password")} />
          </FormField>
          {serverError && <FormError msg={serverError} />}
          <Button type="submit" variant="contrast" size="xl" fullWidth isLoading={isSubmitting || busy}>
            Принять приглашение
          </Button>
          <p className="text-xs text-zinc-500">Дальше вы будете входить с этим email и паролем.</p>
        </form>
      </AuthLayout>
    );
  }

  // Аккаунт уже есть.
  return (
    <AuthLayout title="Присоединиться к команде" subtitle={subtitle}>
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          accept(signedInAsInvitee ? {} : { password: existingPassword });
        }}
      >
        {signedInAsInvitee ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">Вы вошли как {info.email}. Компания появится в переключателе компаний.</p>
        ) : (
          <FormField
            label={
              <span className="flex items-center justify-between">
                Пароль от вашего аккаунта Qadam
                <Link to="/forgot-password" className="link text-[13px] font-normal">Забыли пароль?</Link>
              </span>
            }
            htmlFor="inv-existing"
          >
            <input
              id="inv-existing"
              className="input input-lg"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={existingPassword}
              onChange={(e) => setExistingPassword(e.target.value)}
            />
          </FormField>
        )}
        {serverError && <FormError msg={serverError} />}
        <Button
          type="submit"
          variant="contrast"
          size="xl"
          fullWidth
          isLoading={busy}
          disabled={!signedInAsInvitee && existingPassword.length < 8}
        >
          Принять приглашение
        </Button>
      </form>
    </AuthLayout>
  );
}
