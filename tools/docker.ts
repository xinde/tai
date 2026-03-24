import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/** docker 工具的 OpenAI function calling 定义 */
export const dockerDef = {
  type: "function" as const,
  function: {
    name: "docker",
    description:
      "Manage Docker containers. Supported actions: list (show all containers), logs (view container logs), restart, stop, start.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "logs", "restart", "stop", "start"],
          description: "Docker action to perform",
        },
        container: {
          type: "string",
          description: "Container name or ID (not required for 'list')",
        },
      },
      required: ["action"],
    },
  },
};

/**
 * 执行 Docker 操作
 * @param args.action    操作类型
 * @param args.container 容器名或 ID（list 之外均需提供）
 */
export async function dockerRun(args: {
  action: string;
  container?: string;
}): Promise<string> {
  const { action, container } = args;

  if (action !== "list" && !container) {
    return "ERROR: 除 list 之外的操作都需要提供 container 参数。";
  }

  // 对容器名做基础校验，防止注入
  if (container && !/^[\w.\-/]+$/.test(container)) {
    return "ERROR: 无效的容器名称。";
  }

  const cmds: Record<string, string> = {
    list: "docker ps -a",
    logs: `docker logs --tail 50 "${container}"`,
    restart: `docker restart "${container}"`,
    stop: `docker stop "${container}"`,
    start: `docker start "${container}"`,
  };

  if (!cmds[action]) {
    return `未知操作: ${action}。允许的操作: list, logs, restart, stop, start`;
  }

  try {
    const { stdout, stderr } = await execAsync(cmds[action], {
      timeout: 15_000,
    });
    return stdout || stderr || "(no output)";
  } catch (err: any) {
    return `Docker 错误: ${err.message}`;
  }
}
