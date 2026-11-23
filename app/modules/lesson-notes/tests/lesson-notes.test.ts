import { describe, expect, it } from "vitest";

import { getLessonNotesMarkdown } from "../index";

describe("getLessonNotesMarkdown", () => {
  it("drops a leading heading that repeats the lesson title", () => {
    expect(
      getLessonNotesMarkdown(
        "## What is TypeScript?\n\nA typed JS.",
        "What is TypeScript?"
      )
    ).toBe("A typed JS.");
  });

  it("matches the title regardless of case and spacing", () => {
    expect(
      getLessonNotesMarkdown(
        "#   what is  typescript? ##\nBody",
        "What is TypeScript?"
      )
    ).toBe("Body");
  });

  it("keeps a leading heading that differs from the title", () => {
    expect(getLessonNotesMarkdown("## Overview\n\nBody", "Lesson 1")).toBe(
      "## Overview\n\nBody"
    );
  });

  it("keeps a heading that repeats the title further down", () => {
    expect(getLessonNotesMarkdown("Intro\n\n## Lesson 1", "Lesson 1")).toBe(
      "Intro\n\n## Lesson 1"
    );
  });

  it("keeps a line that only starts with a hash and no space", () => {
    expect(getLessonNotesMarkdown("#Lesson 1\nBody", "Lesson 1")).toBe(
      "#Lesson 1\nBody"
    );
  });

  it("keeps a title heading followed by text on the same line as text", () => {
    expect(getLessonNotesMarkdown("## Lesson 1 and more", "Lesson 1")).toBe(
      "## Lesson 1 and more"
    );
  });

  it("returns null when the notes are only the repeated title", () => {
    expect(getLessonNotesMarkdown("## Lesson 1\n\n  ", "Lesson 1")).toBeNull();
  });

  it("returns null when there are no notes", () => {
    expect(getLessonNotesMarkdown(null, "Lesson 1")).toBeNull();
  });

  it("returns null for empty notes", () => {
    expect(getLessonNotesMarkdown("", "Lesson 1")).toBeNull();
  });

  it("ignores whitespace around the lesson title", () => {
    expect(getLessonNotesMarkdown("## Lesson 1\nBody", "  Lesson 1  ")).toBe(
      "Body"
    );
  });

  it("keeps a heading that differs from the title by a missing space", () => {
    expect(getLessonNotesMarkdown("## Lesson1\nBody", "Lesson 1")).toBe(
      "## Lesson1\nBody"
    );
  });

  it("returns null when the notes are only the title heading with no newline", () => {
    expect(getLessonNotesMarkdown("## Lesson 1", "Lesson 1")).toBeNull();
  });
});
