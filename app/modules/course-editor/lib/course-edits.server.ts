import { eq } from "drizzle-orm";
import { z } from "zod";

import { type Db, db } from "~/db";
import { courses, CourseStatus } from "~/db/schema";

import {
  createLesson,
  createModule,
  deleteLesson,
  deleteModule,
  getLessonById,
  getModuleById,
  moveLessonToModule,
  reorderLessons,
  reorderModules,
  updateLessonTitle,
  updateModuleTitle,
} from "./course-structure.server";

export const courseEditorIntentSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("update-title"),
    title: z.string().trim().min(1, "Title cannot be empty."),
  }),
  z.object({
    intent: z.literal("update-description"),
    description: z.string().trim().min(1, "Description cannot be empty."),
  }),
  z.object({
    intent: z.literal("update-status"),
    status: z.nativeEnum(CourseStatus),
  }),
  z.object({ intent: z.literal("update-price"), price: z.string() }),
  z.object({ intent: z.literal("update-ppp-enabled"), pppEnabled: z.string() }),
  z.object({
    intent: z.literal("add-module"),
    title: z.string().trim().min(1, "Module title cannot be empty."),
  }),
  z.object({
    intent: z.literal("rename-module"),
    moduleId: z.coerce.number().int(),
    title: z.string().trim().min(1, "Module title cannot be empty."),
  }),
  z.object({
    intent: z.literal("delete-module"),
    moduleId: z.coerce.number().int(),
  }),
  z.object({
    intent: z.literal("add-lesson"),
    moduleId: z.coerce.number().int(),
    title: z.string().trim().min(1, "Lesson title cannot be empty."),
  }),
  z.object({
    intent: z.literal("rename-lesson"),
    lessonId: z.coerce.number().int(),
    title: z.string().trim().min(1, "Lesson title cannot be empty."),
  }),
  z.object({
    intent: z.literal("reorder-modules"),
    moduleIds: z.string().min(1, "Missing module IDs."),
  }),
  z.object({
    intent: z.literal("reorder-lessons"),
    moduleId: z.coerce.number().int(),
    lessonIds: z.string().min(1, "Missing lesson IDs."),
  }),
  z.object({
    intent: z.literal("move-lesson"),
    lessonId: z.coerce.number().int(),
    targetModuleId: z.coerce.number().int(),
    targetPosition: z.coerce.number().int(),
  }),
  z.object({
    intent: z.literal("delete-lesson"),
    lessonId: z.coerce.number().int(),
  }),
  z.object({
    intent: z.literal("update-sales-copy"),
    salesCopy: z.string().trim().min(1, "Sales copy cannot be empty."),
  }),
]);

export type CourseEditorIntent = z.infer<typeof courseEditorIntentSchema>;

/** The course being edited, as the Course Manager check returns it. */
type EditedCourse = { id: number; title: string; description: string };

/** What the edit saved, or a refusal the editor shows as a toast. */
type CourseEditResult =
  | { success: true; field: string }
  | { error: string; status: 400 | 404 };

const MODULE_NOT_FOUND = {
  error: "Module not found in this course.",
  status: 404,
} as const;
const LESSON_NOT_FOUND = { error: "Lesson not found.", status: 404 } as const;
const LESSON_NOT_IN_COURSE = {
  error: "Lesson not found in this course.",
  status: 404,
} as const;

function saved(field: string): CourseEditResult {
  return { success: true, field };
}

function updateCourse(
  database: Db,
  id: number,
  fields: Partial<typeof courses.$inferInsert>
) {
  return database
    .update(courses)
    .set({ ...fields, updatedAt: new Date().toISOString() })
    .where(eq(courses.id, id))
    .returning()
    .get();
}

function isModuleInCourse(database: Db, moduleId: number, courseId: number) {
  return getModuleById(database, moduleId)?.courseId === courseId;
}

/**
 * The lesson's own Module must belong to the course; `null` when the lesson
 * exists in this course, otherwise the refusal to show.
 */
function refuseLessonOutsideCourse(
  database: Db,
  lessonId: number,
  courseId: number
): CourseEditResult | null {
  const lesson = getLessonById(database, lessonId);
  if (!lesson) return LESSON_NOT_FOUND;
  if (!isModuleInCourse(database, lesson.moduleId, courseId)) {
    return LESSON_NOT_IN_COURSE;
  }
  return null;
}

