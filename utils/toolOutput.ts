export const DEFAULT_TOOL_OUTPUT_MAX_CHARS = 6_000;

export function compactToolOutputForLLM(
  output: string,
  maxChars = DEFAULT_TOOL_OUTPUT_MAX_CHARS
): string {
  if (output.length <= maxChars) return output;

  const budget = Math.max(500, maxChars);
  const bodyBudget = Math.max(100, budget - 400);
  const headChars = Math.floor(bodyBudget * 0.55);
  const tailChars = bodyBudget - headChars;
  const head = output.slice(0, headChars).trimEnd();
  const tail = output.slice(output.length - tailChars).trimStart();
  const omitted = output.slice(headChars, output.length - tailChars);
  const omittedLines = countLines(omitted);

  const compacted = [
    `[tool output compacted for LLM: original=${output.length} chars, omitted=${omitted.length} chars, omitted_lines=${omittedLines}]`,
    head,
    `\n... omitted ${omitted.length} chars / ${omittedLines} lines ...\n`,
    tail,
  ].join("\n");

  return compacted.length <= budget ? compacted : compacted.slice(0, budget);
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length - 1;
}
