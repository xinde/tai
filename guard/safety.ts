/**
 * 命令安全守卫（基于 shell-quote AST + 正则 fallback）
 *
 * 三级判定（checkCommand 返回 level）：
 *   - blocked       绝对禁止，永不执行
 *   - irreversible  不可逆操作，--auto 也必须确认
 *   - dangerous     危险操作，非 auto 需确认
 *   - null          放行
 *
 * 用户可在 ~/.tai/config.json 中通过 blockedPatterns / dangerousPatterns
 * 追加正则，通过 allowedExecutables 追加白名单二进制。
 * DENIED_EXEC 是硬边界，不可被允许。
 */
import { loadUserSafetyPatterns } from "../config/model";
import parse from "shell-quote/parse";
import path from "path";

type ShellToken = ReturnType<typeof parse>[number];

export type SafetyLevel = "blocked" | "irreversible" | "dangerous";

export interface SafetyVerdict {
  level: SafetyLevel | null;
  reason: string;
}

// 受保护的系统路径（根 + 各系统目录）
function isProtectedPath(filePath: string): boolean {
  const protectedRoots = ["/etc", "/boot", "/proc", "/sys", "/usr", "/bin", "/sbin", "/lib", "/opt", "/lib64"];
  const safeDevPaths = ["/dev/null", "/dev/zero", "/dev/stdout", "/dev/stderr", "/dev/stdin"];
  const normalized = path.normalize(filePath);
  if (normalized === "/") return true;
  if (safeDevPaths.includes(normalized)) return false;
  for (const root of protectedRoots) {
    if (normalized === root || normalized.startsWith(root + "/")) return true;
  }
  return false;
}

// 硬黑名单：只要这个命令名出现就拦
const DENIED_EXEC = new Set([
  "dd", "mkfs", "mkfs.ext4", "mkfs.btrfs", "mkfs.xfs", "mkfs.vfat", "fdisk", "parted", "gparted", "shred",
  "shutdown", "reboot", "halt", "poweroff", "init", "telinit",
  "eval", "source", "exec",
  "su",
  "sh", "bash", "zsh", "dash", "ksh", "csh", "fish", "tcsh",
  "python", "python2", "python3", "pypy", "pypy3", "perl", "ruby", "node", "php", "lua", "tclsh",
  "xargs", "parallel", "pry", "irb", "ipython"
]);

// 白名单：只有这些命令允许（默认拒绝未知）
const ALLOWED_EXEC = new Set([
  "ls", "cd", "pwd", "tree", "file", "stat", "du", "df", "find", "locate", "which", "whereis", "basename", "dirname", "realpath", "readlink",
  "cat", "head", "tail", "less", "more", "wc", "cut", "tr", "sort", "uniq", "comm", "fold", "strings", "od", "hexdump", "xxd", "expand", "unexpand",
  "grep", "egrep", "fgrep", "rg", "ack", "gawk", "awk", "sed",
  "ps", "top", "htop", "pgrep", "pidof", "lsof", "uptime", "w", "who", "whoami", "id", "last", "users", "jobs", "nice", "renice",
  "free", "vmstat", "iostat", "sar", "lsblk", "blkid", "mount", "umount", "smartctl", "hdparm",
  "ip", "ifconfig", "route", "arp", "ss", "netstat", "ping", "traceroute", "tracepath", "mtr", "dig", "nslookup", "host", "curl", "wget", "ssh", "scp", "sftp", "rsync", "nc", "ncat", "tcpdump", "tshark",
  "systemctl", "service", "journalctl", "dmesg", "loginctl", "hostnamectl", "timedatectl",
  "apt", "apt-get", "dpkg", "yum", "dnf", "rpm", "brew", "npm", "yarn", "pnpm", "bun", "pip", "pip3", "cargo", "go", "gem", "composer",
  "nginx", "apache2ctl", "httpd", "mysqld", "mysql", "psql", "sqlite3", "redis-cli", "mongo", "mongosh", "docker", "docker-compose", "kubectl", "helm", "pm2", "supervisorctl",
  "echo", "printf", "mkdir", "rmdir", "touch", "cp", "mv", "ln", "tee", "install", "patch", "diff", "cmp", "md5sum", "sha256sum", "sha1sum",
  "rm", "truncate",
  "date", "cal", "uname", "hostname", "domainname", "env", "printenv", "locale", "sleep", "watch", "timeout", "yes", "seq", "mktemp", "trap", "test", "[", "alias", "unalias", "time", "nohup", "setsid",
  "git",
  "lspci", "lsusb", "lscpu", "lsmem", "lsmod", "modinfo",
  "tar", "gzip", "gunzip", "zcat", "zgrep", "bzip2", "bunzip2", "xz", "unxz", "zip", "unzip", "7z", "zstd", "unzstd",
  "chmod", "chown", "chgrp", "umask", "stty", "ulimit", "tty", "su", "sudo", "kill", "killall", "pkill"
]);

