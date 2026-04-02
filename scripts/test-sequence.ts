/**
 * Standalone test script for SequenceLib (lib/sequence.ts).
 * Run with: npx tsx scripts/test-sequence.ts
 * No test framework required; exits with code 0 on success, 1 on failure.
 */

import { generateSequence, interpolateLabelPrefixDateTokens } from "../lib/sequence";

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const ok =
    Array.isArray(expected) && Array.isArray(actual)
      ? actual.length === expected.length && actual.every((v, i) => v === expected[i])
      : actual === expected;
  if (!ok) {
    console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    process.exit(1);
  }
  console.log(`OK   ${label}`);
}

// Basic progression
assertEqual(
  generateSequence(10, 25, 5),
  [10, 15, 20, 25],
  "start=10, end=25, offset=5",
);

// Single value
assertEqual(
  generateSequence(1, 1, 1),
  [1],
  "single value (1..1 step 1)",
);

// Step of 1
assertEqual(
  generateSequence(0, 3, 1),
  [0, 1, 2, 3],
  "start=0, end=3, offset=1",
);

// End not hit exactly (stop when next would exceed)
assertEqual(
  generateSequence(0, 6, 2),
  [0, 2, 4, 6],
  "start=0, end=6, offset=2",
);

assertEqual(
  generateSequence(5, 12, 3),
  [5, 8, 11],
  "start=5, end=12, offset=3 (11 <= 12, 14 > 12)",
);

// Larger numbers
assertEqual(
  generateSequence(100, 105, 2),
  [100, 102, 104],
  "start=100, end=105, offset=2",
);

// Label prefix date tokens (UTC)
const apr2_2026 = new Date(Date.UTC(2026, 3, 2, 12, 0, 0));
assertEqual(
  interpolateLabelPrefixDateTokens("%MMYYDD%-R002C", apr2_2026),
  "042602-R002C",
  "%MMYYDD%-R002C on 2026-04-02 UTC",
);
assertEqual(
  interpolateLabelPrefixDateTokens("%MMYY%-R002C", apr2_2026),
  "0426-R002C",
  "%MMYY%-R002C on 2026-04-02 UTC",
);
assertEqual(
  interpolateLabelPrefixDateTokens("%DDMM%-X", apr2_2026),
  "0204-X",
  "%DDMM% day+month on 2026-04-02 UTC",
);
assertEqual(
  interpolateLabelPrefixDateTokens("%YYYYMMDD%-X", apr2_2026),
  "20260402-X",
  "%YYYYMMDD% composite",
);
assertEqual(
  interpolateLabelPrefixDateTokens("%YYYY%-%MM%-%DD%", apr2_2026),
  "2026-04-02",
  "%YYYY%, %MM%, %DD% separated",
);
assertEqual(
  interpolateLabelPrefixDateTokens("%YY%%MM%%DD%", apr2_2026),
  "260402",
  "%YY%, %MM%, %DD% concatenated",
);
assertEqual(
  interpolateLabelPrefixDateTokens("R002C", apr2_2026),
  "R002C",
  "static prefix unchanged",
);
assertEqual(
  interpolateLabelPrefixDateTokens(null, apr2_2026),
  null,
  "null prefix stays null",
);

console.log("\nAll SequenceLib tests passed.");
