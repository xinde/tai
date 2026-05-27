import { Agent } from "../agent/agent";
import { defaultConfig, initConfig } from "../config/model";

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

interface ParsedArgs {
  task: string;
  init: boolean;
  model?: string;
  auto: boolean;
  debug: boolean;
  json: boolean;
  shhh: boolean;
}

// ─── 参数解析 ─────────────────────────────────────────────────────────────────

/**
 * 解析 CLI 参数
 * 支持: --model <name>  --auto  --debug  --json
 * 其余非 flag 参数拼接为任务描述
 */
function parseArgs(argv: string[]): ParsedArgs {
  const opts: ParsedArgs = { task: "", init: false, auto: false, debug: false, json: false, shhh: false };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--auto") {
      opts.auto = true;
    } else if (arg === "--debug") {
      opts.debug = true;
    } else if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--model") {
      opts.model = argv[++i];
    } else if (arg === "--shhh") {
      opts.shhh = true;
    } else if (arg === "init") {
      opts.init = true;
    } else if (arg === "help" || arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith("--")) {
      positional.push(arg);
    }
  }

  opts.task = positional.join(" ");
  return opts;
}

// ─── 帮助信息 ─────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
AI 运维助手 —— AI SRE CLI          v2.0

用法:
  ai <任务描述>              用自然语言描述一个运维任务
  ai doctor                  运行完整系统健康检查并由 AI 分析
  ai "fix nginx"             自动诊断并修复服务
  ai init                    初始化配置文件（写入 ~/.ai-tui/config.json）

选项:
  --model <name>             指定 LLM 模型（默认: glm-5）
  --auto                     自动执行危险命令，无需逐条确认
  --debug                    打印工具调用详情和 token 用量
  --json                     以 JSON 格式输出最终结果
  --shhh                     静默模式，仅输出工具名称、参数和最终结果

配置（优先级：环境变量 > ~/.ai-tui/config.json > 内置默认值）:
  LLM_API_URL                API 地址
  LLM_API_KEY                API 密钥
  LLM_MODEL                  模型名称

示例:
  ai init                     # 生成配置文件后手动编辑
  ai "install nginx"
  ai "check disk usage"
  ai doctor --json
  ai "fix nginx" --debug
`);
}

// ─── 主函数 ───────────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.init) {
    initConfig();
    return;
  }

  if (!parsed.task) {
    printHelp();
    return;
  }

  if (!parsed.json && !parsed.shhh) {
    const model = parsed.model ?? defaultConfig.model;
    console.log(`\n🤖 AI 运维助手  [模型: ${model}]\n`);
    console.log(`任务: ${parsed.task}\n`);
    console.log("─".repeat(50));
  }

  const agent = new Agent(defaultConfig, {
    model: parsed.model,
    auto: parsed.auto,
    debug: parsed.debug,
    json: parsed.json,
    shhh: parsed.shhh,
  });

  try {
    await agent.run(parsed.task);
  } catch (err: any) {
    if (parsed.json) {
      console.log(JSON.stringify({ error: err.message }));
    } else {
      console.error(`\n❌ 错误: ${err.message}`);
    }
    process.exit(1);
  }
}
