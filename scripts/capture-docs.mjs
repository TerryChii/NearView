import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

const root = process.cwd();
const electronPath = path.join(
  root,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron"
);
const appPath = path.join(root, "out", "main", "index.js");
const outputDir = path.join(root, "docs", "screenshots");
const outputPath = path.join(outputDir, "home.png");
const tempDir = await mkdtemp(path.join(tmpdir(), "nearview-docs-"));
const port = 9330;

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text);
    }
    return result.result?.value;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function connect() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find((item) => item.type === "page");
      if (target?.webSocketDebuggerUrl) {
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          socket.once("open", resolve);
          socket.once("error", reject);
        });
        return { client: new CdpClient(socket), socket };
      }
    } catch {
      // Electron is still starting.
    }
    await delay(250);
  }
  throw new Error("Electron DevTools did not start");
}

const child = spawn(
  electronPath,
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${tempDir}`,
    appPath
  ],
  {
    cwd: root,
    env: { ...process.env, NEARVIEW_HEADLESS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  }
);

try {
  const { client, socket } = await connect();
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await client.evaluate("Boolean(document.querySelector('.home-page'))")) {
      break;
    }
    await delay(200);
  }

  await client.evaluate(`(() => {
    const input = document.querySelector(".profile-field input");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    ).set;
    setter.call(input, "松果 26");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await delay(250);

  await client.evaluate(`(() => {
    const avatar = document.querySelector(".profile-avatar");
    if (avatar) avatar.textContent = "松";

    const select = document.querySelector(".network-details select");
    if (select) {
      const option = document.createElement("option");
      option.value = "demo-radmin";
      option.textContent = "Radmin VPN · 26.12.3.8（虚拟网卡）";
      select.replaceChildren(option);
      select.value = "demo-radmin";
    }

    const summaries = document.querySelectorAll(".network-summary");
    if (summaries[0]) summaries[0].textContent = "实体网卡 1";
    if (summaries[1]) summaries[1].textContent = "虚拟网卡 1";
    const meta = document.querySelector(".network-meta span:first-child");
    if (meta) meta.textContent = "已检测本机网络";
    return true;
  })()`);
  await delay(150);
  const hasDemoAddress = await client.evaluate(
    "document.body.innerText.includes('26.12.3.8')"
  );
  if (!hasDemoAddress) {
    throw new Error("Demo network address was not applied");
  }

  await mkdir(outputDir, { recursive: true });
  const screenshot = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false
  });
  await writeFile(outputPath, Buffer.from(screenshot.data, "base64"));
  socket.close();
  console.log(outputPath);
} finally {
  child.kill();
  await delay(300);
  await rm(tempDir, { recursive: true, force: true });
}
