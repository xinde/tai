# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

终端 AI 助手 (TAI) — an AI-powered CLI tool that uses natural language to diagnose, fix, and verify system issues. Based on OpenAI function calling agent loop, with dependency use kept small and justified at safety boundaries.

## Commands

```bash
bun ai.ts init                   # 生成 ~/.tai/config.json（首次配置）
bun ai.ts "fix nginx"            # Run with natural language task
bun ai.ts doctor                 # System health check + AI analysis
bun ai.ts "check disk" --debug   # With debug output

# Build standalone binaries
bun run build:mac-arm           # macOS ARM64
bun run build:linux-x64          # Linux x64
bun run build:all                # All platforms
```

## Configuration

配置加载顺序（优先级从高到低）：**环境变量 > `~/.tai/config.json` > 内置默认值**

```bash
# 初始化配置文件
ai init

# 环境变量覆盖
export LLM_API_URL=https://...
export LLM_API_KEY=your-key
export LLM_MODEL=glm-5
```

配置文件: `~/.tai/config.json`

## Architecture

**Agent Loop** (`agent/agent.ts`): Core agent runtime using OpenAI function calling. Maintains message history, calls LLM with tool schemas, executes tools, and loops until max 12 steps.

**Flow**: `cli/index.ts` → `Agent.run()` → `callLLM()` → tool execution → feedback loop → final response

**Tools** (`tools/`): Each tool exports two things:
- `xxxDef` — OpenAI function calling JSON Schema
- `xxxRun(args)` — Actual execution, returns `Promise<string>`

Tool error convention: Return strings starting with `ERROR:` or `Exit N:` instead of throwing.

**Safety** (`guard/safety.ts`): Three-level protection via `checkCommand()`:
- **BLOCKED** — hard reject, never executes (destructive patterns, indirect execution like `sh -c`/`$(...)`/`eval`, fetch-and-execute `curl|sh`, writes to protected system paths, executables outside the allowlist).
- **IRREVERSIBLE** — data-destructive ops (`rm -r`, `docker rm`, `git reset --hard`, `apt purge`); `--auto` cannot bypass these, confirmation always required.
- **DANGEROUS** — risky but reversible (`kill -9`, `systemctl restart`, `sudo`); `--auto` skips confirmation.

Executable allowlist: only `ALLOWED_EXEC` binaries pass; `DENIED_EXEC` (subshells, interpreters, `dd`, etc.) is a hard boundary not overridable via config. User may extend the allowlist with `allowedExecutables` in `~/.tai/config.json`. `shell.ts` also prefixes commands with `ulimit` (CPU/file-size/fd) to bound blast radius.

Dependency policy: default to Node.js/Bun builtins. Safety-critical parsing may use a small locked dependency when builtins are insufficient; update `package.json`, `bun.lock`, `package-lock.json`, and add regression coverage for dangerous command shapes.

## Configuration

API settings via environment variables:
- `LLM_API_URL` — OpenAI-compatible API endpoint
- `LLM_API_KEY` — API key
- `LLM_MODEL` — Default model (currently `glm-5`)

Config file: `config/model.ts` (do not hardcode API addresses elsewhere).

## Adding New Tools

1. Create `tools/xxx.ts` — export `xxxDef` (schema) and `xxxRun(args)` (implementation)
2. Register it once in `tools/registry.ts` with `def`, `run`, and optional `summarize`
3. Add safety rules and tests in `guard/safety.ts` / `guard/safety.test.ts` if the tool reaches destructive operations or shell execution

## CLI Options

| Flag | Purpose |
|------|---------|
| `--model <name>` | Override default model |
| `--auto` | Skip DANGEROUS confirmation (IRREVERSIBLE still confirms) |
| `--debug` | Print token usage and tool call details |
| `--json` | JSON output for scripting |

## Key Constraints

- **Dependency restraint** — Prefer Node.js/Bun builtins; safety-critical parsing dependencies must be justified, locked, and tested
- **Path safety** — `logs.ts` and `fs.ts` require absolute paths only, use `path.normalize()`
- **Tool output** — Return strings, never throw; LLM uses output to decide next steps
