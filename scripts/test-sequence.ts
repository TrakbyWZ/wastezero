/**
 * Standalone test script for SequenceLib (lib/sequence.ts).
 * Run with: npx tsx scripts/test-sequence.ts
 * No test framework required; exits with code 0 on success, 1 on failure.
 */

import { generateSequence } from "../lib/sequence";

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

console.log("\nAll SequenceLib tests passed.");
