import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  ipcMain,
  session,
  shell
} from "electron";
import {
  chooseInterfaceAddress,
  listNetworkInterfaces
} from "./network/interfaces";
import { SignalingServer } from "./network/signaling";
import type {
  CaptureSource,
  CreateRoomRequest,
  CreatedRoom
} from "../shared/types";
import { DEFAULT_SIGNALING_PORT } from "../shared/endpoint";

app.commandLine.appendSwitch("disable-features", "WebRtcHideLocalIpsWithMdns");

let mainWindow: BrowserWindow | null = null;
let signalingServer: SignalingServer | null = null;
let createdRoom: CreatedRoom | null = null;
let selectedCaptureSourceId: string | null = null;
let roomCreationInFlight = false;
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

function createMainWindow(): void {
  const capturePath = process.env.NEARVIEW_CAPTURE_PATH;
  const reportPath = process.env.NEARVIEW_SMOKE_REPORT;
  const smokeMode = Boolean(capturePath || reportPath);
  const headless = process.env.NEARVIEW_HEADLESS === "1";
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(currentDirectory, "../../resources/icon.png");
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1060,
    minHeight: 700,
    show: false,
    backgroundColor: "#f4f5f2",
    icon: iconPath,
    title: "NearView",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(currentDirectory, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (!smokeMode && !headless) {
      mainWindow?.show();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const current = mainWindow?.webContents.getURL();
    if (current && url !== current) {
      event.preventDefault();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(currentDirectory, "../renderer/index.html"));
  }

  if (smokeMode) {
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        const window = mainWindow;
        if (!window) {
          app.exit(1);
          return;
        }
        void Promise.all([
          capturePath
            ? window.webContents
                .capturePage()
                .then((image) => writeFile(capturePath, image.toPNG()))
            : Promise.resolve(),
          reportPath
            ? window.webContents
                .executeJavaScript(`(() => {
                  const home = document.querySelector(".home-page");
                  return {
                    title: document.title,
                    bridge: typeof window.nearview,
                    rootChildren: document.querySelector("#root")?.childElementCount ?? 0,
                    bodyText: document.body.innerText.slice(0, 600),
                    viewport: { width: innerWidth, height: innerHeight },
                    home: home ? {
                      width: home.getBoundingClientRect().width,
                      height: home.getBoundingClientRect().height,
                      scrollHeight: home.scrollHeight
                    } : null,
                    buttons: document.querySelectorAll("button").length
                  };
                })()`)
                .then((report) => writeFile(reportPath, JSON.stringify(report, null, 2)))
            : Promise.resolve()
        ])
          .then(() => app.quit())
          .catch((error) => {
            console.error("[smoke] failed:", error);
            app.exit(1);
          });
      }, 1_500);
    });
  }
}

async function closeCurrentRoom(): Promise<void> {
  const server = signalingServer;
  signalingServer = null;
  createdRoom = null;
  if (server) {
    await server.close();
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle("network:interfaces", () => listNetworkInterfaces());

  ipcMain.handle(
    "room:create",
    async (_event, rawRequest: CreateRoomRequest): Promise<CreatedRoom> => {
      if (roomCreationInFlight) {
        throw new Error("房间正在创建，请稍候");
      }
      roomCreationInFlight = true;
      try {
        await closeCurrentRoom();

        const roomName =
          typeof rawRequest?.roomName === "string"
            ? rawRequest.roomName.trim().slice(0, 40)
            : "";
        const hostName =
          typeof rawRequest?.hostName === "string"
            ? rawRequest.hostName.trim().slice(0, 32)
            : "";
        const password =
          typeof rawRequest?.password === "string"
            ? rawRequest.password.slice(0, 64)
            : undefined;
        if (!roomName) {
          throw new Error("请输入房间名称");
        }

        const interfaceAddress =
          chooseInterfaceAddress(rawRequest?.interfaceAddress) ?? "127.0.0.1";

        const server = await SignalingServer.start({
          roomName,
          hostName: hostName || "房主",
          password,
          preferredPort: DEFAULT_SIGNALING_PORT
        });
        signalingServer = server;

        const port = server.port;
        createdRoom = {
          id: server.roomId,
          name: roomName,
          hostAddress: interfaceAddress,
          signalingPort: port,
          wsUrl: `ws://${interfaceAddress}:${port}`,
          interfaceAddress
        };
        return createdRoom;
      } catch (error) {
        await closeCurrentRoom();
        throw error;
      } finally {
        roomCreationInFlight = false;
      }
    }
  );

  ipcMain.handle("room:leave", () => closeCurrentRoom());

  ipcMain.handle("capture:sources", async (): Promise<CaptureSource[]> => {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 240, height: 135 },
      fetchWindowIcons: false
    });

    return sources
      .filter((source) => source.name.trim())
      .map((source) => ({
        id: source.id,
        name: source.name,
        kind: source.id.startsWith("screen:") ? "screen" : "window",
        thumbnail: source.thumbnail.toDataURL()
      }));
  });

  ipcMain.handle("capture:select-source", (_event, sourceId: unknown) => {
    if (typeof sourceId !== "string" || !sourceId) {
      throw new Error("无效的捕获目标");
    }
    selectedCaptureSourceId = sourceId;
  });

  ipcMain.handle("clipboard:write", (_event, text: unknown) => {
    if (typeof text !== "string") {
      throw new Error("无效的剪贴板文本");
    }
    clipboard.writeText(text);
  });
  ipcMain.handle("clipboard:read", () => clipboard.readText());
  ipcMain.handle("app:version", () => app.getVersion());
}

app.whenReady().then(async () => {
  app.setAppUserModelId("app.nearview.desktop");
  registerIpcHandlers();

  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(permission === "media" || permission === "display-capture");
    }
  );

  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false
      });
      const source =
        sources.find((item) => item.id === selectedCaptureSourceId) ?? sources[0];
      selectedCaptureSourceId = null;

      if (!source) {
        callback({});
        return;
      }
      callback({
        video: source,
        audio: request.audioRequested ? "loopback" : undefined
      });
    } catch (error) {
      console.error("[capture] failed to select source:", error);
      callback({});
    }
  });

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (signalingServer) {
    void signalingServer.close();
    signalingServer = null;
  }
});

process.on("uncaughtException", (error) => {
  console.error(`[main:${randomUUID()}]`, error);
});
