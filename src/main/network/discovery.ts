import dgram, { type RemoteInfo, type Socket } from "node:dgram";
import type { RoomAnnouncement } from "../../shared/types";

export const DISCOVERY_PORT = 42399;
export const DISCOVERY_GROUP = "239.255.42.99";
const ANNOUNCEMENT_INTERVAL_MS = 2_000;
const ROOM_TTL_MS = 7_000;

interface DiscoveryPacket {
  magic: "nearview";
  version: 1;
  type: "announce";
  room: RoomAnnouncement;
}

function isRoomAnnouncement(value: unknown): value is RoomAnnouncement {
  if (!value || typeof value !== "object") {
    return false;
  }

  const room = value as Partial<RoomAnnouncement>;
  return (
    typeof room.id === "string" &&
    typeof room.name === "string" &&
    typeof room.hostName === "string" &&
    typeof room.hostAddress === "string" &&
    typeof room.signalingPort === "number" &&
    typeof room.hasPassword === "boolean" &&
    typeof room.memberCount === "number" &&
    typeof room.createdAt === "number"
  );
}

export class DiscoveryService {
  private socket: Socket | null = null;
  private announcement: RoomAnnouncement | null = null;
  private announceTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private rooms = new Map<string, RoomAnnouncement>();
  private interfaceAddress?: string;

  constructor(private readonly onRoomsChanged: (rooms: RoomAnnouncement[]) => void) {}

  getRooms(): RoomAnnouncement[] {
    return [...this.rooms.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  }

  async start(interfaceAddress?: string): Promise<RoomAnnouncement[]> {
    await this.stop(false);
    this.interfaceAddress = interfaceAddress;
    this.rooms.clear();

    await new Promise<void>((resolve, reject) => {
      const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
      this.socket = socket;

      socket.once("error", reject);
      socket.on("message", (message, remote) => this.handleMessage(message, remote));
      socket.on("listening", () => {
        socket.off("error", reject);
        socket.on("error", (error) => {
          console.warn("[discovery]", error.message);
        });

        try {
          socket.addMembership(DISCOVERY_GROUP, interfaceAddress);
          if (interfaceAddress) {
            socket.setMulticastInterface(interfaceAddress);
          }
          socket.setMulticastTTL(1);
          socket.setMulticastLoopback(true);
        } catch (error) {
          console.warn(
            "[discovery] multicast membership failed:",
            error instanceof Error ? error.message : error
          );
        }

        if (this.announcement) {
          this.sendAnnouncement();
          this.announceTimer = setInterval(
            () => this.sendAnnouncement(),
            ANNOUNCEMENT_INTERVAL_MS
          );
        }
        resolve();
      });

      socket.bind({ port: DISCOVERY_PORT, address: "0.0.0.0", exclusive: false });
    });

    this.cleanupTimer = setInterval(() => this.removeExpiredRooms(), 1_500);
    return this.getRooms();
  }

  setAnnouncement(announcement: RoomAnnouncement | null): void {
    this.announcement = announcement;
    if (this.announceTimer) {
      clearInterval(this.announceTimer);
      this.announceTimer = null;
    }

    if (announcement) {
      this.sendAnnouncement();
      this.announceTimer = setInterval(
        () => this.sendAnnouncement(),
        ANNOUNCEMENT_INTERVAL_MS
      );
    }
  }

  updateMemberCount(memberCount: number): void {
    if (!this.announcement) {
      return;
    }
    this.announcement = {
      ...this.announcement,
      memberCount,
      lastSeen: Date.now()
    };
    this.sendAnnouncement();
  }

  async stop(emit = true): Promise<void> {
    if (this.announceTimer) {
      clearInterval(this.announceTimer);
      this.announceTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    const socket = this.socket;
    this.socket = null;
    this.announcement = null;
    this.rooms.clear();

    if (socket) {
      await new Promise<void>((resolve) => {
        try {
          socket.dropMembership(DISCOVERY_GROUP, this.interfaceAddress);
        } catch {
          // Membership may already be gone if the adapter was unplugged.
        }
        socket.close(() => resolve());
      });
    }
    if (emit) {
      this.onRoomsChanged([]);
    }
  }

  private sendAnnouncement(): void {
    if (!this.socket || !this.announcement) {
      return;
    }

    const packet: DiscoveryPacket = {
      magic: "nearview",
      version: 1,
      type: "announce",
      room: {
        ...this.announcement,
        lastSeen: Date.now()
      }
    };
    const payload = Buffer.from(JSON.stringify(packet));
    this.socket.send(payload, 0, payload.length, DISCOVERY_PORT, DISCOVERY_GROUP, (error) => {
      if (error) {
        console.warn("[discovery] announce failed:", error.message);
      }
    });
  }

  private handleMessage(message: Buffer, remote: RemoteInfo): void {
    if (message.length > 8_192) {
      return;
    }

    try {
      const packet = JSON.parse(message.toString("utf8")) as Partial<DiscoveryPacket>;
      if (
        packet.magic !== "nearview" ||
        packet.version !== 1 ||
        packet.type !== "announce" ||
        !isRoomAnnouncement(packet.room)
      ) {
        return;
      }

      if (packet.room.id === this.announcement?.id) {
        return;
      }

      this.rooms.set(packet.room.id, {
        ...packet.room,
        hostAddress:
          packet.room.hostAddress === "0.0.0.0"
            ? remote.address
            : packet.room.hostAddress,
        lastSeen: Date.now()
      });
      this.onRoomsChanged(this.getRooms());
    } catch {
      // Ignore unrelated multicast traffic on the shared discovery port.
    }
  }

  private removeExpiredRooms(): void {
    const cutoff = Date.now() - ROOM_TTL_MS;
    let changed = false;

    for (const [id, room] of this.rooms) {
      if (room.lastSeen < cutoff) {
        this.rooms.delete(id);
        changed = true;
      }
    }

    if (changed) {
      this.onRoomsChanged(this.getRooms());
    }
  }
}