// 硬黑名单正则（双重保险）
const HARD_BLOCKED_REGEX = [
  /rm\s+-rf\s+\/(?:\s|$)/,
  /:\(\)\s*\{[\s\S]*\|[\s\S]*&/, // fork bomb
  /dd\s+.*of=\/dev\/(sd|nvme|xvd|hd)/i,
  />\s*\/dev\/(sd|nvme|xvd|hd)/i,
  /find\b[\s\S]*\s-delete/,
];

// 不可逆操作（即使 --auto 也要确认）
const IRREVERSIBLE_PATTERNS = [
  /\brm\s.*-[a-zA-Z]*r/,
  /\bdocker\s+(rm|rmi)/,
  /\bgit\s+reset\s+--hard/,
  /\bgit\s+clean\s+-[a-zA-Z]*[fdx]/,
  /\bapt(?:-get)?\s+purge/,
  /\bcrontab\s+-r/,
];

// 危险操作（非 auto 确认）
const DANGEROUS_PATTERNS = [
  /\bsudo\b/,
  /\bkill\s+-9/,
  /\bpkill\b/,
  /\bkillall\b/,
  /\bapt(?:-get)?\s+(remove|autoremove)/,
  /\byum\s+remove/,
  /\bdnf\s+remove/,
  /\bsystemctl\s+(stop|disable|mask|restart|reload)/,
  /\bservice\s+\S+\s+(stop|restart|reload)/,
];

// 用户自定义模式
const userPatterns = loadUserSafetyPatterns();
const ALLOWED = new Set([...ALLOWED_EXEC, ...userPatterns.allowed]);
const COMMAND_SEPARATORS = new Set(["|", "|&", ";", ";;", "&&", "||", "&"]);
const EXEC_WRAPPERS = new Set(["env", "sudo", "timeout", "watch", "nohup", "setsid", "time", "nice"]);

function tokenOp(tok: ShellToken): string | null {
  return typeof tok !== "string" && "op" in tok && typeof tok.op === "string" ? tok.op : null;
}

function commandKey(cmdName: string): string {
  return path.basename(cmdName);
}

function isDeniedCommand(cmdName: string): boolean {
  return DENIED_EXEC.has(commandKey(cmdName));
}

function isAllowedCommand(cmdName: string): boolean {
  return ALLOWED.has(cmdName) || ALLOWED.has(commandKey(cmdName));
}

function skipOptionWithValue(tokens: string[], index: number, options: Set<string>): number {
  const tok = tokens[index];
  return options.has(tok) && index + 1 < tokens.length ? index + 2 : index + 1;
}

function findEnvCommandIndex(tokens: string[], start: number): number {
  let i = start;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
      i++;
      continue;
    }
    if (tok === "-i" || tok === "-0") {
      i++;
      continue;
    }
    if (tok === "-u" || tok === "-C" || tok === "-S") {
      i += 2;
      continue;
    }
    if (tok.startsWith("-")) {
      i++;
      continue;
    }
    return i;
  }
  return -1;
}

function findSudoCommandIndex(tokens: string[], start: number): number {
  let i = start;
  const optionsWithValue = new Set(["-u", "-g", "-h", "-p", "-C", "-T", "-t"]);
  while (i < tokens.length) {
    const tok = tokens[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
      i++;
      continue;
    }
    if (tok === "--") return i + 1 < tokens.length ? i + 1 : -1;
    if (tok.startsWith("--user=") || tok.startsWith("--group=") || tok.startsWith("--host=") || tok.startsWith("--prompt=")) {
      i++;
      continue;
    }
    if (tok.startsWith("-")) {
      i = skipOptionWithValue(tokens, i, optionsWithValue);
      continue;
    }
    return i;
  }
  return -1;
}

