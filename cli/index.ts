import { Agent } from "../agent/agent";
import { defaultConfig, initConfig, CONFIG_PATH } from "../config/model";
import { existsSync } from "fs";
import { color } from "../utils/color";

const VERSION = "2.1.0";

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

interface ParsedArgs {
  task: string;
  init: boolean;
  model?: string;
  max?: number;
  auto: boolean;
  debug: boolean;
  json: boolean;
  shhh: boolean;
  version: boolean;
}

// ─── 参数解析 ─────────────────────────────────────────────────────────────────

/**
 * 解析 CLI 参数
 * 支持: --model <name>  --auto  --debug  --json
 * 其余非 flag 参数拼接为任务描述
 */
function parseArgs(argv: string[]): ParsedArgs {
  const opts: ParsedArgs = { task: "", init: false, auto: false, debug: false, json: false, shhh: false, version: false, max: undefined };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--auto":    opts.auto = true; break;
      case "--debug":   opts.debug = true; break;
      case "--json":    opts.json = true; break;
      case "--shhh":    opts.shhh = true; break;
      case "--version":
      case "-v":        opts.version = true; break;
      case "--model":   opts.model = argv[++i]; break;
      case "--max":     opts.max = parseInt(argv[++i], 10); break;
      case "init":      opts.init = true; break;
      case "help":
      case "--help":
      case "-h":        printHelp(); process.exit(0); break;
      default:
        if (!arg.startsWith("--")) positional.push(arg);
        break;
    }
  }

  opts.task = positional.join(" ");
  return opts;
}

// ─── 帮助信息 ─────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
${color.bold("终端 AI 助手")} —— AI CLI          ${color.gray(`v${VERSION}`)}

用法:
  ${color.green("ai <任务描述>")}              用自然语言描述一个任务
  ${color.green("ai doctor")}                  运行完整系统健康检查并由 AI 分析
  ${color.green('ai "fix nginx"')}             自动诊断并修复服务
  ${color.green("ai init")}                    初始化配置文件（写入 ~/.tai/config.json）
  ${color.green("ai help")}                    显示此帮助信息

选项:
  ${color.yellow("--model <name>")}             指定 LLM 模型（默认: ${defaultConfig.model}）
  ${color.yellow("--auto")}                     自动执行危险命令，无需逐条确认
  ${color.yellow("--debug")}                    打印工具调用详情和 token 用量
  ${color.yellow("--json")}                     以 JSON 格式输出最终结果
  ${color.yellow("--shhh")}                     静默模式，仅输出工具名称和最终结果
  ${color.yellow("--max <n>")}                  临时设置最大请求步数（默认: 12）
  ${color.yellow("-v, --version")}              显示版本号
  ${color.yellow("-h, --help")}                 显示帮助信息

配置（优先级：环境变量 > ~/.tai/config.json > 内置默认值）:
  ${color.blue("LLM_API_URL")}                API 地址
  ${color.blue("LLM_API_KEY")}                API 密钥
  ${color.blue("LLM_MODEL")}                  模型名称

示例:
  ${color.gray("ai init")}                     # 生成配置文件后手动编辑
  ${color.gray('ai "install nginx"')}
  ${color.gray('ai "check disk usage"')}
  ${color.gray("ai doctor --json")}
  ${color.gray('ai "fix nginx" --debug --auto')}
`);
}

// ─── 主函数 ───────────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  // 快速退出的子命令
  if (parsed.version) {
    console.log(`ai v${VERSION}`);
    return;
  }

  if (parsed.init) {
    initConfig();
    return;
  }

  if (!parsed.task) {
    printHelp();
    return;
  }

  // 配置校验：检查 API Key 是否已设置
  if (!defaultConfig.apiKey) {
    const hasConfigFile = existsSync(CONFIG_PATH);
    console.error("❌ 错误: 未配置 API Key。");
    if (!hasConfigFile) {
      console.error("   请先运行 `ai init` 生成配置文件，然后填入 API Key。");
    } else {
      console.error(`   请编辑 ${CONFIG_PATH} 填入 apiKey，或设置环境变量 LLM_API_KEY。`);
    }
    process.exit(1);
  }

  if (!parsed.json && !parsed.shhh) {
    const model = parsed.model ?? defaultConfig.model;
    console.log(`\n🤖 ${color.bold("终端 AI 助手")}  [模型: ${color.cyan(model)}]`);
    console.log(`📋 任务: ${color.yellow(parsed.task)}`);
    console.log(color.dim("─".repeat(50)));
  }

  const config = parsed.max ? { ...defaultConfig, maxSteps: parsed.max } : defaultConfig;

  const agent = new Agent(config, {
    model: parsed.model,
    auto: parsed.auto,
    debug: parsed.debug,
    json: parsed.json,
    shhh: parsed.shhh,
  });

  // 优雅中断：Ctrl+C 时通知 Agent 停止
  const sigHandler = () => {
    agent.abort();
    if (!parsed.json) console.log("\n\n⚠ 收到中断信号，正在停止...");
  };
  process.on("SIGINT", sigHandler);

  try {
    await agent.run(parsed.task);
  } catch (err: any) {
    if (parsed.json) {
      console.log(JSON.stringify({ error: err.message }));
    } else {
      console.error(`\n❌ 错误: ${err.message}`);
      if (parsed.debug) console.error(err.stack);
    }
    process.exit(1);
  } finally {
    process.off("SIGINT", sigHandler);
  }
}
