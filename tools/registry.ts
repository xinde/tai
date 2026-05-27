/**
 * 工具注册表
 * 集中管理所有工具的 schema 定义和执行函数，消除双重注册。
 * 新增工具只需在此文件注册一次。
 */

import { shellDef, shellRun } from "./shell";
import { doctorDef, doctorRun } from "./doctor";
import { logsDef, logsRun } from "./logs";
import { dockerDef, dockerRun } from "./docker";
import { fsDef, fsRun } from "./fs";

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export interface ToolEntry {
  def: { type: "function"; function: { name: string; description: string; parameters: any } };
  run: (args: any, opts?: any) => Promise<string>;
  /** 用于 UI 显示的参数摘要提取器 */
  summarize?: (args: any) => string;
}

// ─── 注册表 ───────────────────────────────────────────────────────────────────

export const toolRegistry: Record<string, ToolEntry> = {
  shell: {
    def: shellDef,
    run: shellRun,
    summarize: (a) => `$ ${a.cmd}`,
  },
  doctor: {
    def: doctorDef,
    run: () => doctorRun(),
  },
  logs: {
    def: logsDef,
    run: logsRun,
    summarize: (a) => `${a.path}  (${a.lines ?? 50} lines)`,
  },
  docker: {
    def: dockerDef,
    run: dockerRun,
    summarize: (a) => `${a.action}${a.container ? " " + a.container : ""}`,
  },
  filesystem: {
    def: fsDef,
    run: fsRun,
    summarize: (a) => `${a.action} ${a.path}`,
  },
};

/** 获取所有工具的 OpenAI function calling schema 数组 */
export function getAllToolDefs() {
  return Object.values(toolRegistry).map((t) => t.def);
}

/** 获取工具名称列表 */
export function getToolNames(): string[] {
  return Object.keys(toolRegistry);
}
