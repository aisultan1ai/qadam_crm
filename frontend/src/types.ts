export type Permission = { id: number; code: string; name: string; group: string };
export type PermissionGroup = { group: string; items: Permission[] };

export type Role = {
  id: number;
  name: string;
  description?: string | null;
  permissions: Permission[];
  users_count: number;
};

export type UserBrief = { id: number; name: string; email: string; avatar_url?: string | null };

export type Department = { id: number; name: string };

export type User = {
  id: number;
  email: string;
  name: string;
  is_active: boolean;
  is_superuser: boolean;
  avatar_url?: string | null;
  department?: Department | null;
  department_id?: number | null;
  roles: Role[];
  last_login_at?: string | null;
  created_at: string;
};

export type Me = User & { permissions: string[] };

export type Project = {
  id: number;
  name: string;
  description?: string | null;
  color?: string | null;
  start_date?: string | null;
  deadline?: string | null;
  is_archived: boolean;
  created_at: string;
  owner?: UserBrief | null;
  members: UserBrief[];
  tasks_count: number;
};

export type TaskStatus = "new" | "in_progress" | "review" | "done" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "critical";

export type ChecklistItem = { id: number; text: string; done: boolean };
export type ReactionSummary = { emoji: string; count: number; users: UserBrief[] };
export type Comment = {
  id: number;
  body: string;
  created_at: string;
  updated_at: string;
  author?: UserBrief | null;
  reactions: ReactionSummary[];
};
export type Attachment = {
  id: number;
  filename: string;
  content_type?: string | null;
  size: number;
  created_at: string;
};
export type ActivityItem = {
  id: number;
  action: string;
  detail?: string | null;
  created_at: string;
  user?: UserBrief | null;
};

export type TaskListItem = {
  id: number;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  project_id?: number | null;
  assignee?: UserBrief | null;
  deadline?: string | null;
  created_at: string;
  order_index: number;
};

export type Task = TaskListItem & {
  description?: string | null;
  author?: UserBrief | null;
  checklist: ChecklistItem[];
  comments: Comment[];
  attachments: Attachment[];
  activities: ActivityItem[];
  updated_at: string;
};

export type Notification = {
  id: number;
  kind: string;
  title: string;
  body?: string | null;
  task_id?: number | null;
  is_read: boolean;
  created_at: string;
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  new: "Новая",
  in_progress: "В работе",
  review: "На проверке",
  done: "Завершена",
  cancelled: "Отменена",
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Низкий",
  medium: "Средний",
  high: "Высокий",
  critical: "Критический",
};

export const STATUS_ORDER: TaskStatus[] = ["new", "in_progress", "review", "done", "cancelled"];

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
};

export type TokenPair = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
};
