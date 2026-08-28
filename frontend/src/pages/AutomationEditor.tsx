import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ReactFlow, Background, Controls, MiniMap, addEdge, useNodesState, useEdgesState,
  MarkerType, Handle, Position,
  type Node as RFNode, type Edge as RFEdge, type OnConnect, type NodeProps, type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import clsx from "clsx";
import {
  Save, ArrowLeft, Play, Zap, GitBranch, Clock, Bolt, Trash2, Loader2,
} from "lucide-react";
import { api, extractApiError } from "@/api/client";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/ui";

// ============================================================================
// Types
// ============================================================================

type Automation = {
  id: number;
  name: string;
  description: string | null;
  trigger_event: string;
  trigger_config: Record<string, unknown>;
  graph: { nodes?: RFNode[]; edges?: RFEdge[] };
  is_active: boolean;
};

type EventsCatalog = {
  events: string[];
  action_types: string[];
};

type TriggerNodeData = { event: string };
type ConditionNodeData = { expr: string; op: string; value: string };
type DelayNodeData = { seconds: number };
type ActionNodeData = { action_type: string; config: Record<string, unknown> };

const EVENT_LABEL: Record<string, string> = {
  "task.created": "Задача создана",
  "task.updated": "Задача изменена",
  "task.status_changed": "Статус задачи изменён",
  "task.completed": "Задача завершена",
  "task.deadline_near": "Приближается дедлайн",
  "lead.created": "Лид создан",
  "lead.status_changed": "Статус лида изменён",
  "comment.added": "Добавлен комментарий",
  "project.created": "Проект создан",
  "form.submitted": "Заполнена форма",
};

const ACTION_LABEL: Record<string, string> = {
  create_task: "Создать задачу",
  send_email: "Отправить email",
  send_notification: "Отправить уведомление",
  add_to_channel: "Написать в канал",
  change_status: "Изменить статус",
  assign_user: "Назначить исполнителя",
  add_comment: "Добавить комментарий",
  webhook: "Webhook (HTTP)",
};

const COND_OPS = [
  { v: "==", l: "равно" },
  { v: "!=", l: "не равно" },
  { v: ">", l: "больше" },
  { v: "<", l: "меньше" },
  { v: ">=", l: "≥" },
  { v: "<=", l: "≤" },
  { v: "contains", l: "содержит" },
  { v: "startswith", l: "начинается с" },
  { v: "empty", l: "пусто" },
  { v: "not_empty", l: "не пусто" },
];

// ============================================================================
// Node components
// ============================================================================

function TriggerNode({ data }: NodeProps) {
  const eventKey = String((data as TriggerNodeData)?.event || "");
  return (
    <div className="rounded-xl border-2 border-brand-400 bg-white px-4 py-3 shadow-md dark:bg-neutral-900" style={{ minWidth: 180 }}>
      <div className="flex items-center gap-2 text-xs font-semibold text-brand-700 dark:text-brand-300">
        <Zap size={12} /> ТРИГГЕР
      </div>
      <div className="mt-1 text-sm font-medium">{EVENT_LABEL[eventKey] || eventKey || "Событие"}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-brand-500" />
    </div>
  );
}

function ConditionNode({ data }: NodeProps) {
  const d = data as ConditionNodeData;
  const opLabel = COND_OPS.find((o) => o.v === d?.op)?.l || d?.op;
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-sm dark:border-amber-800 dark:bg-amber-950/40" style={{ minWidth: 200 }}>
      <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
        <GitBranch size={12} /> УСЛОВИЕ
      </div>
      <div className="mt-1 truncate text-xs font-mono text-neutral-700 dark:text-neutral-300">
        {d?.expr || "expr"} {opLabel} {d?.value || ""}
      </div>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} id="yes" style={{ left: "30%", background: "#10B981" }} />
      <Handle type="source" position={Position.Bottom} id="no" style={{ left: "70%", background: "#EF4444" }} />
      <div className="mt-2 flex justify-between text-[10px] text-neutral-500">
        <span>да ↓</span>
        <span>нет ↓</span>
      </div>
    </div>
  );
}

