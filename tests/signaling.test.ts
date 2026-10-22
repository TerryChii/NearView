import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { type RawData } from "ws";
import { SignalingServer } from "../src/main/network/signaling";

const cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanup.length > 0) {
    await cleanup.pop()?.();
  }
});

async function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextMessage(
  socket: WebSocket,
  predicate: (message: Record<string, unknown>) => boolean
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for signaling message"));
    }, 3_000);

    function onMessage(data: RawData) {
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      if (predicate(message)) {
        clearTimeout(timer);
        socket.off("message", onMessage);
        resolve(message);
      }
    }

    socket.on("message", onMessage);
  });
}

describe("SignalingServer", () => {
  it("authenticates members, broadcasts room state, chat and annotations", async () => {
    const server = await SignalingServer.start({
      roomName: "Pair room",
      hostName: "Host",
      password: "correct horse"
    });
    cleanup.push(() => server.close());

    const url = `ws://127.0.0.1:${server.port}`;
    const rejected = await openSocket(url);
    cleanup.push(() => rejected.terminate());
    const rejectedError = nextMessage(
      rejected,
      (message) => message.type === "error"
    );
    rejected.send(
      JSON.stringify({
        type: "join",
        roomId: server.roomId,
        password: "wrong",
        peerId: "rejected-peer",
        name: "Rejected"
      })
    );
    await expect(rejectedError).resolves.toMatchObject({
      code: "bad_password"
    });

    const host = await openSocket(url);
    cleanup.push(() => host.terminate());
    host.send(
      JSON.stringify({
        type: "join",
        roomId: server.roomId,
        password: "correct horse",
        peerId: "host-peer",
        name: "Alice"
      })
    );
    const hostFirstState = await nextMessage(
      host,
      (message) => message.type === "room-state"
    );
    expect(hostFirstState.selfId).toBe("host-peer");
    expect(hostFirstState.peers).toHaveLength(1);

    const guest = await openSocket(url);
    cleanup.push(() => guest.terminate());
    const hostSecondState = nextMessage(
      host,
      (message) =>
        message.type === "room-state" &&
        Array.isArray(message.peers) &&
        message.peers.length === 2
    );
    const guestState = nextMessage(
      guest,
      (message) => message.type === "room-state"
    );
    guest.send(
      JSON.stringify({
        type: "join",
        roomId: server.roomId,
        password: "correct horse",
        peerId: "guest-peer",
        name: "Bob"
      })
    );

    await hostSecondState;
    await expect(guestState).resolves.toMatchObject({
      selfId: "guest-peer",
      room: { name: "Pair room" }
    });

    const hostChat = nextMessage(
      host,
      (message) => message.type === "chat"
    );
    guest.send(JSON.stringify({ type: "chat", text: "const answer = 42;" }));
    await expect(hostChat).resolves.toMatchObject({
      message: {
        peerId: "guest-peer",
        peerName: "Bob",
        text: "const answer = 42;"
      }
    });

    const guestAnnotation = nextMessage(
      guest,
      (message) => message.type === "annotation"
    );
    guest.send(
      JSON.stringify({
        type: "annotation",
        targetPeerId: "host-peer",
        tool: "pulse",
        x1: 0.5,
        y1: 0.4,
        x2: 0.5,
        y2: 0.4
      })
    );
    await expect(guestAnnotation).resolves.toMatchObject({
      annotation: {
        fromPeerId: "guest-peer",
        fromPeerName: "Bob",
        targetPeerId: "host-peer",
        tool: "pulse"
      }
    });
  });
});
