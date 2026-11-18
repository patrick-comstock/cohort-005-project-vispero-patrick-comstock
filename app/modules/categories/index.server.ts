// Entry point of the Categories module: listing, creating, renaming and
// deleting course categories. A category's slug is derived from its name and
// must stay unique, and a category still used by a course cannot be deleted;
// those rules live in lib/ and are not importable from outside.
export {
  createCategory,
  deleteCategory,
  getAllCategoriesWithCourseCounts,
  updateCategory,
} from "./lib/categories.server";
