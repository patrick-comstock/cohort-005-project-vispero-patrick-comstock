import { beforeEach, describe, expect, it } from "vitest";

import { createTestDb, seedBaseData } from "~/test/setup";

import {
  createCategory,
  deleteCategory,
  getAllCategoriesWithCourseCounts,
  updateCategory,
} from "../index.server";

type TestDb = ReturnType<typeof createTestDb>;

let testDb: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);
});

describe("getAllCategoriesWithCourseCounts", () => {
  it("lists categories by name with how many courses use each", () => {
    createCategory("Design", testDb);

    expect(getAllCategoriesWithCourseCounts(testDb)).toEqual([
      {
        id: expect.any(Number),
        name: "Design",
        slug: "design",
        courseCount: 0,
      },
      {
        id: base.category.id,
        name: "Programming",
        slug: "programming",
        courseCount: 1,
      },
    ]);
  });
});

describe("createCategory", () => {
  it("derives the slug from the name", () => {
    const category = createCategory("  Data & AI 101!", testDb);

    expect(category.slug).toBe("data-ai-101");
  });

  it("refuses a name that is already taken", () => {
    expect(() => createCategory("Programming", testDb)).toThrow(
      'A category with the name "Programming" already exists.'
    );
  });

  it("refuses a name whose slug is already taken", () => {
    expect(() => createCategory("programming!", testDb)).toThrow(
      'A category with the slug "programming" already exists.'
    );
  });
});

describe("updateCategory", () => {
  it("renames the category and re-derives its slug", () => {
    const updated = updateCategory(base.category.id, "Web Development", testDb);

    expect(updated).toMatchObject({
      name: "Web Development",
      slug: "web-development",
    });
  });

  it("lets a category keep its own name", () => {
    const updated = updateCategory(base.category.id, "Programming", testDb);

    expect(updated?.slug).toBe("programming");
  });

  it("refuses a name another category already has", () => {
    const design = createCategory("Design", testDb);

    expect(() => updateCategory(design.id, "Programming", testDb)).toThrow(
      'A category with the name "Programming" already exists.'
    );
  });

  it("refuses a name whose slug another category already has", () => {
    const design = createCategory("Design", testDb);

    expect(() => updateCategory(design.id, "PROGRAMMING", testDb)).toThrow(
      'A category with the slug "programming" already exists.'
    );
  });
});

describe("deleteCategory", () => {
  it("deletes a category no course uses", () => {
    const design = createCategory("Design", testDb);

    deleteCategory(design.id, testDb);

    expect(getAllCategoriesWithCourseCounts(testDb).map((c) => c.name)).toEqual(
      ["Programming"]
    );
  });

  it("refuses to delete a category a course still uses", () => {
    expect(() => deleteCategory(base.category.id, testDb)).toThrow(
      "Cannot delete: 1 course use this category."
    );
  });
});
