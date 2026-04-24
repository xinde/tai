import { defaultConfig, type AgentConfig } from "../config/model";
import { shellDef, shellRun } from "../tools/shell";
import { doctorDef, doctorRun } from "../tools/doctor";
import { logsDef, logsRun } from "../tools/logs";
import { dockerDef, dockerRun } from "../tools/docker";
import { fsDef, fsRun } from "../tools/fs";
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

  constructor(config: AgentConfig, opts: AgentOptions) {
    this.config = config;
    this.opts = opts;
  }

  /** 调用 LLM，发送完整对话历史，返回模型的下一条消息 */
  private async callLLM(messages: Message[]): Promise<Message> {
    const tools = [shellDef, doctorDef, logsDef, dockerDef, fsDef];
    const modelName = this.opts.model ?? this.config.model;

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
      throw new Error(`LLM API 请求失败 (${res.status}): ${body}`);
    }

    const data = (await res.json()) as any;

    if (this.opts.debug) {
      const usage = data.usage ?? {};
      process.stderr.write(
        `[llm] tokens: prompt=${usage.prompt_tokens ?? "?"}  completion=${usage.completion_tokens ?? "?"}\n`
      );
    }

    return data.choices[0].message as Message;
  }

  /** 根据工具名称路由并执行对应工具 */
  private async executeTool(name: string, argsJson: string): Promise<string> {
    let args: any;
    try {
      args = JSON.parse(argsJson);
    } catch {
      return `ERROR: 无法解析工具参数 JSON: ${argsJson}`;
    }

    if (this.opts.debug) {
      process.stderr.write(`[tool] ${name}(${JSON.stringify(args)})\n`);
    }

    switch (name) {
      case "shell":
        return shellRun(args, { auto: this.opts.auto, debug: this.opts.debug });
      case "doctor":
        return doctorRun();
      case "logs":
        return logsRun(args);
      case "docker":
        return dockerRun(args);
      case "filesystem":
        return fsRun(args);
      default:
        return `未知工具: ${name}`;
    }
  }

  /**
   * Agent 主循环
   * 流程：发送用户请求 → LLM 推理 → 调用工具 → 将结果反馈给 LLM → 循环
   * 直到 LLM 不再调用工具（返回最终回答）或达到最大步数
   */
  async run(userInput: string): Promise<void> {
    // 采集当前系统环境信息，注入 system prompt
    const envInfo = await collectEnvInfo();
    const systemPrompt = buildSystemPrompt(envInfo);

    if (this.opts.debug) {
      process.stderr.write(`[env]\n${envInfo}\n\n`);
    }

    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userInput },
    ];

    // 循环：发送 LLM 回复 → 调用工具 → 将结果反馈给 LLM → 循环

    for (let step = 0; step < this.config.maxSteps; step++) {
      const reply = await this.callLLM(messages);
      messages.push(reply);

      // LLM 如果同时返回文本和工具调用，先展示文本（推理过程）
      if (reply.content && !this.opts.json && !this.opts.shhh) {
        // 只在有工具调用时才把内容当作推理过程打印
        if (reply.tool_calls && reply.tool_calls.length > 0) {
          process.stdout.write(`\n💭 ${reply.content}\n`);
        }
      }

      // 没有工具调用 → LLM 返回最终结论
      if (!reply.tool_calls || reply.tool_calls.length === 0) {
        const content = reply.content ?? "(无回复)";
        if (this.opts.json) {
          console.log(JSON.stringify({ result: content }, null, 2));
        } else {
          console.log(`\n${content}\n`);
        }
        if (!this.opts.shhh) {
          console.log(`\n------------`);
          console.log(`\n任务完成，共 ${step + 1} 轮对话。`);
        }
        return;
      }

      if(reply.tool_calls && reply.tool_calls.length > 0 && !this.opts.shhh){
          console.log(`\n第 ${step+1} 轮，${reply.tool_calls.length} 个工具调用，原始调用数据: \n${JSON.stringify(reply.tool_calls, null, 2)}`);
      }

      // 并发执行本轮所有工具调用
      for (const toolCall of reply.tool_calls) {
        const { name, arguments: argsJson } = toolCall.function;

        if (!this.opts.json && !this.opts.shhh) {
          // 解析参数，提取关键信息显示给用户
          let detail = "";
          try {
            const a = JSON.parse(argsJson);
            if (name === "shell")      detail = `$ ${a.cmd}`;
            else if (name === "logs")  detail = `${a.path}  (${a.lines ?? 50} lines)`;
            else if (name === "docker") detail = `${a.action}${a.container ? " " + a.container : ""}`;
            else if (name === "filesystem") detail = `${a.action} ${a.path}`;
          } catch { /* 解析失败则不显示参数 */ }
          console.log(`\n┌─ 工具: ${name}${detail ? `  →  ${detail}` : ""}`);
        } else if (this.opts.shhh) {
          // 静默模式：仅显示工具名称和关键参数
          let detail = "";
          try {
            const a = JSON.parse(argsJson);
            if (name === "shell")      detail = a.cmd;
            else if (name === "logs")  detail = `${a.path} (${a.lines ?? 50} lines)`;
            else if (name === "docker") detail = `${a.action}${a.container ? " " + a.container : ""}`;
            else if (name === "filesystem") detail = `${a.action} ${a.path}`;
          } catch { /* 解析失败则不显示参数 */ }
          console.log(`  [${name}] ${detail}`);
        }

        const output = await this.executeTool(name, argsJson);

        if (!this.opts.json && !this.opts.shhh) {
          // 输出结果，太长时截断显示
          const display =
            output.length > 2000 ? output.slice(0, 2000) + "\n...(已截断)" : output;
          console.log(display);
          console.log("└─────");
        }

        // 将工具执行结果作为 tool 角色消息反馈给 LLM
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: output,
        });
      }
    }

    console.log("\n已达到最大步数上限。");
  }
}
