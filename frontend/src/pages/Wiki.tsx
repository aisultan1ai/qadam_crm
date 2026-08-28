import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import clsx from "clsx";
import {
  BookOpen, Folder, FolderPlus, FileText, Plus, Save, Search, ChevronRight,
  ChevronDown, Loader2, History, Link as LinkIcon, MessageSquare, Eye, Edit,
  Globe, Lock, Trash2, RotateCcw,
} from "lucide-react";
import { api, extractApiError } from "@/api/client";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/ui";

// ============================================================================
// Types
// ============================================================================

type FolderRow = {
  id: number;
  parent_id: number | null;
  name: string;
  slug: string;
  path: string;
  icon: string | null;
  sort_order: number;
};

type ArticleShort = {
  id: number;
  slug: string;
  title: string;
  folder_id: number | null;
  is_published: boolean;
};

type ArticleFull = {
  id: number;
  folder_id: number | null;
  slug: string;
  title: string;
  summary: string | null;
  content_md: string;
  content_html: string;
  is_published: boolean;
  view_count: number;
  author_id: number | null;
  last_editor_id: number | null;
  current_version: number;
  created_at: string | null;
  updated_at: string | null;
  access_level: "view" | "edit" | "admin" | null;
};

type Tree = {
  folders: FolderRow[];
  articles: ArticleShort[];
};

type VersionRow = {
  id: number;
  version: number;
  title: string;
  comment: string | null;
  editor_id: number | null;
  created_at: string | null;
};

type BacklinkRow = { id: number; title: string; slug: string };

type CommentRow = {
  id: number;
  parent_id: number | null;
  author_id: number | null;
  body: string;
  created_at: string | null;
};

type SearchRow = {
  id: number;
  title: string;
  slug: string;
  summary: string | null;
  snippet: string;
  rank: number;
};

// ============================================================================
// Main
// ============================================================================

export default function Wiki() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <BookOpen size={22} /> База знаний
          </h1>
          <p className="text-sm text-neutral-500">
            Внутренняя wiki: инструкции, регламенты, база FAQ
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn-secondary"
            onClick={() => setSearchOpen(true)}
            title="Поиск (Ctrl+K)"
          >
            <Search size={14} /> Поиск
          </button>
          <button className="btn-primary" onClick={() => navigate("/wiki/new")}>
            <Plus size={14} /> Новая статья
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[280px_1fr]">
        <TreeSidebar activeSlug={slug} />
        <div className="min-h-0 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/50">
          {!slug && <EmptyState />}
          {slug === "new" && <ArticleEditor mode="create" />}
          {slug && slug !== "new" && <ArticlePage slug={slug} />}
        </div>
      </div>

      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-neutral-500">
      <div className="text-center">
        <BookOpen size={32} className="mx-auto mb-2 text-neutral-400" />
        Выберите статью в дереве слева или создайте новую
      </div>
    </div>
  );
}

// ============================================================================
// Tree
// ============================================================================

