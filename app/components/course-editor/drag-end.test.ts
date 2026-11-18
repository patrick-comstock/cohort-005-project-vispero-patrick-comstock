import type { DropResult } from "@hello-pangea/dnd";
import { describe, expect, it } from "vitest";

import { dragEndSubmission } from "./drag-end";

const modules = [
  { id: 1, lessons: [{ id: 11 }, { id: 12 }, { id: 13 }] },
  { id: 2, lessons: [{ id: 21 }] },
];

function drop(
  type: string,
  source: [string, number],
  destination: [string, number] | null
) {
  return {
    type,
    source: { droppableId: source[0], index: source[1] },
    destination: destination && {
      droppableId: destination[0],
      index: destination[1],
    },
  } as DropResult;
}

describe("dragEndSubmission", () => {
  it("ignores a drop outside any list", () => {
    expect(
      dragEndSubmission(drop("module", ["modules", 0], null), modules)
    ).toBeNull();
  });

  it("ignores a drop back where it started", () => {
    expect(
      dragEndSubmission(
        drop("lesson", ["lessons-1", 1], ["lessons-1", 1]),
        modules
      )
    ).toBeNull();
  });

  it("reorders Modules", () => {
    expect(
      dragEndSubmission(drop("module", ["modules", 0], ["modules", 1]), modules)
    ).toEqual({
      kind: "module",
      formData: { intent: "reorder-modules", moduleIds: "[2,1]" },
    });
  });

  it("reorders lessons within a Module", () => {
    expect(
      dragEndSubmission(
        drop("lesson", ["lessons-1", 0], ["lessons-1", 2]),
        modules
      )
    ).toEqual({
      kind: "lesson",
      formData: {
        intent: "reorder-lessons",
        moduleId: "1",
        lessonIds: "[12,13,11]",
      },
    });
  });

  it("moves a lesson into another Module at a 1-based position", () => {
    expect(
      dragEndSubmission(
        drop("lesson", ["lessons-1", 1], ["lessons-2", 0]),
        modules
      )
    ).toEqual({
      kind: "lesson",
      formData: {
        intent: "move-lesson",
        lessonId: "12",
        targetModuleId: "2",
        targetPosition: "1",
      },
    });
  });
});
