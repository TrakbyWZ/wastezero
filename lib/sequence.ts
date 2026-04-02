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
 * @param offset - Step between consecutive values (must be non-zero)
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
  if (count < 1 || offset === 0) return null;
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
  const whole = Math.floor(num);
  const isNegative = whole < 0;
  const raw = String(Math.abs(whole));
  const targetLen = numberFormat.length;
  if (raw.length >= targetLen) return isNegative ? `-${raw}` : raw;
  const padded = raw.padStart(targetLen, "0");
  return isNegative ? `-${padded}` : padded;
}

/** UTC calendar fields for `at`, from ISO date (`YYYY-MM-DD` is always zero-padded). */
function utcCalendarParts(at: Date): { YYYY: string; MM: string; DD: string; YY: string } {
  const [YYYY, MM, DD] = at.toISOString().slice(0, 10).split("-") as [string, string, string];
  return { YYYY, MM, DD, YY: YYYY.slice(-2) };
}

/**
 * Expands `%...%` date tokens in a label prefix using the UTC calendar date of `at`.
 * Only calendar **month**, **year**, and **day** fields are supported (no time-of-day tokens).
 * Tokens (longest matched first): `%MMYYDD%`, `%YYYYMMDD%`, `%MMYY%`, `%DDMM%`, `%YYYY%`, `%MM%`, `%DD%`, `%YY%`.
 * Examples (2026-04-02 UTC): `%MMYYDD%-R002C` → `042602-R002C`; `%MMYY%-R002C` → `0426-R002C`; `%DDMM%` → `0204`.
 */
export function interpolateLabelPrefixDateTokens(
  labelPrefix: string | null | undefined,
  at: Date,
): string | null {
  if (labelPrefix == null || labelPrefix === "") return labelPrefix ?? null;
  if (!labelPrefix.includes("%")) return labelPrefix;

  const { YYYY, MM, DD, YY } = utcCalendarParts(at);

  const pairs: [string, string][] = [
    ["%MMYYDD%", MM + YY + DD],
    ["%YYYYMMDD%", YYYY + MM + DD],
    ["%MMYY%", MM + YY],
    ["%DDMM%", DD + MM],
    ["%YYYY%", YYYY],
    ["%MM%", MM],
    ["%DD%", DD],
    ["%YY%", YY],
  ];

  let out = labelPrefix;
  for (const [token, value] of pairs) {
    if (out.includes(token)) {
      out = out.split(token).join(value);
    }
  }
  return out;
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
 * the last value that does not exceed (ascending) or drop below (descending) end,
 * stepping by offset.
 *
 * @param startSeq - First value (inclusive)
 * @param endSeq - Upper bound (inclusive); generation stops when next value would be > endSeq
 * @param offsetSeq - Step between consecutive values (must be non-zero)
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
  if (offsetSeq === 0) return [];
  const out: number[] = [];
  let v = startSeq;
  if (offsetSeq > 0) {
    while (v <= endSeq) {
      out.push(v);
      v += offsetSeq;
    }
  } else {
    while (v >= endSeq) {
      out.push(v);
      v += offsetSeq;
    }
  }
  return out;
}