function TreeSidebar({ activeSlug }: { activeSlug?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [folderModalOpen, setFolderModalOpen] = useState<{ parent: number | null } | null>(null);

  const { data: tree, isPending } = useQuery({
    queryKey: ["wiki-tree"],
    queryFn: async () => (await api.get<Tree>("/api/wiki/tree")).data,
  });

  const toggle = (id: number) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createFolder = useMutation({
    mutationFn: async (body: { name: string; parent_id: number | null }) =>
      (await api.post<FolderRow>("/api/wiki/folders", body)).data,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["wiki-tree"] });
      setFolderModalOpen(null);
      if (data.parent_id) setExpanded((s) => new Set(s).add(data.parent_id!));
      toast.success("Папка создана");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const foldersByParent = useMemo(() => {
    const map = new Map<number | null, FolderRow[]>();
    for (const f of tree?.folders ?? []) {
      const key = f.parent_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(f);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    return map;
  }, [tree]);

  const articlesByFolder = useMemo(() => {
    const map = new Map<number | null, ArticleShort[]>();
    for (const a of tree?.articles ?? []) {
      const key = a.folder_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.title.localeCompare(b.title));
    return map;
  }, [tree]);

  const renderNode = (folderId: number | null, depth: number): React.ReactNode => {
    const folders = foldersByParent.get(folderId) ?? [];
    const articles = articlesByFolder.get(folderId) ?? [];
    return (
      <>
        {folders.map((f) => {
          const isOpen = expanded.has(f.id);
          return (
            <div key={`f-${f.id}`}>
              <div
                className="group flex items-center gap-1 rounded px-1 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800/40"
                style={{ paddingLeft: `${depth * 12 + 4}px` }}
              >
                <button
                  className="rounded p-0.5 text-neutral-400 hover:text-neutral-700"
                  onClick={() => toggle(f.id)}
                >
                  {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                <Folder size={13} className="text-brand-500" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <button
                  className="hidden rounded p-0.5 text-neutral-400 hover:text-neutral-700 group-hover:inline-block"
                  title="Добавить подпапку"
                  onClick={() => setFolderModalOpen({ parent: f.id })}
                >
                  <FolderPlus size={11} />
                </button>
              </div>
              {isOpen && renderNode(f.id, depth + 1)}
            </div>
          );
        })}
        {articles.map((a) => (
          <Link
            key={`a-${a.id}`}
            to={`/wiki/${a.slug}`}
            className={clsx(
              "flex items-center gap-1 rounded px-1 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800/40",
              activeSlug === a.slug && "bg-brand-50 text-brand-800 dark:bg-brand-950/25 dark:text-brand-200",
            )}
            style={{ paddingLeft: `${depth * 12 + 20}px` }}
          >
            <FileText size={13} className="text-neutral-400" />
            <span className="min-w-0 flex-1 truncate">{a.title}</span>
            {a.is_published ? (
              <Globe size={11} className="text-emerald-500" />
            ) : (
              <Lock size={11} className="text-neutral-400" />
            )}
          </Link>
        ))}
      </>
    );
  };

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/50">
      <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Дерево</span>
        <button
          className="btn-ghost !p-1"
          title="Новая папка"
          onClick={() => setFolderModalOpen({ parent: null })}
        >
          <FolderPlus size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {isPending && <div className="p-4 text-center text-neutral-500"><Loader2 size={14} className="animate-spin" /></div>}
        {!isPending && renderNode(null, 0)}
      </div>

      {folderModalOpen && (
        <FolderCreateModal
          parentId={folderModalOpen.parent}
          onClose={() => setFolderModalOpen(null)}
          onSave={(name, parent_id) => createFolder.mutate({ name, parent_id })}
          isPending={createFolder.isPending}
        />
      )}
    </div>
  );
}

function FolderCreateModal({
  parentId, onClose, onSave, isPending,
}: {
  parentId: number | null;
  onClose: () => void;
  onSave: (name: string, parent_id: number | null) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState("");
  return (
    <Modal open onClose={onClose} title={parentId ? "Новая подпапка" : "Новая папка"} size="sm">
      <div className="space-y-3">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Название"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) onSave(name.trim(), parentId);
          }}
        />
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button
            className="btn-primary"
            disabled={!name.trim() || isPending}
            onClick={() => onSave(name.trim(), parentId)}
          >
            Создать
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// Article page (view + edit toggle)
// ============================================================================

function ArticlePage({ slug }: { slug: string }) {
  const [mode, setMode] = useState<"view" | "edit">("view");

  const { data: article, isPending, error } = useQuery({
    queryKey: ["wiki-article", slug],
    queryFn: async () => (await api.get<ArticleFull>(`/api/wiki/articles/${slug}`)).data,
  });

  useEffect(() => {
    setMode("view");
  }, [slug]);

  if (isPending) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="p-8 text-center text-sm text-rose-500">
        Не удалось загрузить статью: {extractApiError(error).message}
      </div>
    );
  }

  if (mode === "edit") {
    return <ArticleEditor mode="edit" article={article} onCancel={() => setMode("view")} />;
  }
  return <ArticleView article={article} onEdit={() => setMode("edit")} />;
}

function ArticleView({ article, onEdit }: { article: ArticleFull; onEdit: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const canEdit = article.access_level === "edit" || article.access_level === "admin";
  const canAdmin = article.access_level === "admin";
  const [showVersions, setShowVersions] = useState(false);

  const publish = useMutation({
    mutationFn: async () =>
      (await api.patch(`/api/wiki/articles/${article.id}`, { is_published: !article.is_published })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wiki-article", article.slug] });
      qc.invalidateQueries({ queryKey: ["wiki-tree"] });
      toast.success(article.is_published ? "Снята публикация" : "Опубликовано");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const del = useMutation({
    mutationFn: async () => api.delete(`/api/wiki/articles/${article.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wiki-tree"] });
      toast.success("Статья удалена");
      navigate("/wiki");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {article.is_published ? (
              <span className="chip bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                <Globe size={11} /> Опубликовано
              </span>
            ) : (
              <span className="chip bg-neutral-100 text-neutral-600 dark:bg-neutral-800">
                <Lock size={11} /> Черновик
              </span>
            )}
            <span className="chip bg-neutral-100 text-neutral-600 dark:bg-neutral-800">
              v{article.current_version}
            </span>
            <span className="text-xs text-neutral-500">
              {article.view_count} просмотров
            </span>
          </div>
          <h2 className="mt-2 text-2xl font-bold">{article.title}</h2>
          {article.summary && (
            <p className="mt-1 text-sm text-neutral-500">{article.summary}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          <button className="btn-ghost !py-1 !px-2 text-sm" onClick={() => setShowVersions((v) => !v)}>
            <History size={13} /> Версии
          </button>
          {canEdit && (
            <button className="btn-ghost !py-1 !px-2 text-sm" onClick={() => publish.mutate()}>
              {article.is_published ? <><Lock size={13} /> Снять</> : <><Globe size={13} /> Опубликовать</>}
            </button>
          )}
          {canEdit && (
            <button className="btn-primary" onClick={onEdit}>
              <Edit size={14} /> Редактировать
            </button>
          )}
          {canAdmin && (
            <button
              className="btn-ghost !py-1 !px-2 text-sm text-rose-600"
              onClick={() => {
                if (confirm("Удалить статью?")) del.mutate();
              }}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[1fr_260px]">
        <div className="min-h-0 overflow-y-auto px-6 py-4">
          <div
            className="prose prose-neutral max-w-none dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: article.content_html }}
          />
        </div>
        <div className="min-h-0 overflow-y-auto border-l border-neutral-200 bg-neutral-50/50 px-4 py-4 dark:border-neutral-800 dark:bg-neutral-900/30">
          {showVersions && (
            <VersionsPanel articleId={article.id} currentVersion={article.current_version} />
          )}
          <BacklinksPanel slug={article.slug} />
          <CommentsPanel articleId={article.id} />
        </div>
      </div>
    </div>
  );
}

function VersionsPanel({ articleId, currentVersion }: { articleId: number; currentVersion: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: versions } = useQuery({
    queryKey: ["wiki-versions", articleId],
    queryFn: async () => (await api.get<VersionRow[]>(`/api/wiki/articles/${articleId}/versions`)).data,
  });
  const revert = useMutation({
    mutationFn: async (version: number) =>
      (await api.post(`/api/wiki/articles/${articleId}/revert/${version}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wiki-article"] });
      qc.invalidateQueries({ queryKey: ["wiki-versions", articleId] });
      toast.success("Восстановлено");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });
  return (
    <div className="mb-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        История версий
      </div>
      <div className="space-y-1">
        {(versions ?? []).map((v) => (
          <div key={v.id} className="flex items-center gap-2 text-xs">
            <span className={clsx("chip", v.version === currentVersion ? "bg-brand-100 text-brand-800" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800")}>
              v{v.version}
            </span>
            <span className="flex-1 truncate">{v.comment || "—"}</span>
            {v.version !== currentVersion && (
              <button
                className="btn-ghost !p-1"
                title="Откатить к этой версии"
                onClick={() => {
                  if (confirm(`Откатить к v${v.version}?`)) revert.mutate(v.version);
                }}
              >
                <RotateCcw size={11} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BacklinksPanel({ slug }: { slug: string }) {
  const { data: backlinks } = useQuery({
    queryKey: ["wiki-backlinks", slug],
    queryFn: async () =>
      (await api.get<BacklinkRow[]>(`/api/wiki/articles/${slug}/backlinks`)).data,
  });
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        <LinkIcon size={11} /> Ссылаются на эту статью
      </div>
      {(backlinks?.length ?? 0) === 0 ? (
        <div className="text-xs text-neutral-400">Нет входящих ссылок</div>
      ) : (
        <div className="space-y-1">
          {backlinks!.map((b) => (
            <Link key={b.id} to={`/wiki/${b.slug}`} className="block text-sm link">
              → {b.title}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function CommentsPanel({ articleId }: { articleId: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState("");
  const { data: comments } = useQuery({
    queryKey: ["wiki-comments", articleId],
    queryFn: async () => (await api.get<CommentRow[]>(`/api/wiki/articles/${articleId}/comments`)).data,
  });
  const post = useMutation({
    mutationFn: async () =>
      (await api.post(`/api/wiki/articles/${articleId}/comments`, { body: text })).data,
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["wiki-comments", articleId] });
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });
  return (
    <div>
      <div className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        <MessageSquare size={11} /> Комментарии
      </div>
      <div className="mb-2 space-y-2">
        {(comments ?? []).map((c) => (
          <div key={c.id} className="rounded border border-neutral-200 p-2 text-xs dark:border-neutral-800">
            <div className="mb-1 text-[10px] text-neutral-400">
              user #{c.author_id ?? "—"} · {c.created_at ? new Date(c.created_at).toLocaleString("ru-RU") : ""}
            </div>
            <div className="whitespace-pre-wrap">{c.body}</div>
          </div>
        ))}
        {(comments?.length ?? 0) === 0 && (
          <div className="text-xs text-neutral-400">Пока нет</div>
        )}
      </div>
      <textarea
        className="input min-h-[60px] text-xs"
        placeholder="Добавить комментарий…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        className="btn-primary mt-1 w-full"
        disabled={!text.trim() || post.isPending}
        onClick={() => post.mutate()}
      >
        {post.isPending ? <Loader2 size={13} className="animate-spin" /> : "Отправить"}
      </button>
    </div>
  );
}

// ============================================================================
// Editor
// ============================================================================

function ArticleEditor({
  mode,
  article,
  onCancel,
}: {
  mode: "create" | "edit";
  article?: ArticleFull;
  onCancel?: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const [title, setTitle] = useState(article?.title ?? "");
  const [summary, setSummary] = useState(article?.summary ?? "");
  const [content, setContent] = useState(article?.content_md ?? "");
  const [commitMessage, setCommitMessage] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      if (mode === "create") {
        return (
          await api.post<ArticleFull>("/api/wiki/articles", {
            title: title.trim(),
            summary: summary.trim() || null,
            content_md: content,
          })
        ).data;
      }
      return (
        await api.patch<ArticleFull>(`/api/wiki/articles/${article!.id}`, {
          title: title.trim(),
          summary: summary.trim() || null,
          content_md: content,
          commit_message: commitMessage.trim() || null,
        })
      ).data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["wiki-tree"] });
      qc.invalidateQueries({ queryKey: ["wiki-article"] });
      toast.success(mode === "create" ? "Статья создана" : "Сохранено");
      if (mode === "create") {
        navigate(`/wiki/${data.slug}`);
      } else {
        onCancel?.();
      }
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-6 py-3 dark:border-neutral-800">
        <input
          className="input max-w-2xl flex-1 text-lg font-semibold"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Заголовок статьи"
        />
        <div className="flex gap-1">
          <button
            className={clsx("btn-ghost !py-1 !px-2 text-sm", showPreview && "bg-neutral-100 dark:bg-neutral-800")}
            onClick={() => setShowPreview((v) => !v)}
          >
            <Eye size={13} /> Превью
          </button>
          {onCancel && (
            <button className="btn-ghost" onClick={onCancel}>Отмена</button>
          )}
          <button
            className="btn-primary"
            disabled={!title.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {mode === "create" ? "Создать" : "Сохранить"}
          </button>
        </div>
      </div>

      <div className="border-b border-neutral-200 px-6 py-2 dark:border-neutral-800">
        <input
          className="input text-sm"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Краткое описание (опционально)"
        />
      </div>

      <div className="grid min-h-0 flex-1 gap-3 overflow-hidden px-6 py-3 md:grid-cols-2">
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Markdown
          </div>
          <textarea
            className="input min-h-0 flex-1 resize-none font-mono text-sm"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={"# Заголовок\n\nОбычный текст + [[ссылка-на-статью]]\n\n```python\nprint('hello')\n```"}
          />
        </div>
        <div className={clsx("flex min-h-0 flex-col overflow-hidden", !showPreview && "hidden md:flex")}>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Превью
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/40">
            <div className="prose prose-neutral max-w-none dark:prose-invert prose-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          </div>
        </div>
      </div>

      {mode === "edit" && (
        <div className="border-t border-neutral-200 px-6 py-2 dark:border-neutral-800">
          <input
            className="input text-xs"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Комментарий к правке (для истории версий)"
          />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Search modal
// ============================================================================

function SearchModal({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const { data, isFetching } = useQuery({
    enabled: q.trim().length > 1,
    queryKey: ["wiki-search", q.trim()],
    queryFn: async () =>
      (await api.get<SearchRow[]>("/api/wiki/search", { params: { q: q.trim() } })).data,
  });

  return (
    <Modal open onClose={onClose} title="Поиск по базе знаний" size="lg">
      <div className="space-y-3">
        <input
          className="input"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Начните вводить (минимум 2 символа)…"
        />
        {isFetching && (
          <div className="flex items-center justify-center py-4 text-neutral-500">
            <Loader2 size={14} className="animate-spin" />
          </div>
        )}
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {(data ?? []).map((r) => (
            <button
              key={r.id}
              className="w-full rounded-lg border border-neutral-200 p-3 text-left transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/40"
              onClick={() => {
                navigate(`/wiki/${r.slug}`);
                onClose();
              }}
            >
              <div className="font-semibold">{r.title}</div>
              {r.summary && <div className="mt-0.5 text-xs text-neutral-500">{r.summary}</div>}
              <div
                className="mt-1 text-xs text-neutral-600 dark:text-neutral-400"
                dangerouslySetInnerHTML={{ __html: r.snippet }}
              />
            </button>
          ))}
          {q.trim().length > 1 && !isFetching && (data?.length ?? 0) === 0 && (
            <div className="py-4 text-center text-sm text-neutral-500">Ничего не найдено</div>
          )}
        </div>
      </div>
    </Modal>
  );
}
