import { contextBridge, ipcRenderer } from "electron";
import type {
  CreateRoomRequest,
  NearViewApi,
  RoomAnnouncement
} from "../shared/types";

const api: NearViewApi = {
  getNetworkInterfaces: () => ipcRenderer.invoke("network:interfaces"),
  startDiscovery: (interfaceAddress) =>
    ipcRenderer.invoke("discovery:start", interfaceAddress),
  stopDiscovery: () => ipcRenderer.invoke("discovery:stop"),
  onDiscoveredRooms: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, rooms: RoomAnnouncement[]) =>
      callback(rooms);
    ipcRenderer.on("discovery:rooms", handler);
    return () => ipcRenderer.removeListener("discovery:rooms", handler);
  },
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
