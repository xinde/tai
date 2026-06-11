/**
 * 终端加载动画 spinner
 * 使用简单 ASCII 字符，所有终端都支持
 */

const FRAMES = ["-", "\\", "|", "/"];
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
    if (this.timer) return;
    this.frameIdx = 0;
    process.stderr.write(`\r${FRAMES[0]} ${this.message}`);
    this.timer = setInterval(() => {
      this.frameIdx = (this.frameIdx + 1) % FRAMES.length;
      process.stderr.write(`\r${FRAMES[this.frameIdx]} ${this.message}`);
    }, INTERVAL);
  }

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
