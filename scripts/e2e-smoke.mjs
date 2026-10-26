import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

const root = process.cwd();
const requestedNetworkMode = process.env.NEARVIEW_E2E_NETWORK ?? "local";
const electronPath = path.join(
  root,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron"
);
const appPath = path.join(root, "out", "main", "index.js");
const screenshotPath = path.join(root, "smoke-room.png");

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (!message.id) {
        return;
      }
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
    socket.on("close", () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error("CDP connection closed"));
      }
      this.pending.clear();
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
    const response = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ||
          response.exceptionDetails.text
      );
    }
    return response.result?.value;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function launchElectron(port, userDataDir) {
  const child = spawn(
    electronPath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      appPath
    ],
    {
      cwd: root,
      env: { ...process.env, NEARVIEW_HEADLESS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }
  );
  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  child.logs = logs;
  return child;
}

async function connectCdp(port) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find(
        (item) => item.type === "page" && item.webSocketDebuggerUrl
      );
      if (target) {
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          socket.once("open", resolve);
          socket.once("error", reject);
        });
        return new CdpClient(socket);
      }
    } catch {
      // Electron is still starting.
    }
    await delay(250);
  }
  throw new Error(`Electron DevTools did not start on port ${port}`);
}

async function connectCdpByTitle(port, title) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find(
        (item) => item.type === "page" && item.title.includes(title)
      );
      if (target?.webSocketDebuggerUrl) {
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          socket.once("open", resolve);
          socket.once("error", reject);
        });
        return { client: new CdpClient(socket), socket };
      }
    } catch {
      // The overlay target may still be loading.
    }
    await delay(200);
  }
  throw new Error(`CDP target not found: ${title}`);
}

async function waitFor(
  client,
  expression,
  message,
  timeout = 20_000,
  diagnostics = "null"
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await client.evaluate(expression)) {
      return;
    }
    await delay(200);
  }
  const diagnosticValue = await client.evaluate(
    `(async () => ${diagnostics})()`
  );
  const state = await client.evaluate(
    `({ text: document.body.innerText.slice(0, 1200), diagnostics: ${JSON.stringify(diagnosticValue)} })`
  );
  throw new Error(
    `Timed out: ${message}\nCurrent UI:\n${JSON.stringify(state, null, 2)}`
  );
}

function setInput(selector, value) {
  return `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) throw new Error("Missing input: ${selector}");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    ).set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return input.value;
  })()`;
}

function click(selector) {
  return `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error("Missing element: ${selector}");
    element.click();
    return true;
  })()`;
}

const tempDir = await mkdtemp(path.join(tmpdir(), "nearview-e2e-"));
const peers = [];
let alicePage;
let bobPage;

