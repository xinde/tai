import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ─── 配置路径 ─────────────────────────────────────────────────────────────────

export const CONFIG_DIR = join(homedir(), ".tai");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

// ─── 配置默认值 ─────────────────────────────────────────────────────────────

const DEFAULTS = {
  apiUrl: "http://localhost:9527/v1/chat/completions",
  apiKey: "",
  model: "glm-5",
  maxSteps: 12,
  temperature: 0.3,
};

export type AgentConfig = typeof DEFAULTS;

// ─── JSON 配置文件读写 ──────────────────────────────────────────────────────

interface JsonConfig {
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  maxSteps?: number;
  temperature?: number;
  blockedPatterns?: string[];
  dangerousPatterns?: string[];
  allowedExecutables?: string[];
}

function loadJsonConfig(): JsonConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as JsonConfig;
  } catch {
    return {};
  }
}

function mergeConfig(): AgentConfig {
  const json = loadJsonConfig();
  return {
    apiUrl: process.env.LLM_API_URL ?? json.apiUrl ?? DEFAULTS.apiUrl,
    apiKey: process.env.LLM_API_KEY ?? json.apiKey ?? DEFAULTS.apiKey,
    model: process.env.LLM_MODEL ?? json.model ?? DEFAULTS.model,
    maxSteps: process.env.LLM_MAX_STEPS
      ? parseInt(process.env.LLM_MAX_STEPS)
      : json.maxSteps ?? DEFAULTS.maxSteps,
    temperature: process.env.LLM_TEMPERATURE
      ? parseFloat(process.env.LLM_TEMPERATURE)
      : json.temperature ?? DEFAULTS.temperature,
  };
}

export const defaultConfig: AgentConfig = mergeConfig();

// ─── 用户自定义安全规则 ─────────────────────────────────────────────────────

export function loadUserSafetyPatterns(): {
  blocked: RegExp[];
  dangerous: RegExp[];
  allowed: string[];
} {
  const json = loadJsonConfig();
  const toRegexps = (patterns?: string[]): RegExp[] =>
    (patterns ?? []).map((p) => new RegExp(p));
  return {
    blocked: toRegexps(json.blockedPatterns),
    dangerous: toRegexps(json.dangerousPatterns),
    allowed: json.allowedExecutables ?? [],
  };
}

// ─── Init: 写入默认配置到用户目录 ───────────────────────────────────────────

export function initConfig(): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const initTemplate = {
    ...DEFAULTS,
    blockedPatterns: [] as string[],
    dangerousPatterns: [] as string[],
    allowedExecutables: [] as string[],
  };
  writeFileSync(CONFIG_PATH, JSON.stringify(initTemplate, null, 2), "utf-8");
  console.log(`✅ 配置文件已写入: ${CONFIG_PATH}`);
  console.log("   请编辑此文件填入你的 API Key 和偏好设置。\n");
}
