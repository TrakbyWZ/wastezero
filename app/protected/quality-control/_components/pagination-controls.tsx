"use client";

import { useId, useMemo } from "react";
import { Button } from "@/components/ui/button";
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
  /** Total matching rows (from the API's exact count), used to build the page dropdown. Null while not yet loaded. */
  totalCount: number | null;
  /** Total pages at the current page size - Math.max(1, Math.ceil(totalCount / pageSize)). Null while not yet loaded. */
  totalPages: number | null;
};

/**
 * Shared page-size + previous/next + page-number dropdown for the Quality
 * Control list and detail screens. The page dropdown is a real, exact list
 * (1..totalPages) backed by GET /api/log-correlation-files and
 * GET /api/log-correlations both returning an exact count alongside their
 * page of rows - unlike the Data Logs page, which has no such count and
 * only supports Previous/Next.
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
  totalCount,
  totalPages,
}: Props) {
  // Unique per instance - both QC pages render a PaginationControls, and a
  // hardcoded id would collide (invalid duplicate DOM ids) during the
  // client-side transition between them, where both can be mounted at once.
  const pageSizeId = useId();
  const pageJumpId = useId();

  // totalPages can legitimately be smaller than the current `page` for a
  // moment right after changing page size (the old page number is still in
  // state until the new fetch resolves) - clamp so the <select> always has
  // a matching <option> instead of silently showing nothing selected.
  const pageOptions = useMemo(() => {
    const count = Math.max(totalPages ?? 1, page);
    return Array.from({ length: count }, (_, i) => i + 1);
  }, [totalPages, page]);

  return (
    <div className="flex flex-col gap-3 border-t bg-muted/30 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <span>
          {loading
            ? "Loading…"
            : `${itemCount} ${itemLabel}${itemCount === 1 ? "" : "s"} on page ${page}${
                totalCount != null ? ` (${totalCount.toLocaleString()} total)` : ""
              }`}
        </span>
        <div className="flex items-center gap-1.5">
          <label htmlFor={pageSizeId} className="sr-only">
            Rows per page
          </label>
          <select
            id={pageSizeId}
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          Previous
        </Button>
        <div className="flex items-center gap-1.5">
          <label htmlFor={pageJumpId} className="text-muted-foreground">
            Page
          </label>
          <select
            id={pageJumpId}
            value={page}
            disabled={loading}
            onChange={(e) => onPageChange(Number(e.target.value))}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
          >
            {pageOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {totalPages != null && <span className="text-muted-foreground">of {totalPages.toLocaleString()}</span>}
        </div>
        <Button type="button" variant="outline" size="sm" disabled={loading || !hasMore} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
