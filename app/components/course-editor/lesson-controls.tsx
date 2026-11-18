import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

import { useFetcherToast } from "./use-fetcher-toast";

export function InlineEditableLessonTitle({
  value,
  lessonId,
}: {
  value: string;
  lessonId: number;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const fetcher = useFetcher();

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  function handleSave() {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== value) {
      fetcher.submit(
        { intent: "rename-lesson", lessonId: String(lessonId), title: trimmed },
        { method: "post" }
      );
    }
    setIsEditing(false);
  }

  function handleCancel() {
    setEditValue(value);
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

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setIsEditing(true)}
      className="group flex items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-sm hover:bg-muted"
    >
      <span className="flex-1">{value}</span>
      <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

export function DeleteLessonButton({ lessonId }: { lessonId: number }) {
  const [confirming, setConfirming] = useState(false);
  const fetcher = useFetcher();

  useFetcherToast(fetcher, "Lesson deleted.");

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-destructive">Delete?</span>
        <Button
          variant="destructive"
          size="sm"
          className="h-6 text-xs"
          onClick={() => {
            fetcher.submit(
              { intent: "delete-lesson", lessonId: String(lessonId) },
              { method: "post" }
            );
            setConfirming(false);
          }}
        >
          Confirm
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs"
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
      onClick={() => setConfirming(true)}
    >
      <Trash2 className="size-3.5" />
    </Button>
  );
}

export function AddLessonForm({ moduleId }: { moduleId: number }) {
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const fetcher = useFetcher();

  useEffect(() => {
    if (isAdding && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isAdding]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      setTitle("");
      setIsAdding(false);
      toast.success("Lesson added.");
    }
    if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data]);

  function handleSubmit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    fetcher.submit(
      { intent: "add-lesson", moduleId: String(moduleId), title: trimmed },
      { method: "post" }
    );
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      setTitle("");
      setIsAdding(false);
    }
  }

  if (!isAdding) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsAdding(true)}
        className="mt-2 text-muted-foreground"
      >
        <Plus className="mr-1 size-3.5" />
        Add Lesson
      </Button>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <Input
        ref={inputRef}
        type="text"
        placeholder="Lesson title..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        className="max-w-xs text-sm"
      />
      <Button
        size="sm"
        className="h-8"
        onClick={handleSubmit}
        disabled={!title.trim()}
      >
        Add
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-8"
        onClick={() => {
          setTitle("");
          setIsAdding(false);
        }}
      >
        Cancel
      </Button>
    </div>
  );
}
