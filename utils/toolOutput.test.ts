import { describe, expect, test } from "bun:test";
import { compactToolOutputForLLM } from "./toolOutput";

describe("compactToolOutputForLLM", () => {
  test("keeps short output unchanged", () => {
    const output = "small command output";
    expect(compactToolOutputForLLM(output, 100)).toBe(output);
  });

  test("compacts long output while preserving head and tail", () => {
    const output = [
      "START important context",
      ...Array.from({ length: 200 }, (_, i) => `middle line ${i}`),
      "END important error",
    ].join("\n");

    const compacted = compactToolOutputForLLM(output, 1_000);

    expect(compacted).toContain("tool output compacted for LLM");
    expect(compacted).toContain("START important context");
    expect(compacted).toContain("END important error");
    expect(compacted.length).toBeLessThan(output.length);
    expect(compacted.length).toBeLessThanOrEqual(1_000);
  });
});
