import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);

/** filesystem 工具的 OpenAI function calling 定义 */
export const fsDef = {
  type: "function" as const,
  function: {
    name: "filesystem",
    description:
      "Perform read-only filesystem operations: ls (list directory), cat (read file content), du (disk usage of a path).",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["ls", "cat", "du"],
          description: "Filesystem action",
        },
        path: {
          type: "string",
          description: "Target file or directory path",
        },
      },
      required: ["action", "path"],
    },
  },
};

/**
 * 执行只读文件系统操作
 * @param args.action  操作类型 ls / cat / du
 * @param args.path    目标路径
 */
export async function fsRun(args: {
  action: string;
  path: string;
}): Promise<string> {
  const { action } = args;

  // 只允许绝对路径，防止路径穿越
  if (!path.isAbsolute(args.path)) {
    return "ERROR: 只允许使用绝对路径，例如 /var/log 或 /etc/nginx/nginx.conf";
  }

  // 规范化路径，消除 ../
  const target = path.normalize(args.path);

  // 构建命令映射（路径已转义防止注入）
  const esc = target.replace(/"/g, '\\"');
  const cmds: Record<string, string> = {
    ls: `ls -lh "${esc}"`,
    cat: `cat "${esc}"`,
    du: `du -sh "${esc}"`,
  };

  if (!cmds[action]) {
    return `未知操作: ${action}。允许的操作: ls, cat, du`;
  }

  try {
    const { stdout, stderr } = await execAsync(cmds[action], {
      timeout: 5_000,
    });
    return stdout || stderr || "(no output)";
  } catch (err: any) {
    return `ERROR: ${err.message}`;
  }
}
