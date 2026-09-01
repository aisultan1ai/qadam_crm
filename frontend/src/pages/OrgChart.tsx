import { useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ReactFlow, Background, Controls, MiniMap, Handle, Position,
  type Node as RFNode, type Edge as RFEdge, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Network, Building2 } from "lucide-react";
import { api } from "@/api/client";
import { Avatar } from "@/components/ui";

type OrgUser = {
  id: number;
  name: string;
  email: string;
  avatar_url?: string | null;
  position?: string | null;
  department_id?: number | null;
  manager_id?: number | null;
};
type OrgDepartment = {
  id: number;
  name: string;
  parent_id?: number | null;
  head_user_id?: number | null;
};
type OrgChartData = {
  users: OrgUser[];
  departments: OrgDepartment[];
};

// ============================================================================
// Layout
// ============================================================================

const NODE_WIDTH = 220;
const NODE_H_GAP = 40;
const LEVEL_HEIGHT = 140;

/**
 * Простой tidy tree-layout: считает подписчиков (dependents) для каждого юзера,
 * рекурсивно раскладывает по уровням. Юзеры без manager_id — корни (level=0).
 * Осиротевшие ветки прикладываются справа от общего дерева.
 */
function layoutTree(users: OrgUser[]): Map<number, { x: number; y: number; level: number }> {
  const byId = new Map(users.map((u) => [u.id, u]));
  const childrenMap = new Map<number | null, OrgUser[]>();
  for (const u of users) {
    const parent = u.manager_id && byId.has(u.manager_id) ? u.manager_id : null;
    if (!childrenMap.has(parent)) childrenMap.set(parent, []);
    childrenMap.get(parent)!.push(u);
  }
  for (const list of childrenMap.values()) list.sort((a, b) => a.name.localeCompare(b.name, "ru"));

  const positions = new Map<number, { x: number; y: number; level: number }>();
  let cursor = 0;

  const walk = (userId: number, level: number): { left: number; right: number } => {
    const children = childrenMap.get(userId) ?? [];
    if (children.length === 0) {
      const x = cursor * (NODE_WIDTH + NODE_H_GAP);
      cursor += 1;
      positions.set(userId, { x, y: level * LEVEL_HEIGHT, level });
      return { left: x, right: x };
    }

    const bounds = children.map((c) => walk(c.id, level + 1));
    const left = bounds[0].left;
    const right = bounds[bounds.length - 1].right;
    const centerX = (left + right) / 2;
    positions.set(userId, { x: centerX, y: level * LEVEL_HEIGHT, level });
    return { left, right };
  };

  const roots = childrenMap.get(null) ?? [];
  for (const root of roots) {
    walk(root.id, 0);
    cursor += 1;
  }

  // Оставшиеся (циклы или сироты с manager_id, которого нет в дереве) — обрабатываем как корни.
  for (const u of users) {
    if (!positions.has(u.id)) walk(u.id, 0);
    cursor += 1;
  }

  return positions;
}

// ============================================================================
// Node component
// ============================================================================

type UserNodeData = {
  user: OrgUser;
  departmentName?: string;
  isDepartmentHead: boolean;
  onOpen: (id: number) => void;
};

function UserNode({ data }: NodeProps<RFNode<UserNodeData>>) {
  const { user, departmentName, isDepartmentHead, onOpen } = data;
  return (
    <button
      type="button"
      onClick={() => onOpen(user.id)}
      className="rounded-xl border border-neutral-200 bg-white p-3 text-left shadow-sm transition-shadow hover:shadow-md dark:border-neutral-700 dark:bg-neutral-900"
      style={{ width: NODE_WIDTH }}
    >
      <Handle type="target" position={Position.Top} className="!bg-neutral-400" />
      <div className="flex items-center gap-2">
        <Avatar name={user.name} url={user.avatar_url} size={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{user.name}</div>
          {user.position && (
            <div className="truncate text-xs text-neutral-500">{user.position}</div>
          )}
        </div>
      </div>
      {departmentName && (
        <div className="mt-2 flex items-center gap-1 truncate text-[11px] text-neutral-500">
          <Building2 size={11} />
          {departmentName}
          {isDepartmentHead && <span className="chip bg-amber-100 text-[9px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">глава</span>}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-neutral-400" />
    </button>
  );
}

const NODE_TYPES = { user: UserNode };

// ============================================================================
// Page
// ============================================================================

export default function OrgChart() {
  const navigate = useNavigate();

  const { data, isPending, error } = useQuery({
    queryKey: ["hr", "org-chart"],
    queryFn: async () => (await api.get<OrgChartData>("/api/hr/org-chart")).data,
    staleTime: 60_000,
  });

  const onOpen = useCallback((id: number) => navigate(`/people/${id}`), [navigate]);

  const { nodes, edges } = useMemo(() => {
    if (!data) return { nodes: [] as RFNode[], edges: [] as RFEdge[] };
    const departmentById = new Map(data.departments.map((d) => [d.id, d]));
    const positions = layoutTree(data.users);

    const nodes: RFNode<UserNodeData>[] = data.users.map((u) => {
      const pos = positions.get(u.id) ?? { x: 0, y: 0, level: 0 };
      const dep = u.department_id ? departmentById.get(u.department_id) : null;
      return {
        id: String(u.id),
        type: "user",
        position: { x: pos.x, y: pos.y },
        data: {
          user: u,
          departmentName: dep?.name,
          isDepartmentHead: dep?.head_user_id === u.id,
          onOpen,
        },
      };
    });

    const edges: RFEdge[] = data.users
      .filter((u) => u.manager_id && data.users.some((x) => x.id === u.manager_id))
      .map((u) => ({
        id: `e-${u.manager_id}-${u.id}`,
        source: String(u.manager_id),
        target: String(u.id),
        type: "smoothstep",
        style: { stroke: "#a3a3a3", strokeWidth: 1.5 },
      }));

    return { nodes, edges };
  }, [data, onOpen]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Network size={22} /> Оргструктура
          </h1>
          <p className="text-sm text-neutral-500">
            Иерархия сотрудников по полю «руководитель». Кликните на карточку — откроется профиль.
          </p>
        </div>
        <div className="text-xs text-neutral-500">
          {data && (
            <>
              Сотрудников: {data.users.length}, отделов: {data.departments.length}
            </>
          )}
        </div>
      </div>

      <div className="card p-0 overflow-hidden" style={{ height: "calc(100vh - 220px)", minHeight: 500 }}>
        {isPending && <div className="p-6 text-sm text-neutral-500">Загрузка…</div>}
        {error && <div className="p-6 text-sm text-rose-500">Не удалось загрузить оргструктуру</div>}
        {data && data.users.length === 0 && (
          <div className="grid h-full place-items-center p-6 text-center">
            <div>
              <Network size={48} className="mx-auto text-neutral-300" />
              <div className="mt-3 text-sm text-neutral-500">Пока нет активных сотрудников</div>
            </div>
          </div>
        )}
        {data && data.users.length > 0 && (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={() => "#a78bfa"} maskColor="rgba(0,0,0,0.05)" />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}
