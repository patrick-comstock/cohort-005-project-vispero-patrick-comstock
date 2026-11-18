import { Eye, Globe } from "lucide-react";
import { Link } from "react-router";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { CourseStatus } from "~/db/schema";

/**
 * Status, pricing and links. The edits are submitted by the caller, whose
 * fetchers outlive this tab when the Course Manager switches away mid-save.
 */
export function SettingsTab({
  course,
  onStatusChange,
  onPriceChange,
  onPppToggle,
}: {
  course: {
    slug: string;
    status: string;
    price: number;
    pppEnabled: boolean;
  };
  onStatusChange: (status: string) => void;
  onPriceChange: (price: string) => void;
  onPppToggle: () => void;
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Course Status</h2>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Status:</span>
            <Select value={course.status} onValueChange={onStatusChange}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CourseStatus.Draft}>Draft</SelectItem>
                <SelectItem value={CourseStatus.Published}>
                  Published
                </SelectItem>
                <SelectItem value={CourseStatus.Archived}>Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Pricing</h2>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Price:</span>
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground">$</span>
                <Input
                  type="number"
                  min="0"
                  max="9999.99"
                  step="0.01"
                  defaultValue={(course.price / 100).toFixed(2)}
                  className="w-28"
                  onBlur={(e) => {
                    const val = parseFloat(e.target.value);
                    if (
                      !isNaN(val) &&
                      val >= 0 &&
                      Math.round(val * 100) !== course.price
                    ) {
                      onPriceChange(e.target.value);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                />
              </div>
            </div>

            <div
              className="flex items-center gap-2"
              title="Purchasing Power Parity: applies location-based discounts for students in lower-income countries"
            >
              <Globe className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">PPP:</span>
              <button
                type="button"
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  course.pppEnabled ? "bg-primary" : "bg-muted"
                }`}
                onClick={onPppToggle}
              >
                <span
                  className={`inline-block size-4 transform rounded-full bg-white transition-transform ${
                    course.pppEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
              <span className="text-xs text-muted-foreground">
                {course.pppEnabled ? "On" : "Off"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Links</h2>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Link to={`/courses/${course.slug}`}>
              <Button variant="outline" size="sm">
                <Eye className="mr-1.5 size-4" />
                View Public Page
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