try {
  const alice = launchElectron(9322, path.join(tempDir, "alice"));
  const bob = launchElectron(9323, path.join(tempDir, "bob"));
  peers.push(alice, bob);

  [alicePage, bobPage] = await Promise.all([
    connectCdp(9322),
    connectCdp(9323)
  ]);
  await Promise.all([
    alicePage.send("Runtime.enable"),
    bobPage.send("Runtime.enable"),
    alicePage.send("Page.enable"),
    bobPage.send("Page.enable")
  ]);

  await Promise.all([
    waitFor(alicePage, "Boolean(document.querySelector('.home-page'))", "Alice home"),
    waitFor(bobPage, "Boolean(document.querySelector('.home-page'))", "Bob home")
  ]);

  for (const [client, name] of [
    [alicePage, "Alice"],
    [bobPage, "Bob"]
  ]) {
    await client.evaluate(click(".profile-button"));
    await waitFor(
      client,
      "Boolean(document.querySelector('.settings-modal'))",
      `${name} settings`
    );
    await client.evaluate(
      setInput(".settings-modal .field input", name)
    );
    await client.evaluate(click(".settings-modal .modal-actions .primary-button"));
    await waitFor(
      client,
      "!document.querySelector('.settings-modal')",
      `${name} settings saved`
    );
  }
  await bobPage.send("Page.reload");
  await waitFor(
    bobPage,
    "document.querySelector('.profile-button .profile-copy strong')?.textContent === 'Bob'",
    "Profile persisted locally"
  );

  await alicePage.evaluate(click(".hero-actions .primary-button"));
  await waitFor(
    alicePage,
    "Boolean(document.querySelector('.action-modal'))",
    "Alice create dialog"
  );
  await alicePage.evaluate(
    click(".network-mode-picker button:nth-child(2)")
  );
  await waitFor(
    alicePage,
    `(() => {
      const picker = document.querySelector(".network-mode-picker");
      const empty = document.querySelector(".adapter-empty");
      const select = document.querySelector(".action-modal .field select");
      return Boolean(picker && (empty || select));
    })()`,
    "Virtual-adapter mode state"
  );
  if (requestedNetworkMode === "virtual") {
    await waitFor(
      alicePage,
      `(() => {
        const select = document.querySelector(".action-modal .field select");
        return Boolean(select && select.options.length > 0);
      })()`,
      "Virtual adapter available"
    );
  } else {
    await alicePage.evaluate(
      click(".network-mode-picker button:nth-child(1)")
    );
  }
  await alicePage.evaluate(
    setInput(".action-modal .field input", "P2P Smoke Room")
  );
  await alicePage.evaluate(
    click(".action-modal .modal-actions .primary-button")
  );
  await waitFor(
    alicePage,
    "location.href && Boolean(document.querySelector('.room-page'))",
    "Alice room"
  );
  await waitFor(
    alicePage,
    `document.querySelector('.room-network-mode')?.textContent.includes('${
      requestedNetworkMode === "virtual" ? "虚拟局域网" : "本地局域网"
    }')`,
    "Room network mode label"
  );

  const endpoint = await alicePage.evaluate(`(() => {
    const title = document.querySelector(".invite-button")?.getAttribute("title") || "";
    return title.replace(/^复制邀请地址\\s*/, "");
  })()`);
  if (!endpoint) {
    throw new Error("Room invite endpoint was not rendered");
  }
  const joinAddress = endpoint.endsWith(":42800")
    ? endpoint.slice(0, -6)
    : endpoint;

  await alicePage.evaluate(click(".share-button"));
  await waitFor(
    alicePage,
    "document.querySelectorAll('.capture-item').length > 0",
    "Capture sources"
  );
  await alicePage.evaluate(click(".capture-tabs button:nth-child(2)"));
  await waitFor(
    alicePage,
    "document.querySelector('.audio-capture-options')?.innerText.includes('仅共享所选程序声音')",
    "Application audio option"
  );
  await alicePage.evaluate(click(".capture-tabs button:nth-child(1)"));
  await alicePage.evaluate(click(".capture-item"));
  await waitFor(
    alicePage,
    "Boolean(document.querySelector('.stream-tile.has-stream'))",
    "Alice local preview"
  );

  await bobPage.evaluate(click(".hero-actions .secondary-button"));
  await waitFor(
    bobPage,
    "Boolean(document.querySelector('.action-modal'))",
    "Bob manual join dialog"
  );
  await bobPage.evaluate(
    setInput(".action-modal .field input", joinAddress)
  );
  await waitFor(
    bobPage,
    "document.querySelector('.probe-card')?.innerText.includes('1 路屏幕正在共享')",
    "Bob discovers active sharing by IP"
  );
  await bobPage.evaluate(
    click(".action-modal .modal-actions .primary-button")
  );
  await waitFor(
    bobPage,
    "Boolean(document.querySelector('.room-page'))",
    "Bob room"
  );
  await waitFor(
    alicePage,
    "document.querySelectorAll('.member-row').length >= 2",
    "Alice sees Bob"
  );
  await waitFor(
    bobPage,
    "document.querySelectorAll('.member-row').length >= 2",
    "Bob sees Alice"
  );
  await waitFor(
    bobPage,
    "Boolean(document.querySelector('.screen-overlay-panel'))",
    "Screen chat and member overlay"
  );
  await waitFor(
    alicePage,
    "Boolean(document.querySelector('.share-notice'))",
    "Sharer receives viewer-joined notice"
  );
  await waitFor(
    bobPage,
    `(() => {
      const video = document.querySelector(".stream-tile.has-stream video");
      return Boolean(video && video.videoWidth > 0 && video.readyState >= 2);
    })()`,
    "Bob receives WebRTC video",
    30_000,
    `(async () => ({
      videos: [...document.querySelectorAll(".stream-tile.has-stream video")].map((video) => ({
      width: video.videoWidth,
      height: video.videoHeight,
      readyState: video.readyState,
      paused: video.paused,
      error: video.error?.message || null,
      tracks: video.srcObject ? video.srcObject.getTracks().map((track) => ({
        kind: track.kind,
        readyState: track.readyState,
        muted: track.muted,
        enabled: track.enabled
      })) : []
      })),
      runtime: await window.__nearviewDiagnostics?.()
    }))()`
  );
  await waitFor(
    bobPage,
    `(() => {
      const value = document.querySelector(".member-row .signal-meter small")?.textContent || "";
      return /\\d+ms/.test(value);
    })()`,
    "Peer PING metric"
  );

  await bobPage.evaluate(click(".annotation-pulse-toggle"));
  const annotationPoint = await bobPage.evaluate(`(() => {
    const target = document.querySelector(".stream-tile.has-stream .annotation-hit");
    if (!target) throw new Error("Annotation target not found");
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width * 0.46, y: rect.top + rect.height * 0.38 };
  })()`);
  await bobPage.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: annotationPoint.x,
    y: annotationPoint.y,
    button: "left",
    clickCount: 1
  });
  await bobPage.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: annotationPoint.x,
    y: annotationPoint.y,
    button: "left",
    clickCount: 1
  });
  const { client: overlayPage, socket: overlaySocket } =
    await connectCdpByTitle(9322, "NearView Annotation");
  await waitFor(
    overlayPage,
    "document.querySelectorAll('#marks > g').length > 0",
    "Screen annotation overlay"
  );
  const overlayMark = await overlayPage.evaluate(`(() => {
    const circle = document.querySelector("#marks circle");
    return {
      x: Number(circle?.getAttribute("cx")),
      y: Number(circle?.getAttribute("cy")),
      label: document.querySelector("#labels .annotation-label-chip")?.textContent || ""
    };
  })()`);
  if (
    Math.abs(overlayMark.x - 46) > 1.5 ||
    Math.abs(overlayMark.y - 38) > 1.5 ||
    overlayMark.label !== "Bob"
  ) {
    throw new Error(
      `Annotation mapping mismatch: ${JSON.stringify(overlayMark)}`
    );
  }
  overlaySocket.close();

  await bobPage.evaluate(`(() => {
    const input = document.querySelector(".chat-composer textarea");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    ).set;
    setter.call(input, "WebRTC stream is visible");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await bobPage.evaluate(click(".send-button"));
  await waitFor(
    alicePage,
    "document.querySelector('.chat-message p')?.textContent === 'WebRTC stream is visible'",
    "Room chat"
  );

  await alicePage.evaluate(
    click(".sharing-actions .tool-button")
  );
  await waitFor(
    bobPage,
    "Boolean(document.querySelector('.video-paused'))",
    "Privacy pause"
  );
  await alicePage.evaluate(
    click(".sharing-actions .tool-button")
  );
  await waitFor(
    bobPage,
    "!document.querySelector('.video-paused')",
    "Privacy resume"
  );

  const screenshot = await bobPage.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false
  });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  const directionSnapshot = await Promise.all(
    [alicePage, bobPage].map((client) =>
      client.evaluate(
        `(window.__nearviewDiagnostics?.() ?? Promise.resolve([])).then((peers) => peers.map((peer) => ({
          state: peer.connectionState,
          directions: peer.transceivers.map((item) => ({
            kind: item.senderTrack?.kind,
            direction: item.direction,
            currentDirection: item.currentDirection,
            playoutDelayMs:
              typeof item.playoutDelayHint === "number"
                ? Math.round(item.playoutDelayHint * 1000)
                : null
          })),
          metrics: peer.metrics
        })))`
      )
    )
  );
  const videoPlayoutDelays = directionSnapshot
    .flatMap((peers) => peers)
    .flatMap((peer) => peer.directions)
    .filter(
      (direction) =>
        direction.kind === "video" &&
        typeof direction.playoutDelayMs === "number"
    )
    .map((direction) => direction.playoutDelayMs);
  if (videoPlayoutDelays.length < 2) {
    throw new Error("Unified playout delay was not applied on both peers");
  }
  if (Math.max(...videoPlayoutDelays) - Math.min(...videoPlayoutDelays) > 30) {
    throw new Error(
      `Playout delay mismatch: ${videoPlayoutDelays.join(", ")}ms`
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        endpoint,
        joinAddress,
        members: 2,
        networkModes: requestedNetworkMode,
        profileSettings: true,
        screenOverlay: true,
        applicationAudioOption: true,
        nativeAnnotationOverlay: true,
        annotationMapping: overlayMark,
        sharingDiscovery: true,
        sharerNotice: true,
        pingMetric: true,
        unifiedPlayoutDelayMs: videoPlayoutDelays,
        webrtcVideo: true,
        directionSnapshot,
        chat: true,
        privacyPause: true,
        screenshot: screenshotPath
      },
      null,
      2
    )
  );
} catch (error) {
  for (const [label, client] of [
    ["Alice", alicePage],
    ["Bob", bobPage]
  ]) {
    if (!client) {
      continue;
    }
    try {
      const diagnostics = await client.evaluate(
        `(async () => ({ ui: document.body.innerText.slice(0, 800), runtime: await window.__nearviewDiagnostics?.() }))()`
      );
      console.error(`${label} diagnostics:\n${JSON.stringify(diagnostics, null, 2)}`);
    } catch (diagnosticError) {
      console.error(`${label} diagnostics failed:`, diagnosticError);
    }
  }
  for (const peer of peers) {
    console.error(peer.logs.join("").slice(-8_000));
  }
  throw error;
} finally {
  for (const peer of peers) {
    peer.kill();
  }
  await delay(300);
  await rm(tempDir, { recursive: true, force: true });
}
