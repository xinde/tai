# 终端 AI 助手

> 用自然语言驱动的终端 AI 助手 CLI 工具。一条命令，完成诊断、修复、验证。

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

开发一个终端 AI 助手 CLI 工具，目标体验：

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
  │ IRREVERSIBLE (始终确认)      │
  │ DANGEROUS (用户确认)         │
  └──────────────────────────────┘
     ↓
  系统执行
     ↓
  工具输出压缩 (utils/toolOutput.ts)
     ↓
  精简后的 tool message 回传给 LLM
```

**Agent Loop 原理**

Agent 循环基于 OpenAI function calling 标准格式，不依赖任何外部 Agent 框架，完整实现在 `agent/agent.ts`：

1. 用户请求封装为 `user` 消息加入对话历史
2. 调用 LLM，附带所有工具的 JSON Schema 定义
3. LLM 返回 `tool_calls`，Agent 逐一执行
4. 用户可见输出保持完整展示，回传给 LLM 的工具输出先做长度压缩
5. 再次调用 LLM，直到 LLM 不再调用工具（输出最终结论）
6. 最多循环 12 步，防止无限调用

---

## 项目结构

```
TAI/
├── ai.ts                  # 入口文件（3 行，委托给 cli/index.ts）
│
├── cli/
│   └── index.ts           # 参数解析、帮助信息、main()
│
├── agent/
│   └── agent.ts           # Agent 主循环：LLM 调用 + 工具路由 + 对话管理
│
├── tools/
│   ├── shell.ts           # 执行 shell 命令（含三级安全检查）
│   ├── doctor.ts          # 系统健康检查（并发收集 CPU/内存/磁盘/Docker）
│   ├── logs.ts            # 读取日志文件末尾 N 行
│   ├── docker.ts          # Docker 容器管理（list/logs/restart/stop/start）
│   └── fs.ts              # 只读文件系统操作（ls/cat/du）
│
├── guard/
│   └── safety.ts          # 命令安全守卫（BLOCKED / IRREVERSIBLE / DANGEROUS）
│
├── utils/
│   ├── prompt.ts          # 终端确认对话框（y/n）
│   ├── spinner.ts         # 终端等待动画
│   ├── color.ts           # 终端颜色输出
│   └── toolOutput.ts      # 工具输出压缩，控制 LLM 上下文体积
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
- 将压缩后的工具输出追加到对话历史，驱动下一轮推理
- `--debug` 模式下打印 token 用量和工具调用详情

### `utils/toolOutput.ts` — 工具输出压缩

工具原始输出会完整用于终端展示，但不会原样全部塞回 LLM 上下文。`compactToolOutputForLLM()` 默认将超过 6000 字符的输出压缩为：

- 压缩说明：原始长度、省略长度、省略行数
- 输出头部：保留命令开头、表头、上下文
- 输出尾部：保留最后的错误、验证结果、关键结论

这样可以避免大日志、`doctor` 输出、`cat` 大文件内容持续占用上下文，同时保留模型继续推理最需要的首尾信息。

### `cli/index.ts` — CLI 解析

解析命令行参数，支持：

| 参数 | 说明 |
|------|------|
| `--model <name>` | 覆盖默认模型 |
| `--auto` | 自动执行 DANGEROUS 命令，IRREVERSIBLE 仍需确认 |
| `--debug` | 打印 LLM token 用量和工具调用 |
| `--json` | 以 JSON 格式输出最终结果 |
| `--shhh` | 静默模式，仅输出工具名称、参数和最终结果 |

### `guard/safety.ts` — 安全守卫

三级防护，不可绕过：

安全检测不是只靠简单字符串匹配。命令会先经过 `shell-quote` 解析成 shell token，再按控制符拆成多个命令段逐段检查；正则规则作为硬黑名单和分级确认的补充兜底。

当前检查覆盖：

- shell 控制符：`|`、`|&`、`;`、`&&`、`||`、`&`
- 命令替换和进程替换：`$()`、反引号、`<()`
- 执行包装器：`sudo`、`env`、`timeout`、`watch`、`nohup`、`setsid`、`time`、`nice`
- fetch-and-execute：例如 `curl ... | sh`
- `find -exec` / `find -ok` / `find -delete`
- 写入受保护系统路径：例如 `/etc`、`/usr`、`/bin`、`/sbin`
- allowlist 外的可执行程序

