import type { DropResult } from "@hello-pangea/dnd";

type OutlineModule = { id: number; lessons: { id: number }[] };

/**
 * The edit a drop in the content outline asks for, or `null` when the drop
 * changes nothing. A "module" edit reorders Modules; a "lesson" edit reorders
 * lessons within a Module or moves one into another Module.
 */
type DragEndSubmission = {
  kind: "module" | "lesson";
  formData: Record<string, string>;
};

function moveItem<T>(items: T[], from: number, to: number) {
  const reordered = Array.from(items);
  const [moved] = reordered.splice(from, 1);
  reordered.splice(to, 0, moved);
  return reordered;
}

function moduleIdOf(droppableId: string) {
  return parseInt(droppableId.replace("lessons-", ""), 10);
}

export function dragEndSubmission(
  result: DropResult,
  modules: OutlineModule[]
): DragEndSubmission | null {
  const { source, destination } = result;
  if (!destination) return null;
  if (
    source.droppableId === destination.droppableId &&
    source.index === destination.index
  ) {
    return null;
  }

  if (result.type === "module") {
    const moduleIds = moveItem(modules, source.index, destination.index).map(
      (m) => m.id
    );
    return {
      kind: "module",
      formData: {
        intent: "reorder-modules",
        moduleIds: JSON.stringify(moduleIds),
      },
    };
  }

  if (result.type !== "lesson") return null;

  const sourceModuleId = moduleIdOf(source.droppableId);
  const destModuleId = moduleIdOf(destination.droppableId);
  const sourceMod = modules.find((m) => m.id === sourceModuleId);
  if (!sourceMod) return null;

  if (sourceModuleId === destModuleId) {
    const lessonIds = moveItem(
      sourceMod.lessons,
      source.index,
      destination.index
    ).map((l) => l.id);
    return {
      kind: "lesson",
      formData: {
        intent: "reorder-lessons",
        moduleId: String(sourceModuleId),
        lessonIds: JSON.stringify(lessonIds),
      },
    };
  }

  const lesson = sourceMod.lessons[source.index];
  if (!lesson) return null;

  return {
    kind: "lesson",
    formData: {
      intent: "move-lesson",
      lessonId: String(lesson.id),
      targetModuleId: String(destModuleId),
      // Lesson positions are 1-based.
      targetPosition: String(destination.index + 1),
    },
  };
}
