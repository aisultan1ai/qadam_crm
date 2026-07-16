import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(8, "Не менее 8 символов")
  .max(128, "Максимум 128 символов")
  .refine((v) => /[A-Za-zА-Яа-яЁё]/.test(v), "Нужна хотя бы одна буква")
  .refine((v) => /\d/.test(v), "Нужна хотя бы одна цифра")
  .refine((v) => v.trim() === v, "Без пробелов в начале/конце");

export const emailSchema = z.string().trim().toLowerCase().min(3, "Введите email").email("Некорректный email").or(
  z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Некорректный email"),
);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Введите пароль"),
});
export type LoginForm = z.infer<typeof loginSchema>;

export const projectSchema = z.object({
  name: z.string().trim().min(2, "Минимум 2 символа").max(200),
  description: z.string().max(5000).optional().nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Формат #rrggbb").default("#6366f1"),
  deadline: z.string().optional().nullable(),
  member_ids: z.array(z.number()).default([]),
});
export type ProjectForm = z.infer<typeof projectSchema>;

export const taskSchema = z.object({
  title: z.string().trim().min(2, "Минимум 2 символа").max(300),
  description: z.string().max(10000).optional().nullable(),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  project_id: z.union([z.number(), z.literal("")]).optional(),
  assignee_id: z.union([z.number(), z.literal("")]).optional(),
  deadline: z.string().optional().nullable(),
});
export type TaskForm = z.infer<typeof taskSchema>;

export const userSchemaBase = z.object({
  name: z.string().trim().min(2, "Минимум 2 символа").max(200),
  email: emailSchema,
  department_id: z.union([z.number(), z.literal("")]).optional(),
  role_ids: z.array(z.number()).default([]),
  is_active: z.boolean().default(true),
});

export const userCreateSchema = userSchemaBase.extend({
  password: passwordSchema,
});
export type UserCreateForm = z.infer<typeof userCreateSchema>;

export const userUpdateSchema = userSchemaBase.extend({
  password: z.union([passwordSchema, z.literal("")]).optional(),
});
export type UserUpdateForm = z.infer<typeof userUpdateSchema>;

export const departmentSchema = z.object({
  name: z.string().trim().min(2, "Минимум 2 символа").max(150),
});
export type DepartmentForm = z.infer<typeof departmentSchema>;
