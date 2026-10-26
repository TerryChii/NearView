import { contextBridge, ipcRenderer } from "electron";
import type {
  AppPreferences,
  CreateRoomRequest,
  IncomingAnnotation,
  NearViewApi
} from "../shared/types";

const api: NearViewApi = {
  getNetworkInterfaces: () => ipcRenderer.invoke("network:interfaces"),
  createRoom: (request: CreateRoomRequest) =>
    ipcRenderer.invoke("room:create", request),
  leaveRoom: () => ipcRenderer.invoke("room:leave"),
  getCaptureSources: () => ipcRenderer.invoke("capture:sources"),
  selectCaptureSource: (sourceId) =>
    ipcRenderer.invoke("capture:select-source", sourceId),
  startApplicationAudio: () => ipcRenderer.invoke("audio:start-application"),
  stopApplicationAudio: () => ipcRenderer.invoke("audio:stop-application"),
  onApplicationAudioChunk: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: Uint8Array) =>
      callback(new Uint8Array(chunk));
    ipcRenderer.on("audio:application-chunk", handler);
    return () =>
      ipcRenderer.removeListener("audio:application-chunk", handler);
  },
  writeClipboard: (text) => ipcRenderer.invoke("clipboard:write", text),
  readClipboard: () => ipcRenderer.invoke("clipboard:read"),
  getPreferences: () => ipcRenderer.invoke("preferences:get"),
  setPreferences: (preferences: Partial<AppPreferences>) =>
    ipcRenderer.invoke("preferences:set", preferences),
  onScreenAnnotation: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      annotation: IncomingAnnotation
    ) => callback(annotation);
    ipcRenderer.on("screen-annotation:show", handler);
    return () => ipcRenderer.removeListener("screen-annotation:show", handler);
  },
  onScreenAnnotationsClear: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("screen-annotation:clear", handler);
    return () => ipcRenderer.removeListener("screen-annotation:clear", handler);
  },
  showScreenAnnotation: (annotation) =>
    ipcRenderer.invoke("screen-annotation:show", annotation),
  clearScreenAnnotations: () => ipcRenderer.invoke("screen-annotation:clear"),
  getVersion: () => ipcRenderer.invoke("app:version")
};

contextBridge.exposeInMainWorld("nearview", api);
