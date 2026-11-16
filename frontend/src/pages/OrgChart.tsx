/**
 * Оргструктура компании: «По руководителям» (дерево подчинения) и «По отделам» (отделы с главой и составом).
 * Администратор в режиме «Изменить структуру»: клик по сотруднику → руководитель / отдел / глава отдела;
 * в дереве можно протянуть связь мышью от руководителя к подчинённому, клик по связи — убрать её.
 */
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ReactFlow, Background, Controls, Handle, Position,
  type Node as RFNode, type Edge as RFEdge, type NodeProps, type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import clsx from "clsx";
import { Building2, Crown, GitBranch, LayoutGrid, Pencil, Users2 } from "lucide-react";

import { api, extractApiError } from "@/api/client";
import { Avatar, EmptyState, Loader, Modal } from "@/components/ui";
import { Button } from "@/components/lib/Button";
import { Segmented } from "@/components/page";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/store/auth";

type OrgUser = {
  id: number;
  name: string;
  email: string;
  avatar_url?: string | null;
  position?: string | null;
  department_id?: number | null;
  manager_id?: number | null;
};
type OrgDepartment = { id: number; name: string; parent_id?: number | null; head_user_id?: number | null };
type OrgChartData = { users: OrgUser[]; departments: OrgDepartment[] };
type View = "tree" | "departments";

const NODE_WIDTH = 220;
const NODE_H_GAP = 36;
const LEVEL_HEIGHT = 130;

/** Дерево по руководителям: корни — у кого руководителя нет; одиночки (без связей) — отдельным рядом снизу. */
function layoutTree(users: OrgUser[]) {
  const byId = new Map(users.map((u) => [u.id, u]));
  const children = new Map<number | null, OrgUser[]>();
  for (const u of users) {
    const p = u.manager_id && byId.has(u.manager_id) ? u.manager_id : null;
    if (!children.has(p)) children.set(p, []);
    children.get(p)!.push(u);
  }
  for (const l of children.values()) l.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const hasReports = (id: number) => (children.get(id) ?? []).length > 0;

  const pos = new Map<number, { x: number; y: number }>();
  let cursor = 0;
  let maxLevel = 0;
  const walk = (id: number, level: number): { left: number; right: number } => {
    maxLevel = Math.max(maxLevel, level);
    const kids = children.get(id) ?? [];
    if (!kids.length) {
      const x = cursor * (NODE_WIDTH + NODE_H_GAP);
      cursor += 1;
      pos.set(id, { x, y: level * LEVEL_HEIGHT });
      return { left: x, right: x };
    }
    const b = kids.map((k) => walk(k.id, level + 1));
    const x = (b[0].left + b[b.length - 1].right) / 2;
    pos.set(id, { x, y: level * LEVEL_HEIGHT });
    return { left: b[0].left, right: b[b.length - 1].right };
  };
  const roots = children.get(null) ?? [];
  const treeRoots = roots.filter((r) => hasReports(r.id));
  const loners = roots.filter((r) => !hasReports(r.id));
  for (const r of treeRoots) {
    walk(r.id, 0);
    cursor += 0.5;
  }
  // Сотрудники без руководителя и без подчинённых — отдельной строкой под деревом.
  const lonerY = (treeRoots.length ? maxLevel + 1.4 : 0) * LEVEL_HEIGHT;
  loners.forEach((u, i) => pos.set(u.id, { x: i * (NODE_WIDTH + NODE_H_GAP), y: lonerY }));
  for (const u of users) if (!pos.has(u.id)) walk(u.id, 0); // защита от циклов в старых данных
  return { pos, linked: treeRoots.length > 0, lonerY: treeRoots.length && loners.length ? lonerY : null };
}

type NodeData = { user: OrgUser; department?: string; isHead: boolean; editing: boolean; onOpen: (u: OrgUser) => void };

