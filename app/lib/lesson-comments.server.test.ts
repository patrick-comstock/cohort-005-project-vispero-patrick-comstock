import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import { createTestDb, seedBaseData } from "~/test/setup";

import {
  createComment,
  deleteComment,
  getLessonComments,
  updateComment,
} from "./lesson-comments.server";

type TestDb = ReturnType<typeof createTestDb>;

let testDb: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let otherLessonId: number;

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);

  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module 1", position: 1 })
    .returning()
    .get();
  [lessonId, otherLessonId] = [1, 2].map(
    (position) =>
      testDb
        .insert(schema.lessons)
        .values({ moduleId: mod.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

function post(userId: number, body: string, parentId: number | null = null) {
  return createComment(testDb, userId, lessonId, parentId, body);
}

describe("getLessonComments", () => {
  it("nests replies under their question and renders bodies to HTML", async () => {
    const question = post(base.user.id, "How do I **start**?");
    post(base.instructor.id, "Like this.", question.id);

    const [thread] = await getLessonComments(testDb, lessonId);

    expect(thread.bodyHtml).toContain("<strong>start</strong>");
    expect(thread.replies.map((r) => r.body)).toEqual(["Like this."]);
  });

  it("marks the course's Instructor as the author of their replies", async () => {
    const question = post(base.user.id, "A question");
    post(base.instructor.id, "An answer", question.id);

    const [thread] = await getLessonComments(testDb, lessonId);

    expect(thread.author.isInstructor).toBe(false);
    expect(thread.replies[0].author.isInstructor).toBe(true);
  });

  it("hides a deleted question that has no replies", async () => {
    const question = post(base.user.id, "Never mind");
    deleteComment(testDb, question.id, base.user.id, false);

    expect(await getLessonComments(testDb, lessonId)).toEqual([]);
  });

  it("keeps a deleted question with replies, without its body", async () => {
    const question = post(base.user.id, "Secret question");
    post(base.instructor.id, "An answer", question.id);
    deleteComment(testDb, question.id, base.user.id, false);

    const [thread] = await getLessonComments(testDb, lessonId);

    expect(thread).toMatchObject({ deleted: true, body: "", bodyHtml: "" });
    expect(thread.replies).toHaveLength(1);
  });
});

describe("createComment", () => {
  it("stores the body trimmed", () => {
    expect(post(base.user.id, "  hello  ").body).toBe("hello");
  });

  it("refuses an empty comment", () => {
    expect(() => post(base.user.id, "   ")).toThrow("Comment cannot be empty");
  });

  it("refuses a reply to a reply", () => {
    const question = post(base.user.id, "Q");
    const reply = post(base.instructor.id, "A", question.id);

    expect(() => post(base.user.id, "A2", reply.id)).toThrow(
      "Replies can only be one level deep"
    );
  });

  it("refuses a reply to a comment on another lesson", () => {
    const elsewhere = createComment(
      testDb,
      base.user.id,
      otherLessonId,
      null,
      "Q"
    );

    expect(() => post(base.user.id, "A", elsewhere.id)).toThrow(
      "Parent comment belongs to a different lesson"
    );
  });
});

describe("updateComment", () => {
  it("lets the author edit their comment and marks it edited", () => {
    const comment = post(base.user.id, "First");

    const updated = updateComment(testDb, comment.id, base.user.id, "Second");

    expect(updated.body).toBe("Second");
    expect(updated.editedAt).not.toBeNull();
  });

  it("refuses an edit by someone else", () => {
    const comment = post(base.user.id, "Mine");

    expect(() =>
      updateComment(testDb, comment.id, base.instructor.id, "Theirs")
    ).toThrow("You can only edit your own comments");
  });
});

describe("deleteComment", () => {
  it("refuses a delete by someone who is neither author nor Course Manager", () => {
    const comment = post(base.instructor.id, "Not yours");

    expect(() =>
      deleteComment(testDb, comment.id, base.user.id, false)
    ).toThrow("You can only delete your own comments");
  });

  it("lets a Course Manager delete anyone's comment", () => {
    const comment = post(base.user.id, "Off topic");

    const deleted = deleteComment(testDb, comment.id, base.instructor.id, true);

    expect(deleted.deletedAt).not.toBeNull();
  });
});
