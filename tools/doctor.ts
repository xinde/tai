import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/** doctor 工具的 OpenAI function calling 定义 */
export const doctorDef = {
  type: "function" as const,
  function: {
    name: "doctor",
    description:
      "Run a complete system health check. Collects CPU load, memory usage, disk usage, top processes, and Docker container status.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

/** 安全执行命令，失败时返回错误提示而不是抛出异常 */
async function safeExec(cmd: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 10_000 });
    return stdout || stderr || "(empty)";
  } catch (err: any) {
    return `(error: ${err.message})`;
  }
}

/**
 * 收集系统诊断信息
 * 并发执行多项检查以提高速度
 */
export async function doctorRun(): Promise<string> {
  const [uptime, disk, memory, processes, docker] = await Promise.all([
    safeExec("uptime"),
    safeExec("df -h"),
    safeExec("free -m"),
    safeExec("ps aux --sort=-%mem | head -15"),
    safeExec("docker ps 2>/dev/null || echo '(docker not available)'"),
  ]);

  return `=== System Diagnostics ===

[Uptime / Load]
${uptime.trim()}

[Disk Usage]
${disk.trim()}

[Memory (MB)]
${memory.trim()}

[Top Processes by Memory]
${processes.trim()}

[Docker Containers]
${docker.trim()}`;
}
