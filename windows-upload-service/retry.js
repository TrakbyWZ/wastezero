"use strict";

/**
 * Retry helpers for file I/O when the file is locked by another process (e.g. EBUSY on Windows).
 */

const LOCK_ERROR_CODES = new Set(["EBUSY", "EACCES", "EPERM", "EAGAIN"]);

function isRetryableFileError(err) {
  return err && LOCK_ERROR_CODES.has(err.code);
}

/**
 * Block the current thread for ms milliseconds (busy-wait). Used between retries so we don't need async.
 */
function sleepSync(ms) {
  if (ms <= 0) return;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Busy-wait
  }
}

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_RETRY_DELAY_MS = 400;

/**
 * Run a synchronous function, retrying on file-lock style errors at periodic intervals.
 * @param {() => T} fn - Sync function that may throw (e.g. fs.readFileSync).
 * @param {{ maxRetries?: number, retryDelayMs?: number, isRetryable?: (err: Error) => boolean }} options
 * @returns {T} - Return value of fn()
 * @throws - Rethrows the last error if all retries are exhausted or error is not retryable.
 */
function runWithRetry(fn, options = {}) {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const isRetryable = options.isRetryable ?? isRetryableFileError;
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries || !isRetryable(err)) throw err;
      sleepSync(retryDelayMs);
    }
  }
  throw lastErr;
}

module.exports = {
  runWithRetry,
  isRetryableFileError,
  sleepSync,
  DEFAULT_RETRY_DELAY_MS,
  DEFAULT_MAX_RETRIES,
};
