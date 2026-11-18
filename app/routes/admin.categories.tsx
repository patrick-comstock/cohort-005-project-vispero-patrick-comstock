import { AlertTriangle, Plus, Tag } from "lucide-react";
import { useState } from "react";
import { data, isRouteErrorResponse, Link } from "react-router";
import { z } from "zod";

import { CategoryRow } from "~/components/category-row";
import { CreateCategoryRow } from "~/components/create-category-row";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Skeleton, skeletonKeys } from "~/components/ui/skeleton";
import { parseFormData } from "~/lib/validation";
import { requireAdmin } from "~/modules/access/index.server";
import {
  createCategory,
  deleteCategory,
  getAllCategoriesWithCourseCounts,
  updateCategory,
} from "~/modules/categories/index.server";

import type { Route } from "./+types/admin.categories";

const adminCategoryActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("create"),
    name: z.string().trim().min(1, "Category name cannot be empty."),
  }),
  z.object({
    intent: z.literal("update"),
    categoryId: z.coerce.number().int(),
    name: z.string().trim().min(1, "Category name cannot be empty."),
  }),
  z.object({
    intent: z.literal("delete"),
    categoryId: z.coerce.number().int(),
  }),
]);

export function meta() {
  return [
    { title: "Manage Categories — Cadence" },
    { name: "description", content: "Manage course categories" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);

  const categories = getAllCategoriesWithCourseCounts();

  return { categories };
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);

  const formData = await request.formData();
  const parsed = parseFormData(formData, adminCategoryActionSchema);

  if (!parsed.success) {
    return data(
      { error: Object.values(parsed.errors)[0] ?? "Invalid input." },
      { status: 400 }
    );
  }

  const { intent } = parsed.data;

  if (intent === "create") {
    try {
      createCategory(parsed.data.name);
      return { success: true, message: "Category created." };
    } catch (e) {
      return data(
        {
          error: e instanceof Error ? e.message : "Failed to create category.",
        },
        { status: 400 }
      );
    }
  }

  if (intent === "update") {
    try {
      updateCategory(parsed.data.categoryId, parsed.data.name);
      return { success: true, message: "Category updated." };
    } catch (e) {
      return data(
        {
          error: e instanceof Error ? e.message : "Failed to update category.",
        },
        { status: 400 }
      );
    }
  }

  if (intent === "delete") {
    try {
      deleteCategory(parsed.data.categoryId);
      return { success: true, message: "Category deleted." };
    } catch (e) {
      return data(
        {
          error: e instanceof Error ? e.message : "Failed to delete category.",
        },
        { status: 400 }
      );
    }
  }

  throw data("Invalid action.", { status: 400 });
}

function TableRowSkeleton() {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3">
        <Skeleton className="h-4 w-28" />
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-4 w-24" />
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-4 w-8" />
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-7 w-16" />
      </td>
    </tr>
  );
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <div className="mb-8">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="mt-2 h-5 w-72" />
      </div>
      <Skeleton className="mb-4 h-5 w-32" />
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Slug
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Courses
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {skeletonKeys(4).map((key) => (
                  <TableRowSkeleton key={key} />
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminCategories({ loaderData }: Route.ComponentProps) {
  const { categories } = loaderData;
  const [isAdding, setIsAdding] = useState(false);

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Manage Categories</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Manage Categories</h1>
        <p className="mt-1 text-muted-foreground">
          Create, edit, and delete course categories
        </p>
      </div>

      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Tag className="size-4" />
        <span>
          {categories.length}{" "}
          {categories.length === 1 ? "category" : "categories"} total
        </span>
      </div>

      {categories.length === 0 && !isAdding ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Tag className="mx-auto mb-3 size-8 text-muted-foreground/50" />
            <p className="mb-1 text-muted-foreground">No categories yet.</p>
            <p className="mb-4 text-sm text-muted-foreground">
              Create your first category to start organizing courses.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsAdding(true)}
            >
              <Plus className="mr-1.5 size-3.5" />
              Add Category
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {(categories.length > 0 || isAdding) && (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Name
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Slug
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Courses
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((category) => (
                      <CategoryRow key={category.id} category={category} />
                    ))}
                    {isAdding && (
                      <CreateCategoryRow onClose={() => setIsAdding(false)} />
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {!isAdding && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => setIsAdding(true)}
            >
              <Plus className="mr-1.5 size-3.5" />
              Add Category
            </Button>
          )}
        </>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message =
    "An unexpected error occurred while loading category management.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "Only admins can access this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
