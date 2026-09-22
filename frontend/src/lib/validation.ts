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
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Формат #rrggbb").default("#0F67FD"),
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

export const registerSchema = z.object({
  company_name: z.string().trim().min(2, "Минимум 2 символа").max(200),
  full_name: z.string().trim().min(2, "Минимум 2 символа").max(200),
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterForm = z.infer<typeof registerSchema>;

// ---------------------------------------------------------------------------
// CRM forms
// ---------------------------------------------------------------------------

const optionalEmail = z
  .string()
  .trim()
  .max(200)
  .optional()
  .refine(
    (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    "Некорректный email",
  );

const optionalPhone = z.string().trim().max(64).optional();

export const contactSchema = z.object({
  first_name: z.string().trim().min(1, "Введите имя").max(120),
  last_name: z.string().trim().max(120).optional(),
  email: optionalEmail,
  phone: optionalPhone,
  position: z.string().trim().max(120).optional(),
  company_id: z.union([z.number(), z.literal("")]).optional(),
  note: z.string().max(5000).optional(),
});
export type ContactForm = z.infer<typeof contactSchema>;

export const companySchema = z.object({
  name: z.string().trim().min(2, "Минимум 2 символа").max(200),
  industry: z.string().trim().max(150).optional(),
  website: z.string().trim().max(300).optional(),
  email: optionalEmail,
  phone: optionalPhone,
  tax_id: z.string().trim().max(64).optional(),
  address: z.string().trim().max(500).optional(),
  note: z.string().max(5000).optional(),
});
export type CompanyForm = z.infer<typeof companySchema>;

export const dealSchema = z.object({
  title: z.string().trim().min(2, "Минимум 2 символа").max(200),
  amount_cents: z
    .number({ invalid_type_error: "Число" })
    .int()
    .nonnegative("Не может быть отрицательным")
    .default(0),
  currency: z.string().trim().min(3).max(3).default("KZT"),
  stage: z
    .enum(["new", "qualified", "proposal", "negotiation", "won", "lost"])
    .default("new"),
  probability: z.number().int().min(0).max(100).default(50),
  close_date: z.string().optional().nullable(),
  note: z.string().max(5000).optional().nullable(),
  owner_id: z.union([z.number(), z.literal("")]).optional(),
  contact_id: z.union([z.number(), z.literal("")]).optional(),
  company_id: z.union([z.number(), z.literal("")]).optional(),
});
export type DealForm = z.infer<typeof dealSchema>;

export const leadSchema = z.object({
  name: z.string().trim().min(1, "Введите имя").max(200),
  contact: z.string().trim().min(1, "Укажите email или телефон").max(300),
  note: z.string().max(5000).optional().nullable(),
  status: z
    .enum(["new", "contacted", "qualified", "converted", "rejected"])
    .default("new"),
  source: z.string().trim().max(120).optional(),
  assignee_id: z.union([z.number(), z.literal("")]).optional(),
});
export type LeadForm = z.infer<typeof leadSchema>;

export const wikiArticleSchema = z.object({
  title: z.string().trim().min(2, "Минимум 2 символа").max(300),
  slug: z.string().trim().max(200).optional(),
  body_md: z.string().max(200000).optional().nullable(),
  parent_id: z.union([z.number(), z.literal("")]).optional().nullable(),
});
export type WikiArticleForm = z.infer<typeof wikiArticleSchema>;

export const profileSettingsSchema = z
  .object({
    name: z.string().trim().min(2, "Минимум 2 символа").max(200),
    email: emailSchema,
    current_password: z.string().optional(),
    new_password: z.union([passwordSchema, z.literal("")]).optional(),
    new_password_confirm: z.string().optional(),
  })
  .refine(
    (v) =>
      !v.new_password ||
      v.new_password === v.new_password_confirm,
    { message: "Пароли не совпадают", path: ["new_password_confirm"] },
  )
  .refine(
    (v) => !v.new_password || (v.current_password && v.current_password.length > 0),
    { message: "Введите текущий пароль", path: ["current_password"] },
  );
export type ProfileSettingsForm = z.infer<typeof profileSettingsSchema>;

export const holidaySchema = z.object({
  name: z.string().trim().min(2, "Минимум 2 символа").max(200),
  date: z.string().min(1, "Выберите дату"),
});
export type HolidayForm = z.infer<typeof holidaySchema>;

export const directoryItemSchema = z.object({
  name: z.string().trim().min(1, "Введите название").max(200),
  value: z.string().trim().max(1000).optional(),
});
export type DirectoryItemForm = z.infer<typeof directoryItemSchema>;

export const timeOffSchema = z.object({
  type: z.enum(["vacation", "sick", "personal", "other"]).default("vacation"),
  date_from: z.string().min(1, "Дата начала"),
  date_to: z.string().min(1, "Дата окончания"),
  reason: z.string().max(2000).optional(),
});
export type TimeOffForm = z.infer<typeof timeOffSchema>;
