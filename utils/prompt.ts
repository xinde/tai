import * as readline from "readline";

/**
 * 在终端向用户提问，等待 y/n 确认
 * @returns true 表示用户确认，false 表示取消
 */
export async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<boolean>((resolve) => {
    rl.question(`\n⚠  ${message}\n执行? (y/n): `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase().startsWith("y"));
    });
  });
}
