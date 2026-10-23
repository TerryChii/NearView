import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  shell,
  Tray
} from "electron";
import {
  chooseInterfaceAddress,
  listNetworkInterfaces
} from "./network/interfaces";
import { SignalingServer } from "./network/signaling";
import type {
  AppPreferences,
  CaptureSource,
  CreateRoomRequest,
  CreatedRoom,
  IncomingAnnotation
} from "../shared/types";
import { DEFAULT_SIGNALING_PORT } from "../shared/endpoint";

app.commandLine.appendSwitch("disable-features", "WebRtcHideLocalIpsWithMdns");

let mainWindow: BrowserWindow | null = null;
let annotationOverlay: BrowserWindow | null = null;
let tray: Tray | null = null;
let signalingServer: SignalingServer | null = null;
let createdRoom: CreatedRoom | null = null;
let selectedCaptureSourceId: string | null = null;
let selectedCaptureSource: CaptureSource | null = null;
const knownCaptureSources = new Map<string, CaptureSource>();
let roomCreationInFlight = false;
let isQuitting = false;
let closePromptOpen = false;
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PREFERENCES: AppPreferences = { closeBehavior: "ask" };
const automationMode =
  process.env.NEARVIEW_HEADLESS === "1" ||
  Boolean(process.env.NEARVIEW_CAPTURE_PATH || process.env.NEARVIEW_SMOKE_REPORT);

function iconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(currentDirectory, "../../resources/icon.png");
}

function preferencesPath(): string {
  return path.join(app.getPath("userData"), "preferences.json");
}