function UserNode({ data }: NodeProps<RFNode<NodeData>>) {
  const { user, department, isHead, editing, onOpen } = data;
  return (
    <button
      type="button"
      onClick={() => onOpen(user)}
      className={clsx(
        "rounded-xl border bg-white p-3 text-left shadow-sm transition-shadow hover:shadow-md dark:bg-[#1B1E23]",
        editing ? "border-brand-300 dark:border-brand-500/40" : "border-zinc-200 dark:border-zinc-700",
      )}
      style={{ width: NODE_WIDTH }}
      title={editing ? "Изменить руководителя и отдел" : "Открыть профиль"}
    >
      <Handle type="target" position={Position.Top} className={clsx(!editing && "!opacity-0")} />
      <div className="flex items-center gap-2">
        <Avatar name={user.name} url={user.avatar_url} size={34} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">{user.name}</div>
          <div className="truncate text-[11.5px] text-zinc-500">{user.position || "Должность не указана"}</div>
        </div>
      </div>
      {department && (
        <div className="mt-2 flex items-center gap-1 truncate text-[11px] text-zinc-500">
          <Building2 size={11} /> <span className="truncate">{department}</span>
          {isHead && (
            <span className="ml-auto inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              <Crown size={9} /> глава
            </span>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className={clsx(editing ? "!h-2.5 !w-2.5 !bg-brand-500" : "!opacity-0")} />
    </button>
  );
}
function LabelNode({ data }: NodeProps<RFNode<{ text: string }>>) {
  return <div className="whitespace-nowrap text-[12px] font-medium uppercase tracking-wide text-zinc-400">{data.text}</div>;
}
const NODE_TYPES = { user: UserNode, label: LabelNode };

export default function OrgChart() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { can, me } = useAuth();
  const canEdit = can("users.update") || !!me?.current_tenant?.is_owner;
  const canEditDeps = can("settings.dictionaries") || !!me?.current_tenant?.is_owner;
  const [view, setView] = useState<View>("tree");
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<OrgUser | null>(null);

  const { data, isPending, error } = useQuery({
    queryKey: ["hr", "org-chart"],
    queryFn: async () => (await api.get<OrgChartData>("/api/hr/org-chart")).data,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["hr", "org-chart"] });
    qc.invalidateQueries({ queryKey: ["users-brief"] });
  };
  const setManager = useMutation({
    mutationFn: ({ userId, managerId }: { userId: number; managerId: number | null }) =>
      api.patch(`/api/users/${userId}`, { manager_id: managerId ?? 0 }),
    onSuccess: refresh,
    onError: (e) => toast.error("Не удалось изменить руководителя", extractApiError(e).message),
  });

  const onOpen = useCallback(
    (u: OrgUser) => (editing ? setSelected(u) : navigate(`/people/${u.id}`)),
    [editing, navigate],
  );

  const depById = useMemo(() => new Map((data?.departments ?? []).map((d) => [d.id, d])), [data]);
  const { nodes, edges, linked } = useMemo(() => {
    if (!data) return { nodes: [] as RFNode[], edges: [] as RFEdge[], linked: false };
    const { pos, linked, lonerY } = layoutTree(data.users);
    const nodes: RFNode[] = data.users.map((u): RFNode<NodeData> => {
      const dep = u.department_id ? depById.get(u.department_id) : undefined;
      return {
        id: String(u.id),
        type: "user",
        position: pos.get(u.id) ?? { x: 0, y: 0 },
        data: { user: u, department: dep?.name, isHead: dep?.head_user_id === u.id, editing, onOpen },
      };
    });
    if (lonerY !== null) {
      nodes.push({
        id: "label-loners", type: "label", position: { x: 0, y: lonerY - 34 },
        data: { text: "Без руководителя и подчинённых" }, selectable: false, connectable: false,
      });
    }
    const ids = new Set(data.users.map((u) => u.id));
    const edges: RFEdge[] = data.users
      .filter((u) => u.manager_id && ids.has(u.manager_id))
      .map((u) => ({
        id: `e-${u.manager_id}-${u.id}`,
        source: String(u.manager_id),
        target: String(u.id),
        type: "smoothstep",
        style: { stroke: editing ? "rgb(var(--brand-500))" : "#a3a3a3", strokeWidth: editing ? 2 : 1.5 },
        data: { userId: u.id },
      }));
    return { nodes, edges, linked };
  }, [data, depById, editing, onOpen]);

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      setManager.mutate({ userId: Number(c.target), managerId: Number(c.source) });
    },
    [setManager],
  );

  if (isPending) return <Loader />;

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div>
          <div className="mb-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">Команда</div>
          <h1 className="page-title flex items-baseline gap-2">
            Оргструктура
            {data && (
              <span className="text-[13px] font-medium text-zinc-400">
                {data.users.length} сотр. · {data.departments.length} отд.
              </span>
            )}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Segmented
            label="Вид оргструктуры"
            value={view}
            onChange={setView}
            items={[
              { key: "tree", label: "По руководителям", icon: GitBranch },
              { key: "departments", label: "По отделам", icon: LayoutGrid },
            ]}
          />
          {canEdit && (
            <Button variant={editing ? "primary" : "secondary"} onClick={() => setEditing((v) => !v)}>
              <Pencil size={14} /> {editing ? "Готово" : "Изменить структуру"}
            </Button>
          )}
        </div>
      </div>

      {error ? (
        <EmptyState icon={<Users2 size={20} />} title="Не удалось загрузить оргструктуру" description="Обновите страницу или попробуйте позже." />
      ) : !data || data.users.length === 0 ? (
        <EmptyState icon={<Users2 size={20} />} title="Сотрудников пока нет" description="Пригласите команду: Команда → Пользователи → «Пригласить»." />
      ) : (
        <>
          {/* Подсказка: что это и как с этим работать */}
          {editing ? (
            <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-2.5 text-[13px] text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200">
              {view === "tree"
                ? "Нажмите на сотрудника, чтобы указать руководителя и отдел. Или протяните линию от нижней точки руководителя к подчинённому. Нажмите на линию, чтобы убрать связь."
                : "Нажмите на сотрудника, чтобы перевести его в другой отдел или назначить главой отдела."}
            </div>
          ) : (
            view === "tree" &&
            !linked && (
              <div className="rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-[13px] text-zinc-600 dark:border-zinc-800 dark:bg-[#1B1E23] dark:text-zinc-300">
                Схема строится по руководителям: у каждого сотрудника указывается, кому он подчиняется.
                {canEdit ? " Связей пока нет — нажмите «Изменить структуру», чтобы их задать." : " Связи пока не заданы администратором."}
              </div>
            )
          )}

          {view === "tree" ? (
            <div className="card overflow-hidden p-0" style={{ height: "calc(100vh - 250px)", minHeight: 480 }}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                fitView
                fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
                minZoom={0.2}
                proOptions={{ hideAttribution: true }}
                nodesDraggable={false}
                nodesConnectable={editing}
                onConnect={onConnect}
                onEdgeClick={(_, e) => {
                  if (!editing) return;
                  const uid = (e.data as { userId?: number } | undefined)?.userId;
                  const u = data.users.find((x) => x.id === uid);
                  if (u && window.confirm(`Убрать руководителя у «${u.name}»?`)) setManager.mutate({ userId: u.id, managerId: null });
                }}
              >
                <Background gap={20} size={1} />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>
          ) : (
            <DepartmentsBoard data={data} editing={editing} onOpen={onOpen} />
          )}
        </>
      )}

      {selected && data && (
        <EditMemberModal
          user={selected}
          data={data}
          canEditDeps={canEditDeps}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/** Вид «По отделам»: карточка на отдел — глава сверху, затем сотрудники; отдельная карточка «Без отдела». */
function DepartmentsBoard({ data, editing, onOpen }: { data: OrgChartData; editing: boolean; onOpen: (u: OrgUser) => void }) {
  const groups = useMemo(() => {
    const list = data.departments.map((d) => ({
      key: `d${d.id}`,
      title: d.name,
      head: data.users.find((u) => u.id === d.head_user_id) ?? null,
      members: data.users.filter((u) => u.department_id === d.id && u.id !== d.head_user_id),
    }));
    const none = data.users.filter((u) => !u.department_id || !data.departments.some((d) => d.id === u.department_id));
    if (none.length) list.push({ key: "none", title: "Без отдела", head: null, members: none });
    return list;
  }, [data]);

  if (!data.departments.length) {
    return (
      <EmptyState
        icon={<Building2 size={20} />}
        title="Отделов пока нет"
        description="Создайте отделы в Команда → Пользователи → «Отделы», затем распределите по ним сотрудников."
      />
    );
  }
  const Person = ({ u, head }: { u: OrgUser; head?: boolean }) => (
    <button
      type="button"
      onClick={() => onOpen(u)}
      className={clsx(
        "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-white/5",
        editing && "ring-1 ring-inset ring-transparent hover:ring-brand-300",
      )}
    >
      <Avatar name={u.name} url={u.avatar_url} size={28} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{u.name}</span>
        <span className="block truncate text-[11.5px] text-zinc-500">{u.position || "Должность не указана"}</span>
      </span>
      {head && (
        <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 text-[10.5px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <Crown size={10} /> Глава
        </span>
      )}
    </button>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {groups.map((g) => (
        <section key={g.key} className="card p-3">
          <div className="mb-2 flex items-center justify-between px-2">
            <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-zinc-900 dark:text-white">
              <Building2 size={15} className="text-zinc-400" /> {g.title}
            </h3>
            <span className="text-[12px] tabular-nums text-zinc-400">{g.members.length + (g.head ? 1 : 0)}</span>
          </div>
          {g.head && <Person u={g.head} head />}
          {g.head && g.members.length > 0 && <div className="mx-2 my-1 border-t border-zinc-100 dark:border-zinc-800" />}
          {g.members.map((u) => (
            <Person key={u.id} u={u} />
          ))}
          {!g.head && !g.members.length && <p className="px-2 py-2 text-[12.5px] text-zinc-400">В отделе пока никого</p>}
          {g.key !== "none" && !g.head && <p className="px-2 pt-1 text-[11.5px] text-zinc-400">Глава отдела не назначен</p>}
        </section>
      ))}
    </div>
  );
}

/** Изменение места сотрудника в структуре: руководитель, отдел, глава отдела. */
function EditMemberModal({
  user,
  data,
  canEditDeps,
  onClose,
  onSaved,
}: {
  user: OrgUser;
  data: OrgChartData;
  canEditDeps: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const currentDep = user.department_id ? data.departments.find((d) => d.id === user.department_id) : undefined;
  const [managerId, setManagerId] = useState<string>(user.manager_id ? String(user.manager_id) : "");
  const [depId, setDepId] = useState<string>(user.department_id ? String(user.department_id) : "");
  const [isHead, setIsHead] = useState(!!currentDep && currentDep.head_user_id === user.id);
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      await api.patch(`/api/users/${user.id}`, { manager_id: managerId ? Number(managerId) : 0, department_id: depId ? Number(depId) : 0 });
      if (canEditDeps) {
        const newDep = depId ? data.departments.find((d) => d.id === Number(depId)) : undefined;
        // Был главой прежнего отдела, а теперь нет (снял галочку или перешёл) — снимаем.
        if (currentDep && currentDep.head_user_id === user.id && (!isHead || currentDep.id !== newDep?.id)) {
          await api.patch(`/api/departments/${currentDep.id}`, { head_user_id: 0 });
        }
        if (newDep && isHead && newDep.head_user_id !== user.id) {
          await api.patch(`/api/departments/${newDep.id}`, { head_user_id: user.id });
        }
      }
    },
    onSuccess: () => {
      toast.success("Структура обновлена");
      onSaved();
    },
    onError: (e) => setErr(extractApiError(e).message),
  });

  const others = data.users.filter((u) => u.id !== user.id).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return (
    <Modal open onClose={onClose} title={user.name} size="sm">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setErr(null);
          save.mutate();
        }}
      >
        <label className="block">
          <span className="label">Руководитель — кому подчиняется</span>
          <select className="input" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">Нет (верх структуры)</option>
            {others.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.position ? ` — ${u.position}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Отдел</span>
          <select className="input" value={depId} onChange={(e) => setDepId(e.target.value)}>
            <option value="">Без отдела</option>
            {data.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {!data.departments.length && (
            <span className="mt-1 block text-xs text-zinc-500">Отделы создаются в Команда → Пользователи → «Отделы».</span>
          )}
        </label>
        {canEditDeps && depId && (
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" className="accent-brand-600" checked={isHead} onChange={(e) => setIsHead(e.target.checked)} />
            Глава этого отдела
          </label>
        )}
        {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{err}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button type="submit" variant="primary" isLoading={save.isPending}>Сохранить</Button>
        </div>
      </form>
    </Modal>
  );
}
