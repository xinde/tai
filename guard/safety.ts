/**
 * 命令安全守卫
 * 分两级：
 *   1. BLOCKED  —— 绝对禁止，程序直接拒绝执行
 *   2. DANGEROUS —— 危险操作，需要用户手动确认
 *
 * 内置规则始终生效，用户可在 ~/.ai-tui/config.json 中通过
 * blockedPatterns / dangerousPatterns 数组追加自定义正则。
 */

import { loadUserSafetyPatterns } from "../config/model";

/** 绝对不允许执行的指令模式（不可逆 / 毁灭性操作） */
const BUILTIN_BLOCKED: RegExp[] = [
  /rm\s+-rf\s+\/(?:\s|$)/,         // rm -rf /
  /\bmkfs\b/,                      // 格式化文件系统
  /\bshutdown\b/,                  // 关机
  /\breboot\b/,                    // 重启
  /:\(\)\s*\{[\s\S]*\|[\s\S]*&/,  // Fork Bomb
  /dd\s+.*of=\/dev\/(sd|nvme|xvd|hd)/i, // 覆写磁盘设备
  />\s*\/dev\/(sd|nvme|xvd|hd)/i, // 重定向覆写磁盘
];

/** 危险但可在用户确认后执行的指令模式 */
const BUILTIN_DANGEROUS: RegExp[] = [
  /\brm\b.*-[a-zA-Z]*r/,          // 递归删除
  /apt\s+(remove|purge)/,          // 卸载软件包
  /yum\s+remove/,
  /dnf\s+remove/,
  /docker\s+rm\b/,                 // 删除容器
  /docker\s+rmi\b/,                // 删除镜像
  /\bkill\s+-9\b/,                 // 强制终止进程
  /\bpkill\b/,
  /systemctl\s+(stop|disable|mask)\b/,
  /service\s+\S+\s+stop\b/,
];

// 加载用户自定义规则，与内置规则合并
const userPatterns = loadUserSafetyPatterns();
const BLOCKED = [...BUILTIN_BLOCKED, ...userPatterns.blocked];
const DANGEROUS = [...BUILTIN_DANGEROUS, ...userPatterns.dangerous];

/** 检查命令是否绝对禁止 */
export function isBlocked(cmd: string): boolean {
  return BLOCKED.some((pattern) => pattern.test(cmd));
}

/** 检查命令是否属于危险操作（需要确认） */
export function isDangerous(cmd: string): boolean {
  return DANGEROUS.some((pattern) => pattern.test(cmd));
}