async function readPreferences(): Promise<AppPreferences> {
  try {
    const parsed = JSON.parse(
      await readFile(preferencesPath(), "utf8")
    ) as Partial<AppPreferences>;
    return {
      closeBehavior: ["ask", "minimize", "quit"].includes(
        parsed.closeBehavior ?? ""
      )
        ? (parsed.closeBehavior as AppPreferences["closeBehavior"])
        : "ask"
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

async function savePreferences(
  update: Partial<AppPreferences>
): Promise<AppPreferences> {
  const current = await readPreferences();
  const next: AppPreferences = {
    ...current,
    ...(update.closeBehavior && ["ask", "minimize", "quit"].includes(update.closeBehavior)
      ? { closeBehavior: update.closeBehavior }
      : {})
  };
  await writeFile(preferencesPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

function showMainWindow(): void {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function quitApplication(): void {
  isQuitting = true;
  app.quit();
}

function createAppTray(): void {
  if (tray || automationMode) {
    return;
  }
  const image = nativeImage.createFromPath(iconPath()).resize({
    width: 16,
    height: 16
  });
  tray = new Tray(image);
  tray.setToolTip("NearView");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示 NearView", click: showMainWindow },
      { type: "separator" },
      { label: "退出 NearView", click: quitApplication }
    ])
  );
  tray.on("click", showMainWindow);
}

async function handleWindowClose(): Promise<void> {
  if (!mainWindow || isQuitting) {
    return;
  }
  const preferences = await readPreferences();
  if (preferences.closeBehavior === "minimize") {
    mainWindow.hide();
    tray?.displayBalloon?.({
      title: "NearView 仍在运行",
      content: "房间和屏幕共享会继续运行，点击托盘图标可重新打开。"
    });
    return;
  }
  if (preferences.closeBehavior === "quit") {
    quitApplication();
    return;
  }

  const result = await dialog.showMessageBox(mainWindow, {
    type: "question",
    title: "关闭 NearView",
    message: "要最小化到系统托盘，还是直接关闭？",
    detail: "最小化到托盘后，当前房间和屏幕共享会继续运行。",
    buttons: ["最小化到托盘", "直接关闭", "取消"],
    defaultId: 0,
    cancelId: 2,
    checkboxLabel: "记住我的选择，不再提示",
    checkboxChecked: false,
    noLink: true
  });

  if (result.response === 2) {
    return;
  }
  const closeBehavior = result.response === 0 ? "minimize" : "quit";
  if (result.checkboxChecked) {
    await savePreferences({ closeBehavior });
  }
  if (closeBehavior === "minimize") {
    mainWindow.hide();
    tray?.displayBalloon?.({
      title: "NearView 仍在运行",
      content: "房间和屏幕共享会继续运行，点击托盘图标可重新打开。"
    });
  } else {
    quitApplication();
  }
}

function overlayBounds(): Electron.Rectangle {
  const displays = screen.getAllDisplays();
  const display =
    displays.find(
      (item) => String(item.id) === selectedCaptureSource?.displayId
    ) ?? screen.getPrimaryDisplay();
  return display.bounds;
}

function ensureAnnotationOverlay(): BrowserWindow {
  if (annotationOverlay && !annotationOverlay.isDestroyed()) {
    return annotationOverlay;
  }
  const bounds = overlayBounds();
  annotationOverlay = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(currentDirectory, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  annotationOverlay.setIgnoreMouseEvents(true, { forward: true });
  annotationOverlay.setAlwaysOnTop(true, "screen-saver");
  annotationOverlay.setContentProtection(true);
  annotationOverlay.on("closed", () => {
    annotationOverlay = null;
  });
  void annotationOverlay.loadFile(
    path.join(currentDirectory, "../renderer/overlay.html")
  );
  return annotationOverlay;
}

function showScreenAnnotation(annotation: IncomingAnnotation): void {
  if (!selectedCaptureSource) {
    return;
  }
  const overlay = ensureAnnotationOverlay();
  const send = () => {
    if (!overlay.isDestroyed()) {
      overlay.webContents.send("screen-annotation:show", annotation);
      if (!automationMode) {
        overlay.showInactive();
      }
    }
  };
  if (overlay.webContents.isLoading()) {
    overlay.webContents.once("did-finish-load", send);
  } else {
    send();
  }
}

function clearScreenAnnotations(): void {
  if (annotationOverlay && !annotationOverlay.isDestroyed()) {
    annotationOverlay.webContents.send("screen-annotation:clear");
    annotationOverlay.hide();
  }
}

function createMainWindow(): void {
  const capturePath = process.env.NEARVIEW_CAPTURE_PATH;
  const reportPath = process.env.NEARVIEW_SMOKE_REPORT;
  const smokeMode = Boolean(capturePath || reportPath);
  const headless = process.env.NEARVIEW_HEADLESS === "1";
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1060,
    minHeight: 700,
    show: false,
    backgroundColor: "#f4f5f2",
    icon: iconPath(),
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

  mainWindow.on("close", (event) => {
    if (isQuitting || automationMode) {
      return;
    }
    event.preventDefault();
    if (closePromptOpen) {
      return;
    }
    closePromptOpen = true;
    void handleWindowClose().finally(() => {
      closePromptOpen = false;
    });
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

        const networkMode =
          rawRequest?.networkMode === "virtual" ? "virtual" : "local";
        const requestedInterface = listNetworkInterfaces().find(
          (item) => item.address === rawRequest?.interfaceAddress
        );
        if (rawRequest?.interfaceAddress && !requestedInterface) {
          throw new Error("所选网卡已不可用，请刷新后重新选择");
        }
        if (networkMode === "virtual" && requestedInterface && !requestedInterface.virtual) {
          throw new Error("虚拟局域网模式需要选择 Radmin VPN 等虚拟网卡");
        }
        if (networkMode === "local" && requestedInterface?.virtual) {
          throw new Error("本地局域网模式需要选择实体网卡");
        }
        const interfaceAddress =
          requestedInterface?.address ??
          chooseInterfaceAddress(rawRequest?.interfaceAddress) ??
          "127.0.0.1";
        const adapterName = requestedInterface?.name ?? "Loopback";

        const server = await SignalingServer.start({
          roomName,
          hostName: hostName || "房主",
          password,
          preferredPort: DEFAULT_SIGNALING_PORT,
          bindAddress: interfaceAddress,
          networkMode,
          adapterName
        });
        signalingServer = server;

        const port = server.port;
        createdRoom = {
          id: server.roomId,
          name: roomName,
          hostAddress: interfaceAddress,
          signalingPort: port,
          wsUrl: `ws://${interfaceAddress}:${port}`,
          interfaceAddress,
          networkMode,
          adapterName
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

    const captureSources = sources
      .filter((source) => source.name.trim())
      .map((source): CaptureSource => ({
        id: source.id,
        name: source.name,
        kind: source.id.startsWith("screen:") ? "screen" : "window",
        thumbnail: source.thumbnail.toDataURL(),
        displayId: source.display_id
      }));
    knownCaptureSources.clear();
    for (const source of captureSources) {
      knownCaptureSources.set(source.id, source);
    }
    return captureSources;
  });

  ipcMain.handle("capture:select-source", (_event, sourceId: unknown) => {
    if (typeof sourceId !== "string" || !sourceId) {
      throw new Error("无效的捕获目标");
    }
    selectedCaptureSourceId = sourceId;
    selectedCaptureSource = knownCaptureSources.get(sourceId) ?? null;
  });

  ipcMain.handle("clipboard:write", (_event, text: unknown) => {
    if (typeof text !== "string") {
      throw new Error("无效的剪贴板文本");
    }
    clipboard.writeText(text);
  });
  ipcMain.handle("clipboard:read", () => clipboard.readText());
  ipcMain.handle("preferences:get", () => readPreferences());
  ipcMain.handle(
    "preferences:set",
    (_event, preferences: Partial<AppPreferences>) =>
      savePreferences(preferences && typeof preferences === "object" ? preferences : {})
  );
  ipcMain.handle("screen-annotation:show", (_event, annotation: IncomingAnnotation) => {
    if (
      annotation &&
      typeof annotation.x1 === "number" &&
      typeof annotation.y1 === "number"
    ) {
      showScreenAnnotation(annotation);
    }
  });
  ipcMain.handle("screen-annotation:clear", () => clearScreenAnnotations());
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
  createAppTray();

  app.on("activate", () => {
    showMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  if (annotationOverlay && !annotationOverlay.isDestroyed()) {
    annotationOverlay.destroy();
    annotationOverlay = null;
  }
  if (signalingServer) {
    void signalingServer.close();
    signalingServer = null;
  }
  tray?.destroy();
  tray = null;
});

process.on("uncaughtException", (error) => {
  console.error(`[main:${randomUUID()}]`, error);
});
