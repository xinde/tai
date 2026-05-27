import { type AgentConfig } from "../config/model";
import { toolRegistry, getAllToolDefs, getToolNames } from "../tools/registry";
import { collectEnvInfo, buildSystemPrompt } from "./prompt";

// ─── 类型定义（OpenAI Chat API 格式）────────────────────────────────────────

type Role = "system" | "user" | "assistant" | "tool";

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface Message {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface AgentOptions {
  model?: string;   // 覆盖默认模型
  auto: boolean;    // 自动执行，不需要用户确认危险命令
  debug: boolean;   // 调试模式，打印 token 用量和工具调用
  json: boolean;    // 以 JSON 格式输出最终结果
  shhh: boolean;    // 静默模式，仅输出工具名称、参数和最终结果
}

// ─── Agent 类 ─────────────────────────────────────────────────────────────────

export class Agent {
  private config: AgentConfig;
  private opts: AgentOptions;
  private aborted = false;

  constructor(config: AgentConfig, opts: AgentOptions) {
    this.config = config;
    this.opts = opts;
  }

  /** 允许外部中止 Agent 循环 */
  abort(): void {
    this.aborted = true;
  }

  /** 调用 LLM，支持自动重试（网络/5xx 错误时） */
  private async callLLM(messages: Message[]): Promise<Message> {
    const tools = getAllToolDefs();
    const modelName = this.opts.model ?? this.config.model;
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(this.config.apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            model: modelName,
            messages,
            tools,
            tool_choice: "auto",
            temperature: this.config.temperature,
            max_tokens: 2048,
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          if (res.status >= 500 && attempt < maxRetries) {
            this.debugLog(`[llm] 服务端错误 ${res.status}，第 ${attempt + 1} 次重试...`);
            await this.sleep(1000 * (attempt + 1));
            continue;
          }
          throw new Error(`LLM API 请求失败 (${res.status}): ${body}`);
        }

        const data = (await res.json()) as any;

        if (this.opts.debug) {
          const usage = data.usage ?? {};
          this.debugLog(
            `[llm] tokens: prompt=${usage.prompt_tokens ?? "?"}  completion=${usage.completion_tokens ?? "?"}`
          );
        }

        return data.choices[0].message as Message;
      } catch (err: any) {
        if (attempt < maxRetries && this.isNetworkError(err)) {
          this.debugLog(`[llm] 网络错误: ${err.message}，第 ${attempt + 1} 次重试...`);
          await this.sleep(1000 * (attempt + 1));
          continue;
        }
        throw err;
      }
    }

    throw new Error("LLM API 请求重试耗尽");
  }

  /** 根据工具名称路由并执行对应工具 */
  private async executeTool(name: string, argsJson: string): Promise<string> {
    let args: any;
    try {
      args = JSON.parse(argsJson);
    } catch {
      return `ERROR: 无法解析工具参数 JSON: ${argsJson}`;
    }

    this.debugLog(`[tool] ${name}(${JSON.stringify(args)})`);

    const entry = toolRegistry[name];
    if (!entry) {
      return `ERROR: 未知工具 "${name}"。可用工具: ${getToolNames().join(", ")}`;
    }

    return entry.run(args, { auto: this.opts.auto, debug: this.opts.debug });
  }

  /** 获取工具调用的可读摘要 */
  private getToolSummary(name: string, argsJson: string): string {
    const entry = toolRegistry[name];
    if (!entry?.summarize) return "";
    try {
      return entry.summarize(JSON.parse(argsJson));
    } catch {
      return "";
    }
  }

  /**
   * Agent 主循环
   * 流程：发送用户请求 → LLM 推理 → 调用工具 → 将结果反馈给 LLM → 循环
   * 直到 LLM 不再调用工具（返回最终回答）或达到最大步数
   */
  async run(userInput: string): Promise<void> {
    const envInfo = await collectEnvInfo();
    const systemPrompt = buildSystemPrompt(envInfo);

    this.debugLog(`[env]\n${envInfo}\n`);

    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userInput },
    ];

    for (let step = 0; step < this.config.maxSteps; step++) {
      if (this.aborted) {
        this.print("\n⚠ 任务已中断。");
        return;
      }

      const reply = await this.callLLM(messages);
      messages.push(reply);

      // LLM 返回推理过程文本（与工具调用同时存在时）
      if (reply.content && reply.tool_calls?.length && !this.opts.json && !this.opts.shhh) {
        process.stdout.write(`\n💭 ${reply.content}\n`);
      }

      // 没有工具调用 → LLM 返回最终结论
      if (!reply.tool_calls || reply.tool_calls.length === 0) {
        this.printFinalResult(reply.content ?? "(无回复)", step + 1);
        return;
      }

      // 显示本轮工具调用概览
      if (!this.opts.json && !this.opts.shhh) {
        console.log(`\n── 第 ${step + 1} 轮 ─ ${reply.tool_calls.length} 个工具调用 ──`);
      }

      // 执行本轮所有工具调用
      for (const toolCall of reply.tool_calls) {
        const { name, arguments: argsJson } = toolCall.function;
        const summary = this.getToolSummary(name, argsJson);

        this.printToolStart(name, summary);

        const output = await this.executeTool(name, argsJson);

        this.printToolResult(output);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: output,
        });
      }
    }

    this.print("\n⚠ 已达到最大步数上限，任务未完成。建议拆分为更小的子任务。");
  }

  // ─── 输出方法 ─────────────────────────────────────────────────────────────

  private printFinalResult(content: string, steps: number): void {
    if (this.opts.json) {
      console.log(JSON.stringify({ result: content }, null, 2));
    } else {
      console.log(`\n${content}\n`);
      if (!this.opts.shhh) {
        console.log("─".repeat(40));
        console.log(`✓ 任务完成，共 ${steps} 轮对话。`);
      }
    }
  }

  private printToolStart(name: string, summary: string): void {
    if (this.opts.json) return;
    if (this.opts.shhh) {
      console.log(`  [${name}] ${summary}`);
    } else {
      console.log(`\n┌─ 工具: ${name}${summary ? `  →  ${summary}` : ""}`);
    }
  }

  private printToolResult(output: string): void {
    if (this.opts.json || this.opts.shhh) return;
    const display = output.length > 2000 ? output.slice(0, 2000) + "\n...(已截断)" : output;
    console.log(display);
    console.log("└─────");
  }

  private print(msg: string): void {
    if (!this.opts.json) console.log(msg);
  }

  private debugLog(msg: string): void {
    if (this.opts.debug) process.stderr.write(msg + "\n");
  }

  // ─── 辅助方法 ─────────────────────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private isNetworkError(err: any): boolean {
    const msg = String(err?.message ?? "").toLowerCase();
    return (
      msg.includes("fetch") ||
      msg.includes("econnrefused") ||
      msg.includes("enotfound") ||
      msg.includes("timeout") ||
      msg.includes("network")
    );
  }
}
