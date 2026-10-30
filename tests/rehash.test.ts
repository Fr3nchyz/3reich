import { describe, expect, it } from "vitest";
// @ts-expect-error The command is a native JavaScript module without declarations.
import { compareHashes as untypedCompare } from "../scripts/rehash.mjs";

type Case = { name: string; value: number; expected: number };
const compareHashes = untypedCompare as (main: Case[], checkout: Case[]) => { lines: string[]; exitCode: number };

// Issue #174: pin the public report and equality exit status, including missing cases.
describe("rehash report", () => {
  const a = { name: "first", value: 12, expected: 12 };
  const b = { name: "second", value: 34, expected: 34 };
  it("prints every equal case and exits zero", () => {
    expect(compareHashes([a, b], [a, b])).toEqual({
      lines: ["first: main=12 checkout=12 same", "second: main=34 checkout=34 same"], exitCode: 0,
    });
  });
  it("keeps the main and checkout columns distinct and exits one for any difference", () => {
    expect(compareHashes([a, b], [a, { ...b, value: 56 }])).toEqual({
      lines: ["first: main=12 checkout=12 same", "second: main=34 checkout=56 different"], exitCode: 1,
    });
  });
  it("reports missing cases on either side", () => {
    expect(compareHashes([a], [b])).toEqual({
      lines: ["first: main=12 checkout=missing different", "second: main=missing checkout=34 different"], exitCode: 1,
    });
  });
  it("detects a deliberately changed expected hash", () => {
    expect(compareHashes([a], [{ ...a, expected: 99 }])).toEqual({
      lines: ["first: main=12 checkout=12 different"], exitCode: 1,
    });
  });
});
