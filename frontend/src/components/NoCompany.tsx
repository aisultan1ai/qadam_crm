/**
 * Человек вошёл, но не состоит ни в одной компании (его удалили из компании или он ещё не принял
 * приглашение). Раньше все запросы получали 401, и страница уходила в бесконечную перезагрузку.
 */
import { Link } from "react-router-dom";
import { AuthLayout } from "@/components/AuthLayout";
import { Button } from "@/components/lib/Button";
import { useAuth } from "@/store/auth";

export default function NoCompany() {
  const { me, logout } = useAuth();
  return (
    <AuthLayout
      title="Вы пока не в компании"
      subtitle={
        <>
          Вы вошли как <b className="text-zinc-900 dark:text-white">{me?.email}</b>, но эта учётная запись
          не состоит ни в одной компании.
        </>
      }
    >
      <div className="space-y-4 text-sm text-zinc-600 dark:text-zinc-300">
        <p>
          Если вас пригласили — откройте ссылку из письма-приглашения ещё раз: теперь приглашение примется
          одной кнопкой.
        </p>
        <p>Если письма нет — попросите администратора компании прислать новое приглашение.</p>
        {me?.is_platform_admin && (
          <Link to="/admin" className="link block font-medium">Открыть панель платформы</Link>
        )}
        <Button variant="secondary" size="xl" fullWidth onClick={() => logout()}>
          Выйти
        </Button>
      </div>
    </AuthLayout>
  );
}
