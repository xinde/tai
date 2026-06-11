# 更新日志

## v2.2.0 (2026-06-11)

### 项目更名

- "AI 运维助手" → "终端 AI 助手" (TAI)
- 移除 SRE 限定词，定位更通用的 AI 助手

### 新增功能

- **终端颜色输出**: 使用 ANSI 颜色增强视觉层次
  - 错误信息红色高亮
  - 工具名称青色显示
  - 帮助信息选项黄色高亮
  - 新增 `utils/color.ts` 颜色工具

### Spinner 改进

- 添加 ASCII fallback 模式，解决某些终端 braille 字符显示异常
- 支持 `NO_BRAILLE=1` 环境变量强制使用 ASCII 模式

### 安全增强

- 补充安全守卫规则：
  - `chmod 777 /` - 危险权限设置 (BLOCKED)
  - `systemctl restart` - 可能影响业务的服务重启 (DANGEROUS)
  - `crontab -r` - 清空定时任务 (DANGEROUS)

### 文档修正

- 修正 `AGENTS.md` 中过时内容：
  - 默认模型从 `DeepSeek-V3.1` 改为 `glm-5`
  - 环境变量名从 `AI_*` 改为 `LLM_*`
  - 工具注册步骤改为使用 `tools/registry.ts`

### 文件变更

| 文件 | 类型 | 说明 |
|------|------|------|
| `utils/color.ts` | 新增 | ANSI 颜色工具 |
| `agent/agent.ts` | 修改 | 颜色输出 |
| `cli/index.ts` | 修改 | 帮助信息颜色 |
| `guard/safety.ts` | 修改 | 补充安全规则 |
| `AGENTS.md` | 修改 | 修正过时文档 |
