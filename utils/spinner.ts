/**
 * 终端加载动画 spinner
 * 在等待 LLM 响应时显示动态字符，避免用户以为程序卡死
 */

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL = 80;

export class Spinner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frameIdx = 0;
  private message: string;

  constructor(message = "思考中") {
    this.message = message;
  }

  start(message?: string): void {
    if (message) this.message = message;
    if (this.timer) return; // 已经在转了
    this.frameIdx = 0;
    process.stderr.write(`\r${FRAMES[0]} ${this.message}`);
    this.timer = setInterval(() => {
      this.frameIdx = (this.frameIdx + 1) % FRAMES.length;
      process.stderr.write(`\r${FRAMES[this.frameIdx]} ${this.message}`);
    }, INTERVAL);
  }

  /** 更新显示文字（不停止动画） */
  update(message: string): void {
    this.message = message;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      process.stderr.write("\r" + " ".repeat(this.message.length + 4) + "\r");
    }
  }
}
