/**
 * Standalone sequence generation and computation utility. Zero dependencies on API or database.
 * Pure functional module for arithmetic progressions: start, start+offset, start+2*offset, ...
 * All sequence logic (generation, end from count, next start from last end) lives here.
 */

/**
 * Computes the start value for the next batch given the previous batch's end value and the offset.
 * next_start = lastEnd + offset.
 *
 * @example
 * computeStartFromLastEnd(100, 2)  // 102
 */
export function computeStartFromLastEnd(lastEnd: number, offset: number): number {
  return lastEnd + offset;
}

/**
 * Computes the end value of a sequence that starts at `start`, steps by `offset`, and has
 * exactly `count` values: start, start+offset, start+2*offset, ..., start+(count-1)*offset.
 *
 * @param start - First value (inclusive)
 * @param offset - Step between consecutive values (must be positive)
 * @param count - Number of values in the sequence (must be at least 1)
 * @returns end = start + (count - 1) * offset, or null if inputs are invalid
 *
 * @example
 * computeEndFromStartOffsetCount(10, 2, 5)  // 18  → sequence [10, 12, 14, 16, 18]
 */
export function computeEndFromStartOffsetCount(
  start: number,
  offset: number,
  count: number,
): number | null {
  if (count < 1 || offset <= 0) return null;
  return start + (count - 1) * offset;
}

/**
 * Pads a sequence number according to the number format string.
 * The format string length defines the target width; values are zero-padded.
 * E.g. format "0000000" (length 7) → 1 → "0000001", 10 → "0000010".
 * If the number has more digits than the format length, the full number is used (no truncation).
 *
 * @param num - Integer value to pad
 * @param numberFormat - Format string (e.g. "0000000" for 7-digit zero-padding)
 * @returns Padded string (e.g. "0000001")
 */
export function padSequenceNumber(num: number, numberFormat: string): string {
  if (!numberFormat || numberFormat.length === 0) return String(num);
  const raw = String(Math.floor(num));
  const targetLen = numberFormat.length;
  if (raw.length >= targetLen) return raw;
  return raw.padStart(targetLen, "0");
}

/**
 * Formats sequence numbers with an optional label prefix and number format.
 * Each value becomes: labelPrefix + zero-padded number (using numberFormat).
 *
 * @param values - Sequence numbers in order (e.g. from generateSequence)
 * @param labelPrefix - Prefix applied to the front of each value (use "" or null for none)
 * @param numberFormat - Format used to pad numbers (e.g. "0000000"); empty/null = no padding
 * @returns Array of formatted strings (e.g. ["ABC0000001", "ABC0000010"])
 */
export function formatSequenceValues(
  values: number[],
  labelPrefix: string | null,
  numberFormat: string | null,
): string[] {
  const prefix = labelPrefix ?? "";
  const format = numberFormat ?? "";
  return values.map((v) => prefix + padSequenceNumber(v, format));
}

/**
 * Builds a CSV string from a sequence of numbers: one value per line (no header).
 *
 * @param values - Sequence numbers in order (e.g. from generateSequence)
 * @returns CSV string suitable for download (e.g. "1\n2\n3\n4")
 */
export function sequenceToCsv(values: number[]): string {
  const rows = values.map((v) => String(v));
  return rows.join("\n");
}

/**
 * Builds a CSV string from a sequence of numbers with label prefix and number format applied.
 * One formatted value per line, newline-separated (e.g. "ABC0000001\nABC0000010\nABC0000019").
 *
 * @param values - Sequence numbers in order (e.g. from generateSequence)
 * @param labelPrefix - Prefix applied to the front of each value (null/empty = none)
 * @param numberFormat - Format used to pad numbers (e.g. "0000000"); null/empty = no padding
 * @returns CSV string suitable for download
 */
export function formatSequenceToCsv(
  values: number[],
  labelPrefix: string | null,
  numberFormat: string | null,
): string {
  const formatted = formatSequenceValues(values, labelPrefix, numberFormat);
  return formatted.join("\n");
}

/**
 * Generates an arithmetic progression of integers from start up to and including
 * the last value that does not exceed end, stepping by offset.
 *
 * @param startSeq - First value (inclusive)
 * @param endSeq - Upper bound (inclusive); generation stops when next value would be > endSeq
 * @param offsetSeq - Step between consecutive values (must be positive)
 * @returns Array of integers in the sequence
 *
 * @example
 * generateSequence(10, 25, 5)  // [10, 15, 20, 25]
 * generateSequence(10, 18, 2) // [10, 12, 14, 16, 18]
 */
export function generateSequence(
  startSeq: number,
  endSeq: number,
  offsetSeq: number,
): number[] {
  const out: number[] = [];
  let v = startSeq;
  while (v <= endSeq) {
    out.push(v);
    v += offsetSeq;
  }
  return out;
}
