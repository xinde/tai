import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ─── 环境信息采集 ─────────────────────────────────────────────────────────────

/** 安全执行命令，失败时返回 "unknown" 而不抛出异常 */
async function safe(cmd: string): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, { timeout: 3000 });
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

/** 采集 Windows 环境信息 */
async function collectWindows(): Promise<string> {
  const [hostname, arch, winver, pkgManagers] = await Promise.all([
    safe("hostname"),
    safe("echo %PROCESSOR_ARCHITECTURE%"),
    safe("ver"),
    safe("(where winget >nul 2>&1 && echo winget) & (where choco >nul 2>&1 && echo choco) & (where scoop >nul 2>&1 && echo scoop)"),
  ]);
  return [
    `OS: Windows / ${winver}`,
    `Arch: ${arch}`,
    `Hostname: ${hostname}`,
    `Shell: cmd/powershell`,
    `Available package managers: ${pkgManagers || "none detected"}`,
  ].join("\n");
}

/** 采集 macOS / Linux 环境信息 */
async function collectPosix(): Promise<string> {
  const [os, arch, hostname, shell, kernel, pkgManagers] = await Promise.all([
    safe("uname -s"),
    safe("uname -m"),
    safe("hostname"),
    safe("echo $SHELL"),
    safe("uname -r"),
    safe("for p in apt apt-get yum dnf brew apk pacman zypper; do command -v $p 2>/dev/null && echo $p; done | tr '\\n' ' '"),
  ]);

  // 发行版信息：macOS 用 sw_vers，Linux 读 /etc/os-release
  let distro = "unknown";
  if (os === "Darwin") {
    const [name, ver] = await Promise.all([
      safe("sw_vers -productName"),
      safe("sw_vers -productVersion"),
    ]);
    distro = `${name} ${ver}`.trim();
  } else {
    // 优先读 /etc/os-release（Ubuntu/Debian/CentOS/RHEL/Fedora/Arch/Alpine 等）
    distro = await safe("grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '\"'");
    if (!distro || distro === "unknown") {
      // 兜底：RHEL 系旧版 / Alpine / lsb_release
      distro = await safe(
        "cat /etc/redhat-release 2>/dev/null || cat /etc/alpine-release 2>/dev/null || lsb_release -d 2>/dev/null | cut -f2"
      );
    }
  }

  return [
    `OS: ${os} / ${distro}`,
    `Arch: ${arch}`,
    `Kernel: ${kernel}`,
    `Hostname: ${hostname}`,
    `Shell: ${shell}`,
    `Available package managers: ${pkgManagers || "none detected"}`,
  ].join("\n");
}

/**
 * 采集当前执行环境的关键信息
 * 支持 macOS / Linux / Windows
 */
export async function collectEnvInfo(): Promise<string> {
  if (process.platform === "win32") return collectWindows();
  return collectPosix();
}

// ─── System Prompt 构建 ───────────────────────────────────────────────────────

/**
 * 构建注入了运行环境信息的 system prompt
 * @param envInfo  由 collectEnvInfo() 返回的环境描述字符串
 */
export function buildSystemPrompt(envInfo: string): string {
  return `You are an expert terminal AI assistant, specialized in system administration and operations tasks.

## Current Execution Environment
${envInfo}

## Goals
- Understand natural language requests and execute system administration tasks
- Diagnose server issues by reading logs and running diagnostics
- Generate and apply fix commands automatically
- Verify results after each change

## Rules
- Always gather information (logs, diagnostics) before attempting fixes
- **ALWAYS use commands native to the detected OS/distro above** — do not assume tools that may not be installed
- Prefer built-in system tools (e.g. systemctl, journalctl, ss, ip, awk, sed) over third-party utilities
- If a third-party tool is needed, first verify it exists with \`command -v <tool>\` before using it
- Prefer safe, non-destructive commands
- Avoid commands that can cause irreversible data loss unless explicitly asked
- Execute multi-step plans: diagnose → fix → verify
- Be concise in your final response
- Always respond in Chinese (Simplified)

## Available tools
shell, doctor, logs, docker, filesystem`;
}
