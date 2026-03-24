import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);

/** logs 工具的 OpenAI function calling 定义 */
export const logsDef = {
  type: "function" as const,
  function: {
    name: "logs",
    description:
      "Read the last N lines of a log file. Useful for diagnosing service errors. Provide absolute path like /var/log/nginx/error.log.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the log file",
        },
        lines: {
          type: "number",
          description: "Number of lines to read from the end (default: 50)",
        },
      },
      required: ["path"],
    },
  },
};

/**
 * 读取日志文件末尾 N 行
 * @param args.path  日志文件绝对路径
 * @param args.lines 读取行数，默认 50
 */
export async function logsRun(args: {
  path: string;
  lines?: number;
}): Promise<string> {
  const { lines = 50 } = args;
  const logPath = args.path;

  // 只允许绝对路径，防止路径穿越
  if (!path.isAbsolute(logPath)) {
    return "ERROR: 只允许使用绝对路径，例如 /var/log/nginx/error.log";
  }

  // 规范化路径以消除 ../
  const normalized = path.normalize(logPath);

  // 行数限制，防止读取过大文件
  const n = Math.min(Math.max(1, lines), 1000);

  try {
    const { stdout } = await execAsync(
      `tail -n ${n} "${normalized.replace(/"/g, '\\"')}"`,
      { timeout: 5_000 }
    );
    return stdout || "(empty log)";
  } catch (err: any) {
    return `ERROR reading ${normalized}: ${err.message}`;
  }
}