function findTimeoutCommandIndex(tokens: string[], start: number): number {
  let i = start;
  const optionsWithValue = new Set(["-s", "--signal", "-k", "--kill-after"]);
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === "--") return i + 1 < tokens.length ? i + 1 : -1;
    if (tok.startsWith("--signal=") || tok.startsWith("--kill-after=")) {
      i++;
      continue;
    }
    if (tok.startsWith("-")) {
      i = skipOptionWithValue(tokens, i, optionsWithValue);
      continue;
    }
    i++; // duration
    return i < tokens.length ? i : -1;
  }
  return -1;
}

function findWatchCommandIndex(tokens: string[], start: number): number {
  let i = start;
  const optionsWithValue = new Set(["-n", "--interval", "-d", "--differences", "-x", "--exec"]);
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === "--") return i + 1 < tokens.length ? i + 1 : -1;
    if (tok.startsWith("--interval=") || tok.startsWith("--differences=")) {
      i++;
      continue;
    }
    if (tok.startsWith("-")) {
      i = skipOptionWithValue(tokens, i, optionsWithValue);
      continue;
    }
    return i;
  }
  return -1;
}

function findNiceCommandIndex(tokens: string[], start: number): number {
  let i = start;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === "--") return i + 1 < tokens.length ? i + 1 : -1;
    if (tok === "-n") {
      i += 2;
      continue;
    }
    if (tok.startsWith("-n")) {
      i++;
      continue;
    }
    return i;
  }
  return -1;
}

function nestedCommandIndex(cmdName: string, tokens: string[], cmdIndex: number): number {
  const start = cmdIndex + 1;
  switch (commandKey(cmdName)) {
    case "env":
      return findEnvCommandIndex(tokens, start);
    case "sudo":
      return findSudoCommandIndex(tokens, start);
    case "timeout":
      return findTimeoutCommandIndex(tokens, start);
    case "watch":
      return findWatchCommandIndex(tokens, start);
    case "nice":
      return findNiceCommandIndex(tokens, start);
    case "nohup":
    case "setsid":
    case "time":
      return start < tokens.length ? start : -1;
    default:
      return -1;
  }
}

function validateCommandAt(tokens: string[], cmdIndex: number): SafetyVerdict | null {
  if (cmdIndex < 0 || cmdIndex >= tokens.length) return null;
  const cmdName = tokens[cmdIndex];

  if (isDeniedCommand(cmdName)) {
    return { level: "blocked", reason: `禁止的命令: ${commandKey(cmdName)}` };
  }

  if (!isAllowedCommand(cmdName)) {
    return { level: "blocked", reason: `未知命令: ${cmdName}` };
  }

  if (EXEC_WRAPPERS.has(commandKey(cmdName))) {
    const childIndex = nestedCommandIndex(cmdName, tokens, cmdIndex);
    if (childIndex !== -1) {
      return validateCommandAt(tokens, childIndex);
    }
  }

  return null;
}

