import { exec } from "child_process";
import { promisify } from "util";
import { checkCommand } from "../guard/safety";
import { confirm } from "../utils/prompt";

const execAsync = promisify(exec);

// 资源限额：CPU 60s、最大写入文件 ~1GB、fd 256 —— 限制爆炸半径
const RESOURCE_LIMITS = "ulimit -t 60 -f 2097152 -n 256";

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

  // 安全判定：blocked 直接拒；irreversible 即便 --auto 也要确认；dangerous 仅非 auto 确认
  const verdict = checkCommand(cmd);
  if (verdict.level === "blocked") {
    return `BLOCKED: ${verdict.reason}`;
  }
  const needConfirm =
    verdict.level === "irreversible" ||
    (verdict.level === "dangerous" && !opts.auto);
  if (needConfirm) {
    const ok = await confirm(`[${verdict.level}] ${cmd}`);
    if (!ok) return "用户已取消执行。";
  }

  try {
    const { stdout, stderr } = await execAsync(`${RESOURCE_LIMITS}; ${cmd}`, {
      timeout: 30_000,
    });
    return stdout || stderr || "(no output)";
  } catch (err: any) {
    // 命令执行失败，返回错误信息供 AI 分析
    const out = (err.stdout ?? "") + (err.stderr ?? "");
    return `Exit ${err.code ?? 1}:\n${out}`.trim();
  }
}