function updatePrice(database: Db, courseId: number, price: string) {
  const priceDollars = parseFloat(price);
  if (isNaN(priceDollars) || priceDollars < 0) {
    return {
      error: "Price must be a non-negative number.",
      status: 400,
    } as const;
  }
  if (priceDollars > 9999.99) {
    return { error: "Price cannot exceed $9,999.99.", status: 400 } as const;
  }
  updateCourse(database, courseId, { price: Math.round(priceDollars * 100) });
  return saved("price");
}

function updateSalesCopy(database: Db, courseId: number, salesCopy: string) {
  if (salesCopy.trim().length === 0) {
    throw new Error("Sales copy cannot be empty");
  }
  updateCourse(database, courseId, { salesCopy });
  return saved("sales-copy");
}

function moveLesson(
  database: Db,
  courseId: number,
  intent: Extract<CourseEditorIntent, { intent: "move-lesson" }>
) {
  const { lessonId, targetModuleId, targetPosition } = intent;
  const refusal = refuseLessonOutsideCourse(database, lessonId, courseId);
  if (refusal) return refusal;
  if (!isModuleInCourse(database, targetModuleId, courseId)) {
    return {
      error: "Target module not found in this course.",
      status: 404,
    } as const;
  }
  moveLessonToModule(database, lessonId, targetModuleId, targetPosition);
  return saved("lesson-move");
}

function editModule(
  database: Db,
  courseId: number,
  intent: Extract<
    CourseEditorIntent,
    { intent: "rename-module" | "delete-module" | "add-lesson" }
  >
) {
  if (!isModuleInCourse(database, intent.moduleId, courseId)) {
    return MODULE_NOT_FOUND;
  }
  switch (intent.intent) {
    case "rename-module":
      updateModuleTitle(database, intent.moduleId, intent.title);
      return saved("module");
    case "delete-module":
      deleteModule(database, intent.moduleId);
      return saved("module");
    case "add-lesson":
      createLesson(database, intent.moduleId, intent.title);
      return saved("lesson");
  }
}

function editLesson(
  database: Db,
  courseId: number,
  intent: Extract<
    CourseEditorIntent,
    { intent: "rename-lesson" | "delete-lesson" }
  >
) {
  const refusal = refuseLessonOutsideCourse(
    database,
    intent.lessonId,
    courseId
  );
  if (refusal) return refusal;
  if (intent.intent === "rename-lesson") {
    updateLessonTitle(database, intent.lessonId, intent.title);
  } else {
    deleteLesson(database, intent.lessonId);
  }
  return saved("lesson");
}

/**
 * Apply one edit from the course editor. Every Module and lesson it touches
 * must belong to `course`; the caller has already checked that the user is
 * its Course Manager.
 */
export function editCourse(
  course: EditedCourse,
  intent: CourseEditorIntent,
  database: Db = db
): CourseEditResult {
  const courseId = course.id;

  switch (intent.intent) {
    case "update-title":
      updateCourse(database, courseId, {
        title: intent.title,
        description: course.description,
      });
      return saved("title");
    case "update-description":
      updateCourse(database, courseId, {
        title: course.title,
        description: intent.description,
      });
      return saved("description");
    case "update-status":
      updateCourse(database, courseId, { status: intent.status });
      return saved("status");
    case "update-price":
      return updatePrice(database, courseId, intent.price);
    case "update-ppp-enabled":
      updateCourse(database, courseId, {
        pppEnabled: intent.pppEnabled === "true",
      });
      return saved("ppp-enabled");
    case "update-sales-copy":
      return updateSalesCopy(database, courseId, intent.salesCopy);
    case "add-module":
      createModule(database, courseId, intent.title);
      return saved("module");
    case "reorder-modules":
      reorderModules(database, courseId, JSON.parse(intent.moduleIds));
      return saved("module-reorder");
    case "reorder-lessons":
      if (!isModuleInCourse(database, intent.moduleId, courseId)) {
        return MODULE_NOT_FOUND;
      }
      reorderLessons(database, intent.moduleId, JSON.parse(intent.lessonIds));
      return saved("lesson-reorder");
    case "move-lesson":
      return moveLesson(database, courseId, intent);
    case "rename-module":
    case "delete-module":
    case "add-lesson":
      return editModule(database, courseId, intent);
    case "rename-lesson":
    case "delete-lesson":
      return editLesson(database, courseId, intent);
  }
}
