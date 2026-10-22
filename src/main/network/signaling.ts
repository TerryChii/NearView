import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import type {
  ChatMessage,
  IncomingAnnotation,
  PeerSummary,
  RoomSummary
} from "../../shared/types";

const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_CHAT_LENGTH = 4_000;
const MAX_CHAT_HISTORY = 80;

interface Member extends PeerSummary {
  socket: WebSocket;
  alive: boolean;
}

interface SignalingOptions {
  roomName: string;
  hostName: string;
  password?: string;
  onMemberCountChanged?: (count: number) => void;
}

interface JoinMessage {
  type: "join";
  roomId?: string;
  password?: string;
  peerId: string;
  name: string;
}

interface RelayMessage {
  type: "signal" | "control";
  to: string;
  payload: unknown;
}

interface StatusMessage {
  type: "status";
  sharing: boolean;
  paused: boolean;
  quality: "balanced" | "sharp" | "smooth";
}

interface ChatSendMessage {
  type: "chat";
  text: string;
}

interface AnnotationMessage {
  type: "annotation";
  targetPeerId: string;
  tool: "pulse" | "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

type ClientMessage =
  | JoinMessage
  | RelayMessage
  | StatusMessage
  | ChatSendMessage
  | AnnotationMessage
  | { type: "ping" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeName(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim().slice(0, 32) || fallback : fallback;
}

function clamp01(value: unknown): number {
  const number = typeof value === "number" ? value : 0;
  return Math.min(1, Math.max(0, number));
}

function safeSend(socket: WebSocket, message: unknown): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

export class SignalingServer {
  private readonly members = new Map<string, Member>();
  private readonly clients = new Map<WebSocket, string>();
  private readonly passwordSalt = randomBytes(16);
  private readonly passwordHash: Buffer | null;
  private readonly chatHistory: ChatMessage[] = [];
  private readonly heartbeatTimer: NodeJS.Timeout;
  private readonly authTimer: NodeJS.Timeout;
  readonly roomId = randomUUID();
  readonly room: RoomSummary;

  private constructor(
    private readonly wss: WebSocketServer,
    private readonly signalingPort: number,
    options: SignalingOptions
  ) {
    this.room = {
      id: this.roomId,
      name: options.roomName,
      hasPassword: Boolean(options.password),
      hostName: options.hostName
    };
    this.passwordHash = options.password
      ? scryptSync(options.password, this.passwordSalt, 32)
      : null;
    this.onMemberCount = options.onMemberCountChanged;

    wss.on("connection", (socket) => this.handleConnection(socket));
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 15_000);
    this.authTimer = setInterval(() => {
      for (const socket of this.clients.keys()) {
        if (!this.clients.get(socket)) {
          socket.close(4008, "Authentication timeout");
        }
      }
    }, 10_000);
  }

  static async start(options: SignalingOptions): Promise<SignalingServer> {
    const wss = new WebSocketServer({
      host: "0.0.0.0",
      port: 0,
      maxPayload: MAX_MESSAGE_BYTES
    });

    await new Promise<void>((resolve, reject) => {
      wss.once("listening", resolve);
      wss.once("error", reject);
    });

    const address = wss.address();
    if (!address || typeof address === "string") {
      wss.close();
      throw new Error("无法分配信令端口");
    }
    return new SignalingServer(wss, address.port, options);
  }

  get port(): number {
    return this.signalingPort;
  }

  get memberCount(): number {
    return this.members.size;
  }

  async close(): Promise<void> {
    clearInterval(this.heartbeatTimer);
    clearInterval(this.authTimer);
    for (const member of this.members.values()) {
      member.socket.close(1001, "Room closed");
    }
    this.members.clear();
    this.clients.clear();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  private handleConnection(socket: WebSocket): void {
    this.clients.set(socket, "");
    let joined = false;

    socket.on("pong", () => {
      const id = this.clients.get(socket);
      if (id) {
        const member = this.members.get(id);
        if (member) {
          member.alive = true;
        }
      }
    });

    socket.on("message", (data) => {
      const payload = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data);
      if (payload.byteLength > MAX_MESSAGE_BYTES) {
        socket.close(1009, "Message too large");
        return;
      }

      let message: ClientMessage;
      try {
        const parsed = JSON.parse(payload.toString("utf8"));
        if (!isRecord(parsed) || typeof parsed.type !== "string") {
          throw new Error("Invalid message");
        }
        message = parsed as unknown as ClientMessage;
      } catch {
        safeSend(socket, { type: "error", code: "bad_message", message: "消息格式错误" });
        return;
      }

      if (!joined) {
        if (message.type !== "join") {
          safeSend(socket, { type: "error", code: "join_required", message: "请先加入房间" });
          return;
        }
        if (this.join(socket, message)) {
          joined = true;
        }
        return;
      }

      const peerId = this.clients.get(socket);
      const member = peerId ? this.members.get(peerId) : undefined;
      if (!peerId || !member) {
        return;
      }
      this.handleRoomMessage(member, message);
    });

    socket.on("close", () => {
      const peerId = this.clients.get(socket);
      this.clients.delete(socket);
      if (peerId && this.members.delete(peerId)) {
        this.broadcast({ type: "peer-left", peerId });
        this.broadcastRoomState();
        this.notifyMemberCount();
      }
    });

    socket.on("error", (error) => {
      console.warn("[signaling] client socket error:", error.message);
    });
  }

  private join(socket: WebSocket, message: JoinMessage): boolean {
    if (message.roomId && message.roomId !== this.roomId) {
      safeSend(socket, { type: "error", code: "room_not_found", message: "房间不存在" });
      socket.close(4004, "Room not found");
      return false;
    }

    if (this.passwordHash && !this.checkPassword(message.password)) {
      safeSend(socket, { type: "error", code: "bad_password", message: "房间密码错误" });
      socket.close(4003, "Bad password");
      return false;
    }

    const peerId = normalizeName(message.peerId);
    const name = normalizeName(message.name, "访客");
    if (!peerId || peerId.length > 80) {
      safeSend(socket, { type: "error", code: "bad_peer", message: "设备标识无效" });
      socket.close(4000, "Bad peer");
      return false;
    }
    if (this.members.has(peerId)) {
      safeSend(socket, { type: "error", code: "duplicate_peer", message: "设备已在房间中" });
      socket.close(4009, "Duplicate peer");
      return false;
    }

    const member: Member = {
      id: peerId,
      name,
      joinedAt: Date.now(),
      sharing: false,
      paused: false,
      quality: "balanced",
      socket,
      alive: true
    };
    this.members.set(peerId, member);
    this.clients.set(socket, peerId);
    this.broadcastRoomState();
    safeSend(socket, { type: "chat-history", messages: this.chatHistory });
    this.notifyMemberCount();
    return true;
  }

  private handleRoomMessage(member: Member, message: ClientMessage): void {
    switch (message.type) {
      case "signal":
      case "control": {
        if (typeof message.to !== "string" || !this.members.has(message.to)) {
          return;
        }
        const target = this.members.get(message.to);
        if (target) {
          safeSend(target.socket, {
            type: message.type,
            from: member.id,
            payload: message.payload
          });
        }
        return;
      }
      case "status": {
        member.sharing = Boolean(message.sharing);
        member.paused = Boolean(message.paused);
        member.quality = ["balanced", "sharp", "smooth"].includes(message.quality)
          ? message.quality
          : "balanced";
        this.broadcastRoomState();
        return;
      }
      case "chat": {
        const text =
          typeof message.text === "string"
            ? message.text.trim().slice(0, MAX_CHAT_LENGTH)
            : "";
        if (!text) {
          return;
        }
        const chat: ChatMessage = {
          id: randomUUID(),
          peerId: member.id,
          peerName: member.name,
          text,
          sentAt: Date.now()
        };
        this.chatHistory.push(chat);
        if (this.chatHistory.length > MAX_CHAT_HISTORY) {
          this.chatHistory.shift();
        }
        this.broadcast({ type: "chat", message: chat });
        return;
      }
      case "annotation": {
        if (!this.members.has(message.targetPeerId)) {
          return;
        }
        const annotation: IncomingAnnotation = {
          id: randomUUID(),
          targetPeerId: message.targetPeerId,
          tool: message.tool === "arrow" ? "arrow" : "pulse",
          x1: clamp01(message.x1),
          y1: clamp01(message.y1),
          x2: clamp01(message.x2),
          y2: clamp01(message.y2),
          fromPeerId: member.id,
          fromPeerName: member.name,
          createdAt: Date.now()
        };
        this.broadcast({ type: "annotation", annotation });
        return;
      }
      case "ping":
        safeSend(member.socket, { type: "pong" });
        return;
      default:
        return;
    }
  }

  private broadcastRoomState(): void {
    const peers = [...this.members.values()].map<PeerSummary>(
      ({ id, name, joinedAt, sharing, paused, quality }) => ({
        id,
        name,
        joinedAt,
        sharing,
        paused,
        quality
      })
    );

    for (const member of this.members.values()) {
      safeSend(member.socket, {
        type: "room-state",
        selfId: member.id,
        room: this.room,
        peers
      });
    }
  }

  private broadcast(message: unknown): void {
    for (const member of this.members.values()) {
      safeSend(member.socket, message);
    }
  }

  private notifyMemberCount(): void {
    this.onMemberCount?.(this.members.size);
  }

  private onMemberCount?: (count: number) => void;

  private checkPassword(candidate: unknown): boolean {
    if (!this.passwordHash) {
      return true;
    }
    if (typeof candidate !== "string") {
      return false;
    }
    const candidateHash = scryptSync(candidate, this.passwordSalt, 32);
    return (
      candidateHash.length === this.passwordHash.length &&
      timingSafeEqual(candidateHash, this.passwordHash)
    );
  }

  private heartbeat(): void {
    for (const member of this.members.values()) {
      if (!member.alive) {
        member.socket.terminate();
        continue;
      }
      member.alive = false;
      member.socket.ping();
    }
  }
}
