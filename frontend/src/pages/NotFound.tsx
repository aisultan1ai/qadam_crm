import { Link } from "react-router-dom";
import { Compass, Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
          <Compass size={32} />
        </div>
        <div className="mb-2 text-5xl font-bold tracking-tight text-neutral-900 dark:text-white">404</div>
        <h1 className="mb-2 text-xl font-semibold">Страница не найдена</h1>
        <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
          Возможно, ссылка устарела или содержит ошибку. Проверьте адрес или вернитесь на главную.
        </p>
        <div className="flex justify-center gap-2">
          <button className="btn-secondary" onClick={() => window.history.back()}>
            Назад
          </button>
          <Link to="/" className="btn-primary inline-flex items-center gap-1.5">
            <Home size={16} /> На главную
          </Link>
        </div>
      </div>
    </div>
  );
}
