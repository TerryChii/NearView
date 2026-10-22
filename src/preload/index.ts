import { contextBridge, ipcRenderer } from "electron";
import type {
  CreateRoomRequest,
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
  writeClipboard: (text) => ipcRenderer.invoke("clipboard:write", text),
  readClipboard: () => ipcRenderer.invoke("clipboard:read"),
  getVersion: () => ipcRenderer.invoke("app:version")
};

contextBridge.exposeInMainWorld("nearview", api);
