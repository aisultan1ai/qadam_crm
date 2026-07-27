import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { api } from "@/api/client";
import { useNavigate } from "react-router-dom";
import { Modal } from "./ui";

type Hit = {
  tasks: { id: number; title: string; project_id?: number | null }[];
  projects: { id: number; name: string }[];
  users: { id: number; name: string; email: string }[];
  comments: { id: number; task_id: number; body: string }[];
};

export default function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [hit, setHit] = useState<Hit | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    if (!open) {
      setQ("");
      setHit(null);
    }
  }, [open]);

  useEffect(() => {
    if (!q.trim()) {
      setHit(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get<Hit>("/api/search", { params: { q } });
        setHit(data);
      } catch {}
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const go = (path: string) => {
    onClose();
    nav(path);
  };

  return (
    <Modal open={open} onClose={onClose} title="Глобальный поиск" size="lg">
      <div className="mb-4 flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-700/50 dark:bg-[#2b2b34]">
        <Search size={16} className="text-neutral-400" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Задачи, проекты, пользователи, комментарии…"
          className="w-full bg-transparent text-sm outline-none"
        />
      </div>

      {!hit && <div className="py-8 text-center text-sm text-neutral-500">Начните вводить запрос</div>}

      {hit && (
        <div className="space-y-5">
          <Group title="Задачи" empty={hit.tasks.length === 0}>
            {hit.tasks.map((t) => (
              <button key={t.id} onClick={() => go(`/tasks/${t.id}`)} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800">
                {t.title}
              </button>
            ))}
          </Group>
          <Group title="Проекты" empty={hit.projects.length === 0}>
            {hit.projects.map((p) => (
              <button key={p.id} onClick={() => go(`/projects/${p.id}`)} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800">
                {p.name}
              </button>
            ))}
          </Group>
          <Group title="Пользователи" empty={hit.users.length === 0}>
            {hit.users.map((u) => (
              <div key={u.id} className="rounded-lg px-3 py-2 text-sm">
                {u.name} <span className="text-neutral-500">— {u.email}</span>
              </div>
            ))}
          </Group>
          <Group title="Комментарии" empty={hit.comments.length === 0}>
            {hit.comments.map((c) => (
              <button
                key={c.id}
                onClick={() => go(`/tasks/${c.task_id}`)}
                className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <span className="line-clamp-2">{c.body}</span>
              </button>
            ))}
          </Group>
        </div>
      )}
    </Modal>
  );
}

function Group({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</div>
      {empty ? <div className="text-sm text-neutral-400">Ничего не найдено</div> : <div className="space-y-0.5">{children}</div>}
    </div>
  );
}
