import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

export function CreateCategoryRow({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const fetcher = useFetcher();
  // The parent passes a fresh onClose each render; an effect event keeps it
  // out of the dependencies so the effect runs once per fetcher result.
  const close = useEffectEvent(onClose);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      toast.success(fetcher.data.message);
      setName("");
      close();
    }
    if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data]);

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    fetcher.submit({ intent: "create", name: trimmed }, { method: "post" });
  }

  function handleCancel() {
    setName("");
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  }

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3">
        <Input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Category name"
          className="h-8 text-sm"
        />
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">—</td>
      <td className="px-4 py-3 text-sm text-muted-foreground">—</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={handleSave}
            disabled={!name.trim() || fetcher.state !== "idle"}
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
      </td>
    </tr>
  );
}
