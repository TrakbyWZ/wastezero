"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/lib/constants/pagination";
import { cn } from "@/lib/utils";
import type { LogFileRow } from "@/lib/types";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

type PreviewData = {
  file: {
    id: string;
    filename: string;
    job_name: string | null;
    job_number: string | null;
    operator: string | null;
    total_reads: number;
    bad_reads: number;
    sequence_reads: number;
    duplicate_count: number;
    uploaded_by: string | null;
  };
  records: Array<{
    log_file_header: string | null;
    job_name: string | null;
    job_number: string | null;
    operator: string | null;
    job_start_timestamp: string | null;
    job_end_timestamp: string | null;
    data_value: string;
    data_timestamp: string | null;
    sort_order: number;
    is_duplicate: boolean;
  }>;
  limit: number;
  page: number;
  total_count: number;
  duplicate_filter?: "all" | "duplicates" | "non_duplicates";
};

type LogFilesResponse = {
  rows: LogFileRow[];
  page: number;
  page_size: number;
  has_more: boolean;
};

export default function LogSyncDashboardPage() {
  const [files, setFiles] = useState<LogFileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filesPage, setFilesPage] = useState(1);
  const [filesHasMore, setFilesHasMore] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewLimit, setPreviewLimit] = useState(DEFAULT_PAGE_SIZE);
  const [previewDuplicateFilter, setPreviewDuplicateFilter] = useState<"all" | "duplicates" | "non_duplicates">("all");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = useCallback(async (page = filesPage) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(DEFAULT_PAGE_SIZE),
      });
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);

      const res = await fetch(`/api/log-files?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as LogFilesResponse;
      setFiles(data.rows ?? []);
      setFilesHasMore(data.has_more === true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load files");
      setFiles([]);
      setFilesHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [filesPage, fromDate, searchQuery, toDate]);

  useEffect(() => {
    void fetchFiles(filesPage);
  }, [fetchFiles, filesPage]);

  const openPreview = useCallback((id: string) => {
    setPreviewId(id);
    setPreview(null);
    setPreviewPage(1);
    setPreviewLimit(DEFAULT_PAGE_SIZE);
    setPreviewDuplicateFilter("all");
  }, []);

  const fetchPreview = useCallback(async () => {
    if (!previewId) return;
    setPreviewLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(previewLimit),
        page: String(previewPage),
        duplicate_filter: previewDuplicateFilter,
      });
      const res = await fetch(`/api/log-files/${previewId}/preview?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load preview");
      const data = await res.json();
      setPreview(data);
    } catch {
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [previewId, previewPage, previewLimit, previewDuplicateFilter]);

  useEffect(() => {
    if (previewId) fetchPreview();
  }, [previewId, fetchPreview]);

  const closePreview = useCallback(() => {
    setPreviewId(null);
    setPreview(null);
  }, []);

  const totalPreviewPages = preview ? Math.max(1, Math.ceil(preview.total_count / preview.limit)) : 1;

  const handleUpload = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const file = selectedFile ?? fileInputRef.current?.files?.[0];
      if (!file) {
        setUploadError("Select a file or drop one here");
        return;
      }
      setUploading(true);
      setUploadError(null);
      try {
        const formData = new FormData();
        formData.set("file", file);
        const res = await fetch("/api/log-files", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Upload failed: ${res.status}`);
        }
        setFilesPage(1);
        await fetchFiles(1);
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [fetchFiles, selectedFile],
  );

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) setSelectedFile(file);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const onFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setSelectedFile(file ?? null);
  }, []);

  const downloadUrl = useCallback((id: string, format: "original" | "cleaned") => {
    return `/api/log-files/${id}/download?format=${format}`;
  }, []);

  const clearFilters = useCallback(() => {
    setSearchQuery("");
    setFromDate("");
    setToDate("");
    setFilesPage(1);
  }, []);

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Data Logs</h1>
        <p className="text-muted-foreground text-sm">
          Upload detail log files, view parsed data, and export original or cleansed CSV files.
        </p>
      </div>

      {/* Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload log file</CardTitle>
          <p className="text-sm text-muted-foreground">
            Log files should be synced automatically to the database at periodic intervals. If not, you can manually upload a log file into the database by using the button below.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpload} className="flex flex-col gap-4">
            <div
              className={cn(
                "rounded-lg border-2 border-dashed p-6 transition-colors flex flex-col items-center justify-center gap-4 min-h-[120px]",
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-muted-foreground/50",
              )}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('button[type="submit"]')) return;
                fileInputRef.current?.click();
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if ((e.target as HTMLElement).closest('button[type="submit"]')) return;
                  fileInputRef.current?.click();
                }
              }}
              aria-label="Drop file here or click to select"
            >
              <input
                ref={fileInputRef}
                id="log-file"
                type="file"
                accept=".txt,.csv,text/plain,text/csv"
                disabled={uploading}
                onChange={onFileInputChange}
                className="sr-only"
              />
              {selectedFile ? (
                <p className="text-sm font-medium text-foreground">{selectedFile.name}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Drop file here or Click to Browse
                </p>
              )}
              <Button
                type="submit"
                disabled={uploading || !selectedFile}
                onClick={(e) => e.stopPropagation()}
              >
                {uploading ? "Uploading…" : "Upload File"}
              </Button>
              {selectedFile && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
            {uploadError && (
              <p className="text-sm text-destructive">{uploadError}</p>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Filter bar - same pattern as Batch Management */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border rounded-lg p-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <div className="space-y-2">
            <Label htmlFor="log-search">Search</Label>
            <Input
              id="log-search"
              type="search"
              placeholder="Filename or uploaded by…"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setFilesPage(1);
              }}
              className="w-full"
              autoComplete="off"
              aria-label="Search by filename or uploaded by"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="log-from">From date</Label>
            <Input
              id="log-from"
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setFilesPage(1);
              }}
              className="w-full"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="log-to">To date</Label>
            <Input
              id="log-to"
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setFilesPage(1);
              }}
              className="w-full"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={clearFilters}
            className="w-full md:w-auto"
          >
            Clear filters
          </Button>
        </div>
      </div>

      {/* File list */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {error && (
          <div className="p-4 bg-destructive/10 text-destructive text-sm border-b">
            {error}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left font-medium p-3">Filename</th>
                <th className="text-left font-medium p-3">Total Reads</th>
                <th className="text-left font-medium p-3">Bad Reads</th>
                <th className="text-left font-medium p-3">Sequence Reads</th>
                <th className="text-left font-medium p-3">Duplicates</th>
                <th className="text-left font-medium p-3">Uploaded By</th>
                <th className="text-left font-medium p-3">Uploaded Date</th>
                <th className="text-left font-medium p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : files.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    {filesPage === 1
                      ? "No log files match the current filters."
                      : "No more log files on this page."}
                  </td>
                </tr>
              ) : (
                files.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b last:border-b-0 even:bg-muted/25 hover:bg-muted/40 transition-colors"
                  >
                    <td className="p-3 font-mono text-xs max-w-[180px] truncate" title={row.filename}>
                      <a
                        href={downloadUrl(row.id, "original")}
                        download
                        className="text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300 truncate block cursor-pointer"
                      >
                        {row.filename}
                      </a>
                    </td>
                    <td className="p-3">{row.total_reads.toLocaleString()}</td>
                    <td className="p-3">
                      <span className={row.bad_reads > 0 ? "text-destructive font-medium" : ""}>
                        {row.bad_reads.toLocaleString()}
                      </span>
                    </td>
                    <td className="p-3">{row.sequence_reads.toLocaleString()}</td>
                    <td className="p-3">
                      <span className={row.duplicate_count > 0 ? "text-destructive font-medium" : ""}>
                        {row.duplicate_count.toLocaleString()}
                      </span>
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {row.uploaded_by ?? "—"}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {formatDate(row.upload_timestamp)}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openPreview(row.id)}
                        >
                          Preview
                        </Button>
                        <a
                          href={downloadUrl(row.id, "cleaned")}
                          download
                          className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-green-600 text-white h-8 px-3 hover:bg-green-700 border-0"
                        >
                          Export
                        </a>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-3 border-t bg-muted/30 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div>
            {loading
              ? "Loading…"
              : `${files.length} file${files.length === 1 ? "" : "s"} on page ${filesPage}`}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Page {filesPage}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || filesPage <= 1}
              onClick={() => setFilesPage((page) => Math.max(1, page - 1))}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || !filesHasMore}
              onClick={() => setFilesPage((page) => page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      {/* Preview modal */}
      {previewId != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={(e) => e.target === e.currentTarget && closePreview()}
          onKeyDown={(e) => e.key === "Escape" && closePreview()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="preview-title"
        >
          <Card
            className="w-full max-w-4xl max-h-[85vh] flex flex-col shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2 shrink-0">
              <div className="flex flex-col gap-1 min-w-0 flex-1 pr-4">
                <CardTitle id="preview-title" className="truncate">
                  {preview ? preview.file.filename : "Loading…"}
                </CardTitle>
                {preview && (
                  <div className="text-sm text-muted-foreground flex flex-col gap-0.5">
                    <span>Uploaded by: {preview.file.uploaded_by ?? "—"}</span>
                    <span>Total reads: {preview.file.total_reads.toLocaleString()}</span>
                    <span>Bad reads: {preview.file.bad_reads.toLocaleString()}</span>
                    <span>Sequence errors: {preview.file.sequence_reads.toLocaleString()}</span>
                    <span>Duplicates: {preview.file.duplicate_count.toLocaleString()}</span>
                  </div>
                )}
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={closePreview} className="shrink-0 -mt-1 -mr-1">
                Close
              </Button>
            </CardHeader>
            <CardContent className="overflow-auto shrink min-h-0 flex flex-col gap-4">
              {preview && (
                <div className="flex flex-wrap items-center justify-between gap-4 shrink-0">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="preview-page-size" className="text-sm text-muted-foreground">
                        Records per page:
                      </Label>
                      <select
                        id="preview-page-size"
                        value={previewLimit}
                        onChange={(e) => {
                          setPreviewLimit(Number(e.target.value) as (typeof PAGE_SIZE_OPTIONS)[number]);
                          setPreviewPage(1);
                        }}
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                      >
                        {PAGE_SIZE_OPTIONS.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor="preview-duplicate-filter" className="text-sm text-muted-foreground">
                        Duplicate:
                      </Label>
                      <select
                        id="preview-duplicate-filter"
                        value={previewDuplicateFilter}
                        onChange={(e) => {
                          setPreviewDuplicateFilter(
                            e.target.value as "all" | "duplicates" | "non_duplicates"
                          );
                          setPreviewPage(1);
                        }}
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                      >
                        <option value="all">All</option>
                        <option value="duplicates">Duplicates only</option>
                        <option value="non_duplicates">Non-duplicates only</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      Page {preview.page} of {totalPreviewPages}
                      {preview.total_count > 0 && (
                        <> ({preview.total_count.toLocaleString()} total)</>
                      )}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={preview.page <= 1 || previewLoading}
                      onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={preview.page >= totalPreviewPages || previewLoading}
                      onClick={() => setPreviewPage((p) => Math.min(totalPreviewPages, p + 1))}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
              {previewLoading ? (
                <p className="text-muted-foreground text-sm py-8 text-center">
                  Loading…
                </p>
              ) : preview && preview.records.length > 0 ? (
                <div className="overflow-auto max-h-[70vh] border rounded-md">
                  <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
                      <tr className="border-b">
                        <th className="text-left font-medium p-2">#</th>
                        <th className="text-left font-medium p-2">Log File Header</th>
                        <th className="text-left font-medium p-2">Job Name</th>
                        <th className="text-left font-medium p-2">Job Number</th>
                        <th className="text-left font-medium p-2">Operator</th>
                        <th className="text-left font-medium p-2">Job Start Timestamp</th>
                        <th className="text-left font-medium p-2">Job End Timestamp</th>
                        <th className="text-left font-medium p-2">Data</th>
                        <th className="text-left font-medium p-2">Timestamp</th>
                        <th className="text-left font-medium p-2">Duplicate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.records.map((r, i) => (
                        <tr key={i} className="border-b last:border-b-0 even:bg-muted/25 hover:bg-muted/40 transition-colors">
                          <td className="p-2 text-muted-foreground">{r.sort_order + 1}</td>
                          <td className="p-2 text-muted-foreground">{r.log_file_header ?? "—"}</td>
                          <td className="p-2 text-muted-foreground">{r.job_name ?? "—"}</td>
                          <td className="p-2 text-muted-foreground">{r.job_number ?? "—"}</td>
                          <td className="p-2 text-muted-foreground">{r.operator ?? "—"}</td>
                          <td className="p-2 text-muted-foreground">{formatDate(r.job_start_timestamp)}</td>
                          <td className="p-2 text-muted-foreground">{formatDate(r.job_end_timestamp)}</td>
                          <td className="p-2 font-mono text-xs">{r.data_value}</td>
                          <td className="p-2 text-muted-foreground">{formatDate(r.data_timestamp)}</td>
                          <td className="p-2">
                            {r.is_duplicate === true ? (
                              <span className="inline-flex items-center rounded-md bg-destructive/20 px-2 py-0.5 text-xs font-medium text-destructive ring-1 ring-inset ring-destructive/30">
                                Duplicate
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : preview ? (
                <p className="text-muted-foreground text-sm py-8 text-center">
                  No records in this file.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
