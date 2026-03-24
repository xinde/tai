import { exec } from "child_process";
import { promisify } from "util";
import { isBlocked, isDangerous } from "../guard/safety";
import { confirm } from "../utils/prompt";

const execAsync = promisify(exec);

/** shell 工具的 OpenAI function calling 定义 */
export const shellDef = {
  type: "function" as const,
  function: {
    name: "shell",
    description:
      "Execute a shell command on the system. Use for running system commands, installing packages, managing services, checking status, etc.",
    parameters: {
      type: "object",
      properties: {
        cmd: {
          type: "string",
          description: "The shell command to execute",
        },
      },
      required: ["cmd"],
    },
  },
};

/**
 * 执行 shell 命令
 * @param args.cmd   要执行的命令
 * @param opts.auto  自动模式，无需确认危险命令
 * @param opts.debug 调试模式，打印额外日志
 */
export async function shellRun(
  args: { cmd: string },
  opts: { auto: boolean; debug: boolean }
): Promise<string> {
  const { cmd } = args;

  if (opts.debug) {
    process.stderr.write(`[shell] cmd: ${cmd}\n`);
  }

  // 第一级防护：绝对禁止的命令
  if (isBlocked(cmd)) {
    return `BLOCKED: 出于安全原因，已拒绝执行此命令: ${cmd}`;
  }

  // 第二级防护：危险命令需要用户确认（auto 模式跳过）
  if (!opts.auto && isDangerous(cmd)) {
    const ok = await confirm(`危险命令: ${cmd}`);
    if (!ok) return "用户已取消执行。";
  }

  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 30_000 });
    return stdout || stderr || "(no output)";
  } catch (err: any) {
    // 命令执行失败，返回错误信息供 AI 分析
    const out = (err.stdout ?? "") + (err.stderr ?? "");
    return `Exit ${err.code ?? 1}:\n${out}`.trim();
  }
}
