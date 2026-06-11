# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

终端 AI 助手 (TAI) — an AI-powered CLI tool that uses natural language to diagnose, fix, and verify system issues. Based on OpenAI function calling agent loop, zero external npm dependencies.

## Commands

```bash
bun ai.ts init                   # 生成 ~/.ai-tui/config.json（首次配置）
bun ai.ts "fix nginx"            # Run with natural language task
bun ai.ts doctor                 # System health check + AI analysis
bun ai.ts "check disk" --debug   # With debug output

# Build standalone binaries
bun run build:mac-arm           # macOS ARM64
bun run build:linux-x64          # Linux x64
bun run build:all                # All platforms
```

## Configuration

配置加载顺序（优先级从高到低）：**环境变量 > `~/.ai-tui/config.json` > 内置默认值**

```bash
# 初始化配置文件
ai init

# 环境变量覆盖
export LLM_API_URL=https://...
export LLM_API_KEY=your-key
export LLM_MODEL=glm-5
```

配置文件: `~/.ai-tui/config.json`

## Architecture

**Agent Loop** (`agent/agent.ts`): Core agent runtime using OpenAI function calling. Maintains message history, calls LLM with tool schemas, executes tools, and loops until max 12 steps.

**Flow**: `cli/index.ts` → `Agent.run()` → `callLLM()` → tool execution → feedback loop → final response

**Tools** (`tools/`): Each tool exports two things:
- `xxxDef` — OpenAI function calling JSON Schema
- `xxxRun(args)` — Actual execution, returns `Promise<string>`

Tool error convention: Return strings starting with `ERROR:` or `Exit N:` instead of throwing.

**Safety** (`guard/safety.ts`): Two-level protection — BLOCKED (hard reject) and DANGEROUS (user confirm). `--auto` flag skips confirmation but cannot bypass BLOCKED.

## Configuration

API settings via environment variables:
- `LLM_API_URL` — OpenAI-compatible API endpoint
- `LLM_API_KEY` — API key
- `LLM_MODEL` — Default model (currently `glm-5`)

Config file: `config/model.ts` (do not hardcode API addresses elsewhere).

## Adding New Tools

1. Create `tools/xxx.ts` — export `xxxDef` (schema) and `xxxRun(args)` (implementation)
2. In `agent/agent.ts:46` — add `xxxDef` to the `tools` array
3. In `agent/agent.ts:95` — add case `case "xxx": return xxxRun(args)`
4. Add BLOCKED/DANGEROUS patterns in `guard/safety.ts` if the tool involves destructive operations

## CLI Options

| Flag | Purpose |
|------|---------|
| `--model <name>` | Override default model |
| `--auto` | Skip dangerous command confirmation |
| `--debug` | Print token usage and tool call details |
| `--json` | JSON output for scripting |

## Key Constraints

- **Zero external dependencies** — Only Node.js builtins (`child_process`, `readline`, `util`, `path`)
- **Path safety** — `logs.ts` and `fs.ts` require absolute paths only, use `path.normalize()`
- **Tool output** — Return strings, never throw; LLM uses output to decide next steps