// 主函数
export function checkCommand(cmd: string): SafetyVerdict {
  // 0. 优先硬黑名单正则和用户自定义 blocked
  for (const re of HARD_BLOCKED_REGEX) {
    if (re.test(cmd)) return { level: "blocked", reason: `硬黑名单模式: ${re.source}` };
  }
  for (const re of userPatterns.blocked) {
    if (re.test(cmd)) return { level: "blocked", reason: `用户自定义禁止: ${re.source}` };
  }

  // 1. 检测反引号命令替换（shell-quote 处理不太好，用正则先抓）
  if (/`/.test(cmd)) {
    return { level: "blocked", reason: "禁止使用反引号命令替换" };
  }
  if (/[\r\n]/.test(cmd)) {
    return { level: "blocked", reason: "禁止使用多行 shell 命令" };
  }

  let parsed: ShellToken[];
  try {
    parsed = parse(cmd);
  } catch {
    // 解析失败，交给用户确认更安全
    return { level: "dangerous", reason: "命令语法复杂，无法自动判定" };
  }

  // 2. 检测 $() 命令替换（shell-quote 用 op: "(" 标记）
  for (const tok of parsed) {
    const op = tokenOp(tok);
    if (op === "(") {
      return { level: "blocked", reason: "禁止使用命令替换 $()" };
    }
    if (op === "<(") {
      return { level: "blocked", reason: "禁止使用进程替换 <()" };
    }
  }

  // 3. 提取各命令段（按 shell 控制符分割；保留重定向 op 及其 target）
  const commands: ShellToken[][] = [];
  let current: ShellToken[] = [];
  for (const tok of parsed) {
    const op = tokenOp(tok);
    if (typeof tok === "string" || !op || !COMMAND_SEPARATORS.has(op)) {
      current.push(tok);
    } else if (COMMAND_SEPARATORS.has(op)) {
      if (current.length > 0) commands.push(current);
      current = [];
    }
  }
  if (current.length > 0) commands.push(current);

  // 4. 逐命令段检测
  let prevWasFetch = false;
  for (const cmdTokens of commands) {
    let cmdName = "";
    let envVarAssignments = true;
    let stringTokens: string[] = [];
    for (const tok of cmdTokens) {
      if (typeof tok === "string") stringTokens.push(tok);
    }

    // 4a. 提取命令名（跳过前导 env=val）
    for (const tok of stringTokens) {
      if (envVarAssignments && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) continue;
      envVarAssignments = false;
      cmdName = tok;
      break;
    }
    if (!cmdName) continue;

    // 4b. 检测 fetch|bash 管道模式
    const isFetch = cmdName === "curl" || cmdName === "wget";
    const isInterpreter = isDeniedCommand(cmdName) && ["bash", "sh", "zsh", "python", "python2", "python3", "perl", "ruby", "node", "php"].includes(commandKey(cmdName));
    if (prevWasFetch && isInterpreter) {
      return { level: "blocked", reason: "禁止 fetch|bash 管道" };
    }
    prevWasFetch = isFetch;

    // 4c. 检测命令名、未知命令，以及包装器内部实际执行的子命令
    const commandVerdict = validateCommandAt(stringTokens, stringTokens.indexOf(cmdName));
    if (commandVerdict) return commandVerdict;

    // 4d. 检测 find -exec/-ok
    if (cmdName === "find" && (stringTokens.includes("-exec") || stringTokens.includes("-ok"))) {
      return { level: "blocked", reason: "禁止使用 find -exec/-ok" };
    }

    // 4e. 检测 redirect 目标是保护路径（处理 shell-quote 的 op 对象）
    for (let i = 0; i < cmdTokens.length; i++) {
      const tok = cmdTokens[i];
      const op = tokenOp(tok);
      if (op) {
        if ([">", ">>"].includes(op) && i + 1 < cmdTokens.length) {
          const target = cmdTokens[i + 1];
          if (typeof target === "string" && isProtectedPath(target)) {
            return { level: "blocked", reason: `禁止写受保护路径: ${target}` };
          }
        }
      } else if (typeof tok === "string") {
        if (tok.startsWith(">") || tok.startsWith("2>") || tok.startsWith("&>")) {
          if (i + 1 < cmdTokens.length) {
            const target = cmdTokens[i + 1];
            if (typeof target === "string" && isProtectedPath(target)) {
              return { level: "blocked", reason: `禁止写受保护路径: ${target}` };
            }
          }
        }
      }
    }

    // 4f. 检测 chmod 777 系统路径
    if (cmdName === "chmod") {
      let modeIndex = -1;
      for (let i = 0; i < stringTokens.length; i++) {
        const tok = stringTokens[i];
        if (tok === "777" || tok === "0777" || tok === "a=rwx" || tok === "u=rwx,g=rwx,o=rwx") {
          modeIndex = i;
          break;
        }
      }
      if (modeIndex !== -1 && modeIndex + 1 < stringTokens.length) {
        const target = stringTokens[modeIndex + 1];
        if (isProtectedPath(target)) {
          return { level: "blocked", reason: `禁止对系统路径赋 777 权限: ${target}` };
        }
      }
    }
  }

  // 5. 最后用原始字符串模式做 irreversible/dangerous 分级
  for (const re of IRREVERSIBLE_PATTERNS) {
    if (re.test(cmd)) {
      return { level: "irreversible", reason: `不可逆操作: ${re.source}` };
    }
  }
  for (const re of DANGEROUS_PATTERNS) {
    if (re.test(cmd)) {
      return { level: "dangerous", reason: `危险操作: ${re.source}` };
    }
  }
  for (const re of userPatterns.dangerous) {
    if (re.test(cmd)) {
      return { level: "dangerous", reason: `用户自定义危险: ${re.source}` };
    }
  }

  return { level: null, reason: "" };
}