function DelayNode({ data }: NodeProps) {
  const seconds = Number((data as DelayNodeData)?.seconds || 0);
  const label =
    seconds >= 3600 ? `${(seconds / 3600).toFixed(1)} ч` : seconds >= 60 ? `${Math.round(seconds / 60)} мин` : `${seconds} с`;
  return (
    <div className="rounded-xl border border-violet-300 bg-violet-50 px-4 py-3 shadow-sm dark:border-violet-800 dark:bg-violet-950/40" style={{ minWidth: 160 }}>
      <div className="flex items-center gap-2 text-xs font-semibold text-violet-700 dark:text-violet-300">
        <Clock size={12} /> ПАУЗА
      </div>
      <div className="mt-1 text-sm font-medium">{label}</div>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function ActionNode({ data }: NodeProps) {
  const d = data as ActionNodeData;
  return (
    <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 shadow-sm dark:border-emerald-800 dark:bg-emerald-950/40" style={{ minWidth: 200 }}>
      <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
        <Bolt size={12} /> ДЕЙСТВИЕ
      </div>
      <div className="mt-1 text-sm font-medium">
        {ACTION_LABEL[d?.action_type] || d?.action_type || "—"}
      </div>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = {
  trigger: TriggerNode,
  condition: ConditionNode,
  delay: DelayNode,
  action: ActionNode,
};

// ============================================================================
// Main editor
// ============================================================================

const defaultEdgeOptions = {
  animated: true,
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
};

function newNodeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

const INITIAL_NODES: RFNode[] = [
  {
    id: "trigger_start",
    type: "trigger",
    position: { x: 250, y: 50 },
    data: { event: "task.created" } as TriggerNodeData,
    deletable: false,
  },
];

export default function AutomationEditor() {
  const { id: idParam } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const isNew = !idParam || idParam === "new";
  const automationId = isNew ? null : Number(idParam);

  const [name, setName] = useState("Новая автоматизация");
  const [description, setDescription] = useState("");
  const [triggerEvent, setTriggerEvent] = useState("task.created");
  const [isActive, setIsActive] = useState(true);

  const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Загрузка справочника событий/действий
  const { data: catalog } = useQuery({
    queryKey: ["automation-catalog"],
    queryFn: async () => (await api.get<EventsCatalog>("/api/automations/events")).data,
    staleTime: 5 * 60_000,
  });

  // Загрузка существующей автоматизации
  const { data: existing, isPending: loading } = useQuery({
    enabled: !!automationId,
    queryKey: ["automation", automationId],
    queryFn: async () => (await api.get<Automation>(`/api/automations/${automationId}`)).data,
  });

  useEffect(() => {
    if (!existing) return;
    setName(existing.name);
    setDescription(existing.description ?? "");
    setTriggerEvent(existing.trigger_event);
    setIsActive(existing.is_active);
    setNodes((existing.graph.nodes as RFNode[]) || INITIAL_NODES);
    setEdges((existing.graph.edges as RFEdge[]) || []);
  }, [existing, setNodes, setEdges]);

  // Обновление event в trigger-node при смене selector
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => (n.type === "trigger" ? { ...n, data: { event: triggerEvent } } : n)),
    );
  }, [triggerEvent, setNodes]);

  const onConnect: OnConnect = useCallback(
    (conn: Connection) => setEdges((eds) => addEdge({ ...conn, ...defaultEdgeOptions }, eds)),
    [setEdges],
  );

  const addNode = useCallback(
    (type: "condition" | "delay" | "action", data?: Record<string, unknown>) => {
      const id = newNodeId(type);
      const defaults: Record<string, Record<string, unknown>> = {
        condition: { expr: "event.entity.status", op: "==", value: "new" },
        delay: { seconds: 3600 },
        action: { action_type: "send_notification", config: {} },
      };
      const newNode: RFNode = {
        id,
        type,
        position: { x: 250 + Math.random() * 100, y: 200 + Math.random() * 200 },
        data: { ...defaults[type], ...(data || {}) },
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes],
  );

  const updateNodeData = useCallback(
    (nodeId: string, patch: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...(n.data as object), ...patch } } : n)),
      );
    },
    [setNodes],
  );

  const removeNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNodeId(null);
    },
    [setNodes, setEdges],
  );

  // Save / update
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        trigger_event: triggerEvent,
        trigger_config: {},
        graph: { nodes, edges },
        is_active: isActive,
      };
      if (isNew) {
        return (await api.post<Automation>("/api/automations", body)).data;
      }
      return (await api.patch<Automation>(`/api/automations/${automationId}`, body)).data;
    },
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ["automations"] });
      qc.invalidateQueries({ queryKey: ["automation", a.id] });
      toast.success(isNew ? "Автоматизация создана" : "Сохранено");
      if (isNew) navigate(`/automations/${a.id}`, { replace: true });
    },
    onError: (e) => toast.error("Ошибка сохранения", extractApiError(e).message),
  });

  const [testOpen, setTestOpen] = useState(false);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) || null,
    [nodes, selectedNodeId],
  );

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/automations" className="btn-ghost !p-2" title="Назад">
            <ArrowLeft size={16} />
          </Link>
          <input
            className="input !py-1.5 !text-base font-semibold"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ minWidth: 280 }}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-600"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <span className="text-neutral-600 dark:text-neutral-400">Активна</span>
          </label>
        </div>
        <div className="flex items-center gap-2">
          {!isNew && (
            <button className="btn-secondary" onClick={() => setTestOpen(true)}>
              <Play size={14} /> Тест-запуск
            </button>
          )}
          <button
            className="btn-primary"
            disabled={save.isPending || !name.trim() || loading}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {isNew ? "Создать" : "Сохранить"}
          </button>
        </div>
      </div>

      {/* Body: palette | canvas | inspector */}
      <div className="flex min-h-0 flex-1 gap-3">
        {/* Palette */}
        <div className="w-56 shrink-0 space-y-3 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900/50">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Триггер
            </div>
            <select
              className="input !py-1.5"
              value={triggerEvent}
              onChange={(e) => setTriggerEvent(e.target.value)}
            >
              {(catalog?.events || Object.keys(EVENT_LABEL)).map((e) => (
                <option key={e} value={e}>
                  {EVENT_LABEL[e] || e}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] text-neutral-500">
              Событие, которое запускает цепочку
            </p>
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Добавить
            </div>
            <div className="space-y-1.5">
              <PaletteBtn icon={<GitBranch size={13} />} label="Условие (if / else)" onClick={() => addNode("condition")} />
              <PaletteBtn icon={<Clock size={13} />} label="Пауза" onClick={() => addNode("delay")} />
              <div className="mt-1 mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                Действия
              </div>
              {(catalog?.action_types || Object.keys(ACTION_LABEL)).map((at) => (
                <PaletteBtn
                  key={at}
                  icon={<Bolt size={13} />}
                  label={ACTION_LABEL[at] || at}
                  onClick={() => addNode("action", { action_type: at, config: {} })}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Canvas */}
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            onNodeClick={(_, n) => setSelectedNodeId(n.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} size={1} />
            <Controls showInteractive={false} />
            <MiniMap zoomable pannable style={{ background: "#f7f7fa" }} />
          </ReactFlow>
        </div>

        {/* Inspector */}
        <div className="w-72 shrink-0 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900/50">
          {!selectedNode && (
            <div className="text-sm text-neutral-500">Выберите узел, чтобы настроить его</div>
          )}
          {selectedNode && (
            <NodeInspector
              key={selectedNode.id}
              node={selectedNode}
              onChange={(patch) => updateNodeData(selectedNode.id, patch)}
              onDelete={() => removeNode(selectedNode.id)}
            />
          )}

          <div className="mt-4">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Описание
            </div>
            <textarea
              className="input min-h-[80px] text-xs"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Для чего эта автоматизация?"
            />
          </div>

          <div className="mt-4 rounded-lg bg-neutral-50 p-2 text-[11px] text-neutral-600 dark:bg-neutral-800/50 dark:text-neutral-400">
            <div className="mb-1 font-semibold">Подстановка переменных:</div>
            <code className="block">{"{{event.entity.id}}"}</code>
            <code className="block">{"{{event.entity.title}}"}</code>
            <code className="block">{"{{event.entity.assignee_id}}"}</code>
            <code className="block">{"{{event.actor_id}}"}</code>
          </div>
        </div>
      </div>

      {testOpen && automationId != null && (
        <TestRunModal
          automationId={automationId}
          triggerEvent={triggerEvent}
          onClose={() => setTestOpen(false)}
        />
      )}
    </div>
  );
}

function PaletteBtn({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex w-full items-center gap-2 rounded-lg border border-neutral-200 px-2 py-1.5 text-left text-xs hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/40"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

// ============================================================================
// Node inspector (per-type)
// ============================================================================

function NodeInspector({
  node,
  onChange,
  onDelete,
}: {
  node: RFNode;
  onChange: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const data = (node.data || {}) as Record<string, unknown>;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {node.type}
        </div>
        {node.type !== "trigger" && (
          <button
            className="btn-ghost !p-1 text-rose-500 hover:bg-rose-50"
            onClick={onDelete}
            title="Удалить узел"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {node.type === "trigger" && (
        <p className="text-xs text-neutral-500">
          Триггер настраивается сверху в блоке «Событие»
        </p>
      )}

      {node.type === "condition" && (
        <div className="space-y-2">
          <Field label="Поле (dot-path)">
            <input
              className="input !py-1.5 font-mono text-xs"
              value={String(data.expr || "")}
              onChange={(e) => onChange({ expr: e.target.value })}
              placeholder="event.entity.status"
            />
          </Field>
          <Field label="Оператор">
            <select
              className="input !py-1.5"
              value={String(data.op || "==")}
              onChange={(e) => onChange({ op: e.target.value })}
            >
              {COND_OPS.map((o) => (
                <option key={o.v} value={o.v}>{o.l}</option>
              ))}
            </select>
          </Field>
          <Field label="Значение">
            <input
              className="input !py-1.5"
              value={String(data.value || "")}
              onChange={(e) => onChange({ value: e.target.value })}
              placeholder="new"
            />
          </Field>
        </div>
      )}

      {node.type === "delay" && (
        <div className="space-y-2">
          <Field label="Пауза (секунды)">
            <input
              type="number"
              min={1}
              className="input !py-1.5"
              value={Number(data.seconds || 0)}
              onChange={(e) => onChange({ seconds: Number(e.target.value) })}
            />
          </Field>
          <div className="text-[11px] text-neutral-500">
            3600 = 1 час, 86400 = 1 день
          </div>
        </div>
      )}

      {node.type === "action" && (
        <ActionInspector
          actionType={String(data.action_type || "send_notification")}
          config={(data.config as Record<string, unknown>) || {}}
          onTypeChange={(v) => onChange({ action_type: v, config: {} })}
          onConfigChange={(patch) =>
            onChange({ config: { ...(data.config as object), ...patch } })
          }
        />
      )}
    </div>
  );
}

function ActionInspector({
  actionType,
  config,
  onTypeChange,
  onConfigChange,
}: {
  actionType: string;
  config: Record<string, unknown>;
  onTypeChange: (v: string) => void;
  onConfigChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-2">
      <Field label="Тип действия">
        <select
          className="input !py-1.5"
          value={actionType}
          onChange={(e) => onTypeChange(e.target.value)}
        >
          {Object.entries(ACTION_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>

      {actionType === "create_task" && (
        <>
          <Field label="Название задачи">
            <input
              className="input !py-1.5"
              value={String(config.title || "")}
              onChange={(e) => onConfigChange({ title: e.target.value })}
              placeholder="Обработать лида {{event.entity.name}}"
            />
          </Field>
          <Field label="Описание">
            <textarea
              className="input min-h-[60px] text-xs"
              value={String(config.description || "")}
              onChange={(e) => onConfigChange({ description: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Assignee ID">
              <input
                type="number"
                className="input !py-1.5"
                value={Number(config.assignee_id || 0) || ""}
                onChange={(e) => onConfigChange({ assignee_id: Number(e.target.value) || null })}
              />
            </Field>
            <Field label="Project ID">
              <input
                type="number"
                className="input !py-1.5"
                value={Number(config.project_id || 0) || ""}
                onChange={(e) => onConfigChange({ project_id: Number(e.target.value) || null })}
              />
            </Field>
          </div>
          <Field label="Приоритет">
            <select
              className="input !py-1.5"
              value={String(config.priority || "medium")}
              onChange={(e) => onConfigChange({ priority: e.target.value })}
            >
              <option value="low">Низкий</option>
              <option value="medium">Средний</option>
              <option value="high">Высокий</option>
              <option value="critical">Критический</option>
            </select>
          </Field>
          <Field label="Дедлайн (часов от сейчас)">
            <input
              type="number"
              className="input !py-1.5"
              value={Number(config.deadline_hours_from_now || 0) || ""}
              onChange={(e) =>
                onConfigChange({ deadline_hours_from_now: Number(e.target.value) || null })
              }
            />
          </Field>
        </>
      )}

      {actionType === "send_email" && (
        <>
          <Field label="Кому (email или {{event.entity.contact}})">
            <input
              className="input !py-1.5"
              value={String(config.to || "")}
              onChange={(e) => onConfigChange({ to: e.target.value })}
            />
          </Field>
          <Field label="Тема">
            <input
              className="input !py-1.5"
              value={String(config.subject || "")}
              onChange={(e) => onConfigChange({ subject: e.target.value })}
            />
          </Field>
          <Field label="Тело">
            <textarea
              className="input min-h-[80px] text-xs"
              value={String(config.body || "")}
              onChange={(e) => onConfigChange({ body: e.target.value })}
            />
          </Field>
          <Field label="Ссылка (опционально)">
            <input
              className="input !py-1.5"
              value={String(config.link_url || "")}
              onChange={(e) => onConfigChange({ link_url: e.target.value })}
            />
          </Field>
        </>
      )}

      {actionType === "send_notification" && (
        <>
          <Field label="User ID (пусто = assignee из события)">
            <input
              type="number"
              className="input !py-1.5"
              value={Number(config.user_id || 0) || ""}
              onChange={(e) => onConfigChange({ user_id: Number(e.target.value) || null })}
            />
          </Field>
          <Field label="Заголовок">
            <input
              className="input !py-1.5"
              value={String(config.title || "")}
              onChange={(e) => onConfigChange({ title: e.target.value })}
            />
          </Field>
          <Field label="Тело">
            <textarea
              className="input min-h-[60px] text-xs"
              value={String(config.body || "")}
              onChange={(e) => onConfigChange({ body: e.target.value })}
            />
          </Field>
        </>
      )}

      {actionType === "add_to_channel" && (
        <>
          <Field label="Channel ID">
            <input
              type="number"
              className="input !py-1.5"
              value={Number(config.channel_id || 0) || ""}
              onChange={(e) => onConfigChange({ channel_id: Number(e.target.value) || null })}
            />
          </Field>
          <Field label="Текст сообщения">
            <textarea
              className="input min-h-[80px] text-xs"
              value={String(config.text || "")}
              onChange={(e) => onConfigChange({ text: e.target.value })}
            />
          </Field>
        </>
      )}

      {actionType === "change_status" && (
        <Field label="Новый статус">
          <input
            className="input !py-1.5"
            value={String(config.status || "")}
            onChange={(e) => onConfigChange({ status: e.target.value })}
            placeholder="in_progress"
          />
        </Field>
      )}

      {actionType === "assign_user" && (
        <Field label="User ID">
          <input
            type="number"
            className="input !py-1.5"
            value={Number(config.user_id || 0) || ""}
            onChange={(e) => onConfigChange({ user_id: Number(e.target.value) || null })}
          />
        </Field>
      )}

      {actionType === "add_comment" && (
        <>
          <Field label="Task ID (пусто = из события)">
            <input
              type="number"
              className="input !py-1.5"
              value={Number(config.task_id || 0) || ""}
              onChange={(e) => onConfigChange({ task_id: Number(e.target.value) || null })}
            />
          </Field>
          <Field label="Текст комментария">
            <textarea
              className="input min-h-[80px] text-xs"
              value={String(config.body || "")}
              onChange={(e) => onConfigChange({ body: e.target.value })}
            />
          </Field>
        </>
      )}

      {actionType === "webhook" && (
        <>
          <Field label="URL">
            <input
              className="input !py-1.5 font-mono text-xs"
              value={String(config.url || "")}
              onChange={(e) => onConfigChange({ url: e.target.value })}
              placeholder="https://api.example.com/hook"
            />
          </Field>
          <Field label="Метод">
            <select
              className="input !py-1.5"
              value={String(config.method || "POST")}
              onChange={(e) => onConfigChange({ method: e.target.value })}
            >
              <option>POST</option>
              <option>PUT</option>
              <option>PATCH</option>
            </select>
          </Field>
          <Field label="HMAC secret (опционально)">
            <input
              type="password"
              className="input !py-1.5 font-mono text-xs"
              value={String(config.hmac_secret || "")}
              onChange={(e) => onConfigChange({ hmac_secret: e.target.value })}
            />
          </Field>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

// ============================================================================
// Test run modal
// ============================================================================

function TestRunModal({
  automationId,
  triggerEvent,
  onClose,
}: {
  automationId: number;
  triggerEvent: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [payload, setPayload] = useState<string>(() =>
    JSON.stringify(
      { entity: { id: 1, title: "Тестовая задача", status: "new" }, actor_id: 1 },
      null,
      2,
    ),
  );

  const test = useMutation({
    mutationFn: async () => {
      let parsed = {};
      try {
        parsed = JSON.parse(payload);
      } catch {
        throw new Error("Некорректный JSON");
      }
      return (
        await api.post(`/api/automations/${automationId}/test`, { payload: parsed })
      ).data as { status: string; actions: Array<{ node_id: string; action_type: string; status: string }> };
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  return (
    <Modal open onClose={onClose} title={`Тест-запуск (${triggerEvent})`} size="lg">
      <div className="space-y-3">
        <div className="text-xs text-neutral-500">
          Обход графа с этим payload — но реальных действий не будет (dry-run).
        </div>
        <textarea
          className="input min-h-[180px] font-mono text-xs"
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Закрыть</button>
          <button className="btn-primary" disabled={test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Запустить
          </button>
        </div>
        {test.data && (
          <div className="rounded-lg border border-neutral-200 p-3 text-xs dark:border-neutral-800">
            <div className="mb-2">
              Результат: <span className={clsx("chip", test.data.status === "succeeded" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800")}>{test.data.status}</span>
            </div>
            <div className="space-y-1">
              {test.data.actions.map((a) => (
                <div key={a.node_id} className="flex justify-between rounded bg-neutral-50 px-2 py-1 dark:bg-neutral-800/40">
                  <span className="font-mono">{a.node_id}: {a.action_type}</span>
                  <span>{a.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
