"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PAGE_SIZE_OPTIONS, type PageSizeOption } from "@/lib/constants/pagination";

type Props = {
  page: number;
  pageSize: PageSizeOption;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: PageSizeOption) => void;
  hasMore: boolean;
  loading: boolean;
  itemCount: number;
  /** Singular noun for the count text, e.g. "file" or "row" */
  itemLabel: string;
};

/**
 * Shared page-size + previous/next + "jump to page" control for the Quality
 * Control list and detail screens. There's no total-row-count query backing
 * these tables (same no-count design as the Data Logs page), so "jump to
 * page" accepts any page >= 1 without an upper bound - jumping past the end
 * just renders the table's existing empty state.
 */
export function PaginationControls({
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  hasMore,
  loading,
  itemCount,
  itemLabel,
}: Props) {
  const [jumpValue, setJumpValue] = useState("");

  const handleJump = () => {
    const n = parseInt(jumpValue, 10);
    if (Number.isInteger(n) && n >= 1) {
      onPageChange(n);
      setJumpValue("");
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t bg-muted/30 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <span>
          {loading ? "Loading…" : `${itemCount} ${itemLabel}${itemCount === 1 ? "" : "s"} on page ${page}`}
        </span>
        <div className="flex items-center gap-1.5">
          <label htmlFor="qc-page-size" className="sr-only">
            Rows per page
          </label>
          <select
            id="qc-page-size"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value) as PageSizeOption)}
            className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} per page
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Page {page}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          Previous
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={loading || !hasMore} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
        <div className="flex items-center gap-1 ml-1">
          <Input
            type="number"
            min={1}
            value={jumpValue}
            onChange={(e) => setJumpValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleJump();
              }
            }}
            placeholder="Page #"
            aria-label="Jump to page"
            className="h-8 w-20 text-xs"
          />
          <Button type="button" variant="outline" size="sm" disabled={loading || !jumpValue} onClick={handleJump}>
            Go
          </Button>
        </div>
      </div>
    </div>
  );
}
