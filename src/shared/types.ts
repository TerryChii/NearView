export interface NetworkInterfaceInfo {
  id: string;
  name: string;
  address: string;
  netmask: string;
  virtual: boolean;
  recommended: boolean;
}

export type NetworkMode = "local" | "virtual";

export interface UserProfile {
  name: string;
  bio: string;
  avatarColor: string;
}

export type CloseBehavior = "ask" | "minimize" | "quit";

export interface AppPreferences {
  closeBehavior: CloseBehavior;
}

export interface CreateRoomRequest {
  roomName: string;
  hostName: string;
  password?: string;
  interfaceAddress?: string;
  networkMode: NetworkMode;
}

export interface CreatedRoom {
  id: string;
  name: string;
  hostAddress: string;
  signalingPort: number;
  wsUrl: string;
  interfaceAddress: string;
  networkMode: NetworkMode;
  adapterName: string;
}

export interface PeerSummary {
  id: string;
  name: string;
  bio: string;
  avatarColor: string;
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
  networkMode: NetworkMode;
  adapterName: string;
}

export interface RoomProbeResult {
  room: RoomSummary;
  memberCount: number;
  sharingCount: number;
  endpoint: string;
}

export interface ChatMessage {
  id: string;
  peerId: string;
  peerName: string;
  avatarColor: string;
  text: string;
  sentAt: number;
}

export type CaptureSourceKind = "screen" | "window";

export interface CaptureSource {
  id: string;
  name: string;
  kind: CaptureSourceKind;
  thumbnail: string;
  displayId: string;
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
  createRoom: (request: CreateRoomRequest) => Promise<CreatedRoom>;
  leaveRoom: () => Promise<void>;
  getCaptureSources: () => Promise<CaptureSource[]>;
  selectCaptureSource: (sourceId: string) => Promise<void>;
  writeClipboard: (text: string) => Promise<void>;
  readClipboard: () => Promise<string>;
  getPreferences: () => Promise<AppPreferences>;
  setPreferences: (preferences: Partial<AppPreferences>) => Promise<AppPreferences>;
  onScreenAnnotation: (callback: (annotation: IncomingAnnotation) => void) => () => void;
  onScreenAnnotationsClear: (callback: () => void) => () => void;
  showScreenAnnotation: (annotation: IncomingAnnotation) => Promise<void>;
  clearScreenAnnotations: () => Promise<void>;
  getVersion: () => Promise<string>;
};
