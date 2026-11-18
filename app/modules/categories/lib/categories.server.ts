import { eq, sql } from "drizzle-orm";

import { type Db, db } from "~/db";
import { categories, courses } from "~/db/schema";

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function getCategoryBySlug(database: Db, slug: string) {
  return database
    .select()
    .from(categories)
    .where(eq(categories.slug, slug))
    .get();
}

function getCategoryByName(database: Db, name: string) {
  return database
    .select()
    .from(categories)
    .where(eq(categories.name, name))
    .get();
}

export function getAllCategoriesWithCourseCounts(database: Db = db) {
  return database
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      courseCount: sql<number>`count(${courses.id})`,
    })
    .from(categories)
    .leftJoin(courses, eq(categories.id, courses.categoryId))
    .groupBy(categories.id)
    .orderBy(categories.name)
    .all();
}

export function createCategory(name: string, database: Db = db) {
  const slug = slugify(name);

  const existingName = getCategoryByName(database, name);
  if (existingName) {
    throw new Error(`A category with the name "${name}" already exists.`);
  }

  const existingSlug = getCategoryBySlug(database, slug);
  if (existingSlug) {
    throw new Error(`A category with the slug "${slug}" already exists.`);
  }

  return database.insert(categories).values({ name, slug }).returning().get();
}

export function updateCategory(id: number, name: string, database: Db = db) {
  const slug = slugify(name);

  const existingName = getCategoryByName(database, name);
  if (existingName && existingName.id !== id) {
    throw new Error(`A category with the name "${name}" already exists.`);
  }

  const existingSlug = getCategoryBySlug(database, slug);
  if (existingSlug && existingSlug.id !== id) {
    throw new Error(`A category with the slug "${slug}" already exists.`);
  }

  return database
    .update(categories)
    .set({ name, slug })
    .where(eq(categories.id, id))
    .returning()
    .get();
}

export function deleteCategory(id: number, database: Db = db) {
  const courseCount = database
    .select({ count: sql<number>`count(*)` })
    .from(courses)
    .where(eq(courses.categoryId, id))
    .get();

  const count = courseCount?.count ?? 0;
  if (count > 0) {
    throw new Error(
      `Cannot delete: ${count} course${count === 1 ? "" : "s"} use this category.`
    );
  }

  return database
    .delete(categories)
    .where(eq(categories.id, id))
    .returning()
    .get();
}
