# AI 运维助手

> 用自然语言驱动的 AI SRE CLI 工具。一条命令，完成诊断、修复、验证。

```
ai fix nginx
ai doctor
ai "check disk usage" --debug
```

---

## 目录

- [项目目标](#项目目标)
- [架构设计](#架构设计)
- [项目结构](#项目结构)
- [核心模块说明](#核心模块说明)
- [安全设计](#安全设计)
- [工具清单](#工具清单)
- [使用方法](#使用方法)
- [配置](#配置)
- [编译为单文件](#编译为单文件)
- [需求对照](#需求对照)

---

## 项目目标

开发一个 AI 运维 CLI 工具，目标体验：

```
ssh server
ai fix nginx
# 几秒内：诊断 → 修复 → 验证
```

AI 能够：

1. 理解自然语言任务描述
2. 自主选择工具（shell / doctor / logs / docker / filesystem）
3. 多步执行：读日志 → 分析 → 生成修复命令 → 执行 → 验证结果
4. 对危险命令进行拦截或要求确认

---

## 架构设计

```
用户输入 (自然语言)
     ↓
  CLI 解析 (cli/index.ts)
     ↓
  Agent 主循环 (agent/agent.ts)
     ↓          ↑
  LLM 推理     工具执行结果反馈
  (OpenAI      (tool role messages)
  function
  calling)
     ↓
  工具路由 & 执行 (tools/)
  ┌──────────────────────────────┐
  │ shell │ doctor │ logs │ ... │
  └──────────────────────────────┘
     ↓
  安全守卫 (guard/safety.ts)
  ┌──────────────────────────────┐
  │ BLOCKED (直接拒绝)           │
  │ DANGEROUS (用户确认)         │
  └──────────────────────────────┘
     ↓
  系统执行
```

**Agent Loop 原理**

Agent 循环基于 OpenAI function calling 标准格式，不依赖任何外部 Agent 框架，完整实现在 `agent/agent.ts`：

1. 用户请求封装为 `user` 消息加入对话历史
2. 调用 LLM，附带所有工具的 JSON Schema 定义
3. LLM 返回 `tool_calls`，Agent 逐一执行
4. 将每个工具的输出以 `tool` role 消息追加到对话历史
5. 再次调用 LLM，直到 LLM 不再调用工具（输出最终结论）
6. 最多循环 12 步，防止无限调用

---

## 项目结构

```
aiTui/
├── ai.ts                  # 入口文件（3 行，委托给 cli/index.ts）
│
├── cli/
│   └── index.ts           # 参数解析、帮助信息、main()
│
├── agent/
│   └── agent.ts           # Agent 主循环：LLM 调用 + 工具路由 + 对话管理
│
├── tools/
│   ├── shell.ts           # 执行 shell 命令（含双层安全检查）
│   ├── doctor.ts          # 系统健康检查（并发收集 CPU/内存/磁盘/Docker）
│   ├── logs.ts            # 读取日志文件末尾 N 行
│   ├── docker.ts          # Docker 容器管理（list/logs/restart/stop/start）
│   └── fs.ts              # 只读文件系统操作（ls/cat/du）
│
├── guard/
│   └── safety.ts          # 命令安全守卫（BLOCKED + DANGEROUS 两级规则）
│
├── utils/
│   └── prompt.ts          # 终端确认对话框（y/n）
│
├── config/
│   └── model.ts           # API 地址、Key、模型名称等配置
│
└── package.json
```

---

## 核心模块说明

### `agent/agent.ts` — Agent 运行时

Agent 是整个系统的核心，负责：

- 维护对话历史（`Message[]`）
- 向 LLM 传递工具定义（5 个工具的 JSON Schema）
- 解析 LLM 返回的 `tool_calls`，路由到对应工具函数
- 将工具输出追加到对话历史，驱动下一轮推理
- `--debug` 模式下打印 token 用量和工具调用详情

### `cli/index.ts` — CLI 解析

解析命令行参数，支持：

| 参数 | 说明 |
|------|------|
| `--model <name>` | 覆盖默认模型 |
| `--auto` | 自动执行危险命令，跳过确认 |
| `--debug` | 打印 LLM token 用量和工具调用 |
| `--json` | 以 JSON 格式输出最终结果 |
| `--shhh` | 静默模式，仅输出工具名称、参数和最终结果 |

### `guard/safety.ts` — 安全守卫

两级防护，不可绕过：

**第一级 BLOCKED（直接拒绝）：**
- `rm -rf /`
- `mkfs`（格式化文件系统）
- `shutdown` / `reboot`
- Fork Bomb `:(){ :|:& };:`
- 覆写磁盘设备 `dd of=/dev/...`

**第二级 DANGEROUS（需用户确认）：**
- `rm -r`（递归删除）
- `apt/yum/dnf remove`（卸载软件包）
- `docker rm` / `docker rmi`
- `kill -9` / `pkill`
- `systemctl stop/disable`

**自定义规则：**

以上为内置规则，用户可在 `~/.ai-tui/config.json` 中通过 `blockedPatterns` / `dangerousPatterns` 追加自定义正则，详见 [配置](#配置) 章节。

---

## 工具清单

### `shell` — 执行 shell 命令

```ts
shell({ cmd: "df -h" })
```

执行任意 shell 命令，经安全守卫过滤后执行，返回 stdout/stderr。

### `doctor` — 系统健康检查

```ts
doctor()
```

并发执行 `uptime`、`df -h`、`free -m`、`ps aux`、`docker ps`，收集系统指标，返回格式化报告供 LLM 分析。

### `logs` — 读取日志

```ts
logs({ path: "/var/log/nginx/error.log", lines: 100 })
```

读取日志文件末尾 N 行（默认 50，最多 1000），只允许绝对路径。

### `docker` — 容器管理

```ts
docker({ action: "restart", container: "nginx" })
```

支持操作：`list` / `logs` / `restart` / `stop` / `start`。

### `filesystem` — 文件系统查看

```ts
filesystem({ action: "ls", path: "/etc/nginx" })
```

只读操作，支持 `ls` / `cat` / `du`。

---

## 使用方法

**直接运行（开发模式）：**

```bash
bun ai.ts "install nginx"
bun ai.ts "fix nginx"
bun ai.ts doctor
bun ai.ts "check disk usage"
bun ai.ts "show last 100 lines of /var/log/syslog"
bun ai.ts "restart the nginx container" --auto
bun ai.ts doctor --json
bun ai.ts "fix nginx" --debug
bun ai.ts "check disk" --model DeepSeek-V3.1
```

**运行示例（`ai fix nginx` 完整流程）：**

```
🤖 AI 运维助手  [模型: qwen2.5-coder]

任务: fix nginx

──────────────────────────────────────────────────

💭 Let me first read the nginx error log to diagnose the issue.

┌─ 工具: logs
...bind() to 0.0.0.0:80 failed (98: Address already in use)
└─────

💭 Port 80 is occupied. I'll stop apache2 and restart nginx.

┌─ 工具: shell
(apache2 stopped)
└─────

┌─ 工具: shell
(nginx restarted successfully)
└─────

Nginx is now running. Port 80 conflict resolved by stopping apache2.
```

---

## 配置

配置加载顺序（优先级从高到低）：**环境变量 > `~/.ai-tui/config.json` > 内置默认值**

**方式一：配置文件（推荐）**

```bash
# 初始化配置文件
ai init
```

配置文件位于 `~/.ai-tui/config.json`（Linux/macOS）或 `C:\Users\<用户名>\.ai-tui\config.json`（Windows），内容如下：

```json
{
  "apiUrl": "http://localhost:9527/v1/chat/completions",
  "apiKey": "",
  "model": "glm-5",
  "maxSteps": 12,
  "temperature": 0.3,
  "blockedPatterns": [],
  "dangerousPatterns": []
}
```

**自定义安全规则**

可通过 `blockedPatterns` 和 `dangerousPatterns` 追加自定义正则表达式，与内置规则合并生效：

```json
{
  "blockedPatterns": ["\\bformat\\b", "\\bdrop\\s+database\\b"],
  "dangerousPatterns": ["\\bnginx\\b.*stop", "\\biptables\\b"]
}
```

- `blockedPatterns` — 绝对禁止执行，无法绕过
- `dangerousPatterns` — 需用户手动确认后执行（`--auto` 可跳过确认）
- 值为正则表达式字符串数组，注意 JSON 中反斜杠需要转义（`\b` → `\\b`）
- 内置规则始终保留，自定义规则在内置规则基础上追加

---

## 编译为单文件

编译后可直接分发到服务器执行：

```bash
bun run build:all               # 全平台编译（macOS/Linux/Windows）
bun run build:mac-arm           # macOS ARM64
bun run build:mac-x64           # macOS x64
bun run build:linux-x64         # Linux x64
bun run build:linux-arm         # Linux ARM64
bun run build:win-x64           # Windows x64
```

产出位于 `./dist/` 目录。

**全局可用**

方式一：软链接（推荐，编译后自动生效）

```bash
# macOS/Linux
sudo ln -sf /path/to/aiTui/dist/ai-macos-arm64 /usr/local/bin/ai

# Windows (以管理员运行 PowerShell)
New-Item -ItemType SymbolicLink -Path "C:\Program Files\ai.exe" -Target "C:\path\to\aiTui\dist\ai-win-x64.exe"
```

方式二：加入 PATH

```bash
# macOS/Linux
echo 'export PATH="/path/to/aiTui/dist:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

验证是否生效：

```bash
which ai
ai --help
```

**在目标服务器上直接运行：**

```bash
./ai "fix nginx"
./ai doctor
```

---

## 需求对照

| 需求文档章节 | 实现位置 | 状态 |
|---|---|---|
| CLI 命令格式 `ai <task>` | `cli/index.ts` | ✅ |
| `--model / --debug / --auto / --json / --shhh` | `cli/index.ts` | ✅ |
| Agent Loop | `agent/agent.ts` | ✅ |
| System Prompt（SRE 角色）| `agent/agent.ts` | ✅ |
| Tool: shell | `tools/shell.ts` | ✅ |
| Tool: doctor | `tools/doctor.ts` | ✅ |
| Tool: logs | `tools/logs.ts` | ✅ |
| Tool: docker | `tools/docker.ts` | ✅ |
| Tool: filesystem | `tools/fs.ts` | ✅ |
| Command Guard（BLOCKED） | `guard/safety.ts` | ✅ |
| Confirmation（DANGEROUS） | `guard/safety.ts` + `utils/prompt.ts` | ✅ |
| `ai doctor` 诊断分析 | `tools/doctor.ts` + Agent | ✅ |
| 自动修复能力（fix 流程） | Agent 多步推理 | ✅ |
| JSON 输出模式 | `cli/index.ts` + `agent/agent.ts` | ✅ |
| Debug 模式 | `agent/agent.ts` | ✅ |
| `bun build --compile` 单文件 | `package.json` scripts | ✅ |
| Memory（历史 / 会话） | — | ⬜ v2 |
| k8s / ssh / ansible / grafana 工具 | — | ⬜ v2 |

---

## 技术选型说明

- **运行时：Bun** — 原生 TypeScript 支持，启动速度快，适合 CLI 场景
- **零外部依赖** — 仅使用 Node.js 内置模块（`child_process`、`readline`、`util`），便于在服务器上部署和分发
- **OpenAI function calling** — 工具调用使用标准格式，兼容任何 OpenAI 兼容 API（Ollama、本地模型等）
- **多步 Agent（最多 12 步）** — 支持复杂任务如"诊断 → 修复 → 验证"全流程自动化