**BLOCKED（直接拒绝）：**
- `rm -rf /`
- `mkfs`（格式化文件系统）
- `shutdown` / `reboot`
- Fork Bomb `:(){ :|:& };:`
- 覆写磁盘设备 `dd of=/dev/...`
- 间接执行入口，如 `sh -c`、`eval`、`$()`、`` `...` ``
- fetch-and-execute，如 `curl ... | sh`
- 写入受保护系统路径
- allowlist 外的可执行程序

**IRREVERSIBLE（始终确认，`--auto` 不跳过）：**
- `rm -r`（递归删除）
- `docker rm` / `docker rmi`
- `git reset --hard` / `git clean -fdx`
- `apt purge`
- `crontab -r`

**DANGEROUS（非 `--auto` 时需确认）：**
- `sudo`
- `apt/yum/dnf remove`（卸载软件包）
- `kill -9` / `pkill`
- `systemctl stop/disable/restart/reload`

**自定义规则：**

以上为内置规则，用户可在 `~/.tai/config.json` 中通过 `blockedPatterns` / `dangerousPatterns` 追加自定义正则，也可通过 `allowedExecutables` 扩展可执行程序 allowlist。`DENIED_EXEC` 是硬边界，不可通过配置绕过。

**执行资源限制：**

`shell` 工具执行前会附加基础资源限制，降低失控命令的影响范围：

- CPU 时间：最多 60 秒
- 文件写入：约 1GB
- 文件描述符：最多 256 个
- 单次命令超时：30 秒

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
🤖 终端 AI 助手  [模型: qwen2.5-coder]

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

配置加载顺序（优先级从高到低）：**环境变量 > `~/.tai/config.json` > 内置默认值**

**方式一：配置文件（推荐）**

```bash
# 初始化配置文件
ai init
```

配置文件位于 `~/.tai/config.json`（Linux/macOS）或 `C:\Users\<用户名>\.tai\config.json`（Windows），内容如下：

```json
{
  "apiUrl": "http://localhost:9527/v1/chat/completions",
  "apiKey": "",
  "model": "glm-5",
  "maxSteps": 12,
  "temperature": 0.3,
  "blockedPatterns": [],
  "dangerousPatterns": [],
  "allowedExecutables": []
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
- `allowedExecutables` — 追加允许执行的命令名，不能覆盖硬黑名单
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
sudo ln -sf /path/to/TAI/dist/ai-macos-arm64 /usr/local/bin/ai

# Windows (以管理员运行 PowerShell)
New-Item -ItemType SymbolicLink -Path "C:\Program Files\tai.exe" -Target "C:\path\to\TAI\dist\ai-win-x64.exe"
```

方式二：加入 PATH

```bash
# macOS/Linux
echo 'export PATH="/path/to/TAI/dist:$PATH"' >> ~/.zshrc
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
| System Prompt（AI 助手角色）| `agent/agent.ts` | ✅ |
| Tool: shell | `tools/shell.ts` | ✅ |
| Tool: doctor | `tools/doctor.ts` | ✅ |
| Tool: logs | `tools/logs.ts` | ✅ |
| Tool: docker | `tools/docker.ts` | ✅ |
| Tool: filesystem | `tools/fs.ts` | ✅ |
| Command Guard（BLOCKED） | `guard/safety.ts` | ✅ |
| Shell AST / token 解析安全检测 | `guard/safety.ts` + `shell-quote` | ✅ |
| Confirmation（DANGEROUS） | `guard/safety.ts` + `utils/prompt.ts` | ✅ |
| 工具输出压缩后回传 LLM | `utils/toolOutput.ts` + `agent/agent.ts` | ✅ |
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
- **依赖克制** — 默认优先使用 Node.js 内置模块；安全解析边界引入小型依赖 `shell-quote`，用于解析 shell token，避免只靠字符串正则判断命令风险
- **OpenAI function calling** — 工具调用使用标准格式，兼容任何 OpenAI 兼容 API（Ollama、本地模型等）
- **多步 Agent（最多 12 步）** — 支持复杂任务如"诊断 → 修复 → 验证"全流程自动化
- **上下文预算控制** — 大工具输出先压缩再回传 LLM，减少日志和诊断信息对上下文的挤占
