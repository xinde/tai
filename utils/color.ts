/**
 * 终端颜色工具
 * 零依赖，直接使用 ANSI escape codes
 */

const isColorSupported = process.stdout.isTTY && !process.env.NO_COLOR;

function wrap(code: string, text: string): string {
  return isColorSupported ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export const color = {
  red: (text: string) => wrap("31", text),
  green: (text: string) => wrap("32", text),
  yellow: (text: string) => wrap("33", text),
  blue: (text: string) => wrap("34", text),
  cyan: (text: string) => wrap("36", text),
  gray: (text: string) => wrap("90", text),
  bold: (text: string) => wrap("1", text),
  dim: (text: string) => wrap("2", text),
};
