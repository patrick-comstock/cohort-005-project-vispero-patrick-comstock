import { BookOpen, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

export function CategoryRow({
  category,
}: {
  category: {
    id: number;
    name: string;
    slug: string;
    courseCount: number;
  };
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(category.name);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const updateFetcher = useFetcher();
  const deleteFetcher = useFetcher();

  useEffect(() => {
    if (isEditing && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditName(category.name);
  }, [category.name]);

  useEffect(() => {
    if (updateFetcher.state === "idle" && updateFetcher.data?.success) {
      setIsEditing(false);
      toast.success(updateFetcher.data.message);
    }
    if (updateFetcher.state === "idle" && updateFetcher.data?.error) {
      toast.error(updateFetcher.data.error);
    }
  }, [updateFetcher.state, updateFetcher.data]);

  useEffect(() => {
    if (deleteFetcher.state === "idle" && deleteFetcher.data?.success) {
      toast.success(deleteFetcher.data.message);
    }
    if (deleteFetcher.state === "idle" && deleteFetcher.data?.error) {
      toast.error(deleteFetcher.data.error);
    }
  }, [deleteFetcher.state, deleteFetcher.data]);

  function handleSave() {
    const trimmed = editName.trim();
    if (!trimmed) return;
    if (trimmed === category.name) {
      setIsEditing(false);
      return;
    }
    updateFetcher.submit(
      {
        intent: "update",
        categoryId: String(category.id),
        name: trimmed,
      },
      { method: "post" }
    );
  }

  function handleCancel() {
    setEditName(category.name);
    setIsEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  }

  function handleDelete() {
    deleteFetcher.submit(
      { intent: "delete", categoryId: String(category.id) },
      { method: "post" }
    );
  }

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3">
        {isEditing ? (
          <Input
            ref={nameInputRef}
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-8 text-sm"
          />
        ) : (
          <span className="text-sm font-medium">{category.name}</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="text-sm text-muted-foreground">{category.slug}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <BookOpen className="size-3.5" />
          {category.courseCount}
        </div>
      </td>
      <td className="px-4 py-3">
        {isEditing ? (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleSave}
              disabled={!editName.trim() || updateFetcher.state !== "idle"}
            >
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={handleCancel}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => setIsEditing(true)}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={handleDelete}
              disabled={deleteFetcher.state !== "idle"}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}
