import { createAdminClient } from "@/lib/supabase/admin";
import {
  isBadReadRecord,
  parseDetailLog,
  parseLogTimestampToISO,
} from "@/lib/log-parser";

const LOG_ENTRY_INSERT_CHUNK_SIZE = 1000;
const MAX_INGEST_BYTES = 10 * 1024 * 1024;
const MAX_INGEST_RECORDS = 100_000_000;

export class IngestValidationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "IngestValidationError";
    this.status = status;
  }
}

type IngestLogFileInput = {
  filename: string;
  rawText: string;
  uploadedBy?: string | null;
};

type IngestLogFileResult = {
  id: string;
  filename: string;
  total_reads: number;
  bad_reads: number;
  sequence_reads: number;
  uploaded_by: string | null;
  upload_timestamp: string;
};

function validateIngestPayload(filename: string, rawText: string) {
  if (!filename.trim()) {
    throw new IngestValidationError("Filename is required");
  }

  const byteLength = Buffer.byteLength(rawText, "utf8");
  if (byteLength === 0) {
    throw new IngestValidationError("Log file is empty");
  }

  if (byteLength > MAX_INGEST_BYTES) {
    throw new IngestValidationError(
      `Log file exceeds the ${Math.floor(MAX_INGEST_BYTES / (1024 * 1024))} MB upload limit`,
      413,
    );
  }
}

async function insertLogEntriesInChunks(
  logFileId: string,
  rows: Array<{
    log_file_header: string | null;
    job_name: string | null;
    job_number: string | null;
    operator: string | null;
    job_start_timestamp: string | null;
    job_end_timestamp: string | null;
    data_value: string;
    data_timestamp: string;
    sort_order: number;
  }>,
) {
  const admin = createAdminClient();

  for (let start = 0; start < rows.length; start += LOG_ENTRY_INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(start, start + LOG_ENTRY_INSERT_CHUNK_SIZE).map((row) => ({
      log_file_id: logFileId,
      ...row,
    }));
    const { error } = await admin.from("log_entries").insert(chunk);
    if (error) {
      throw new Error(error.message ?? "Failed to save log entries");
    }
  }
}

export async function ingestLogFile({
  filename,
  rawText,
  uploadedBy = null,
}: IngestLogFileInput): Promise<IngestLogFileResult> {
  validateIngestPayload(filename, rawText);

  const parsed = parseDetailLog(rawText);
  if (parsed.records.length > MAX_INGEST_RECORDS) {
    throw new IngestValidationError(
      `Log file contains too many records (${parsed.records.length.toLocaleString()}). Limit is ${MAX_INGEST_RECORDS.toLocaleString()}.`,
      413,
    );
  }

  const badReads = parsed.records.filter(isBadReadRecord).length;
  const admin = createAdminClient();

  const { data: logFile, error: insertFileError } = await admin
    .from("log_files")
    .insert({
      filename,
      raw_content: rawText,
      total_reads: 0,
      bad_reads: 0,
      sequence_reads: 0,
      uploaded_by: uploadedBy,
    })
    .select("id, upload_timestamp")
    .single();

  if (insertFileError || !logFile) {
    throw new Error(insertFileError?.message ?? "Failed to create log file");
  }

  try {
    const { error: updateError } = await admin
      .from("log_files")
      .update({
        total_reads: parsed.records.length,
        bad_reads: badReads,
        sequence_reads: parsed.sequenceReadsFromFile,
        uploaded_by: uploadedBy,
      })
      .eq("id", logFile.id);

    if (updateError) {
      throw new Error(updateError.message ?? "Failed to update log file metadata");
    }

    if (parsed.records.length > 0) {
      const fallbackTimestamp = new Date().toISOString();
      const rows = parsed.records.map((record, index) => ({
        log_file_header: record.logFileHeader ?? null,
        job_name: record.jobName || null,
        job_number: record.jobNumber || null,
        operator: record.operator || null,
        job_start_timestamp: parseLogTimestampToISO(record.jobStart),
        job_end_timestamp: parseLogTimestampToISO(record.jobEnd),
        data_value: record.dataValue,
        data_timestamp:
          parseLogTimestampToISO(record.dateTimestamp) ?? fallbackTimestamp,
        sort_order: index,
      }));

      await insertLogEntriesInChunks(logFile.id, rows);

      const { error: finalizeError } = await admin.rpc("finalize_log_file_ingest", {
        p_log_file_id: logFile.id,
      });
      if (finalizeError) {
        throw new Error(finalizeError.message ?? "Failed to finalize log file ingest");
      }
    }
  } catch (error) {
    await admin.from("log_files").delete().eq("id", logFile.id);
    throw error;
  }

  return {
    id: logFile.id,
    filename,
    total_reads: parsed.records.length,
    bad_reads: badReads,
    sequence_reads: parsed.sequenceReadsFromFile,
    uploaded_by: uploadedBy,
    upload_timestamp: logFile.upload_timestamp,
  };
}
