export interface NetworkInterfaceInfo {
  id: string;
  name: string;
  address: string;
  netmask: string;
  virtual: boolean;
  recommended: boolean;
}

export interface RoomAnnouncement {
  id: string;
  name: string;
  hostName: string;
  hostAddress: string;
  signalingPort: number;
  hasPassword: boolean;
  memberCount: number;
  createdAt: number;
  lastSeen: number;
}

export interface CreateRoomRequest {
  roomName: string;
  hostName: string;
  password?: string;
  interfaceAddress?: string;
}

export interface CreatedRoom {
  id: string;
  name: string;
  hostAddress: string;
  signalingPort: number;
  wsUrl: string;
  interfaceAddress: string;
}

export interface PeerSummary {
  id: string;
  name: string;
  joinedAt: number;
  sharing: boolean;
  paused: boolean;
  quality: "balanced" | "sharp" | "smooth";
}

export interface RoomSummary {
  id: string;
  name: string;
  hasPassword: boolean;
  hostName: string;
}

export interface ChatMessage {
  id: string;
  peerId: string;
  peerName: string;
  text: string;
  sentAt: number;
}

export type CaptureSourceKind = "screen" | "window";

export interface CaptureSource {
  id: string;
  name: string;
  kind: CaptureSourceKind;
  thumbnail: string;
}

export interface AnnotationPayload {
  targetPeerId: string;
  tool: "pulse" | "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface IncomingAnnotation extends AnnotationPayload {
  id: string;
  fromPeerId: string;
  fromPeerName: string;
  createdAt: number;
}

export type NearViewApi = {
  getNetworkInterfaces: () => Promise<NetworkInterfaceInfo[]>;
  startDiscovery: (interfaceAddress?: string) => Promise<RoomAnnouncement[]>;
  stopDiscovery: () => Promise<void>;
  onDiscoveredRooms: (callback: (rooms: RoomAnnouncement[]) => void) => () => void;
  createRoom: (request: CreateRoomRequest) => Promise<CreatedRoom>;
  leaveRoom: () => Promise<void>;
  getCaptureSources: () => Promise<CaptureSource[]>;
  selectCaptureSource: (sourceId: string) => Promise<void>;
  writeClipboard: (text: string) => Promise<void>;
  readClipboard: () => Promise<string>;
  getVersion: () => Promise<string>;
};
