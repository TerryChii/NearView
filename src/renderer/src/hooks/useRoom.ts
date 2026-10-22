import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AnnotationPayload,
  ChatMessage,
  IncomingAnnotation,
  PeerSummary,
  RoomAnnouncement
} from "../../../shared/types";

export type QualityMode = "balanced" | "sharp" | "smooth";
export type RoomConnectionStatus =
  | "idle"
  | "joining"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface RoomViewPeer extends PeerSummary {
  stream: MediaStream | null;
  connectionState: RTCPeerConnectionState;
}

export interface ActiveRoom {
  id: string;
  name: string;
  hostName: string;
  hasPassword: boolean;
  selfId: string;
  isHost: boolean;
  selfName: string;
  wsUrl: string;
  status: RoomConnectionStatus;
}

interface JoinOptions {
  wsUrl: string;
  roomId?: string;
  password?: string;
  displayName: string;
  isHost: boolean;
  roomName?: string;
  hostName?: string;
  hasPassword?: boolean;
}

interface PeerRuntime {
  summary: PeerSummary;
  pc: RTCPeerConnection;
  remoteStream: MediaStream;
  channel: RTCDataChannel | null;
  videoSender: RTCRtpSender | null;
  audioSender: RTCRtpSender | null;
  pendingCandidates: RTCIceCandidateInit[];
  makingOffer: boolean;
  connectionState: RTCPeerConnectionState;
  ready: Promise<void>;
}

interface ServerRoomState {
  type: "room-state";
  selfId: string;
  room: {
    id: string;
    name: string;
    hostName: string;
    hasPassword: boolean;
  };
  peers: PeerSummary[];
}

interface PendingJoin {
  resolve: () => void;
  reject: (reason: Error) => void;
  timeout: number;
}

interface PlaceholderMedia {
  videoTrack: MediaStreamTrack;
  audioTrack: MediaStreamTrack | null;
  audioContext: AudioContext | null;
  refreshTimer: number;
}

const QUALITY_SETTINGS: Record<
  QualityMode,
  {
    width: number;
    height: number;
    frameRate: number;
    maxBitrate: number;
    contentHint: "detail" | "motion";
  }
> = {
  sharp: {
    width: 1920,
    height: 1080,
    frameRate: 30,
    maxBitrate: 10_000_000,
    contentHint: "detail"
  },
  balanced: {
    width: 1600,
    height: 900,
    frameRate: 30,
    maxBitrate: 6_000_000,
    contentHint: "detail"
  },
  smooth: {
    width: 1280,
    height: 720,
    frameRate: 60,
    maxBitrate: 8_000_000,
    contentHint: "motion"
  }
};

function createPeerId(): string {
  const key = "nearview.peerId";
  const existing = localStorage.getItem(key);
  if (existing) {
    return existing;
  }
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

function normalizeManualEndpoint(input: string): string {
  const trimmed = input.trim();
  const value = /^wss?:\/\//i.test(trimmed) ? trimmed : `ws://${trimmed}`;
  const url = new URL(value);
  if (!url.port) {
    throw new Error("请输入带端口的地址，例如 26.12.3.4:41000");
  }
  return url.toString();
}

export function useRoom() {
  const [room, setRoom] = useState<ActiveRoom | null>(null);
  const [peers, setPeers] = useState<RoomViewPeer[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [annotations, setAnnotations] = useState<IncomingAnnotation[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [quality, setQualityState] = useState<QualityMode>("balanced");
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const peerIdRef = useRef(createPeerId());
  const roomRef = useRef<ActiveRoom | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const peersRef = useRef(new Map<string, PeerRuntime>());
  const localStreamRef = useRef<MediaStream | null>(null);
  const pausedTrackRef = useRef<MediaStreamTrack | null>(null);
  const freezeTimerRef = useRef<number | null>(null);
  const intentionalCloseRef = useRef(false);
  const initialStatusSentRef = useRef(false);
  const annotationTimersRef = useRef(new Map<string, number>());
  const qualityRef = useRef<QualityMode>("balanced");
  const pausedRef = useRef(false);
  const pendingJoinRef = useRef<PendingJoin | null>(null);
  const placeholderRef = useRef<PlaceholderMedia | null>(null);
  const roomStateReadyRef = useRef<Promise<void>>(Promise.resolve());
  const resolveRoomStateReadyRef = useRef<(() => void) | null>(null);

  const getPlaceholderMedia = useCallback((): PlaceholderMedia => {
    const existing = placeholderRef.current;
    if (existing) {
      return existing;
    }

    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#0b0d0c";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    const videoTrack = canvas.captureStream(1).getVideoTracks()[0];

    let audioContext: AudioContext | null = null;
    let audioTrack: MediaStreamTrack | null = null;
    try {
      audioContext = new AudioContext();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const destination = audioContext.createMediaStreamDestination();
      gain.gain.value = 0;
      oscillator.connect(gain);
      gain.connect(destination);
      oscillator.start();
      audioTrack = destination.stream.getAudioTracks()[0] ?? null;
      void audioContext.resume().catch(() => undefined);
    } catch {
      audioContext = null;
      audioTrack = null;
    }

    const refreshTimer = window.setInterval(() => {
      if (context) {
        context.fillStyle = "#0b0d0c";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
    }, 5_000);
    const media = { videoTrack, audioTrack, audioContext, refreshTimer };
    placeholderRef.current = media;
    return media;
  }, []);

  const disposePlaceholderMedia = useCallback(() => {
    const media = placeholderRef.current;
    placeholderRef.current = null;
    if (!media) {
      return;
    }
    window.clearInterval(media.refreshTimer);
    media.videoTrack.stop();
    media.audioTrack?.stop();
    void media.audioContext?.close();
  }, []);

  const publishPeers = useCallback(() => {
    setPeers(
      [...peersRef.current.values()]
        .map<RoomViewPeer>((peer) => ({
          ...peer.summary,
          stream: peer.remoteStream,
          connectionState: peer.connectionState
        }))
        .sort((a, b) => a.joinedAt - b.joinedAt)
    );
  }, []);

  const updateRoomStatus = useCallback((status: RoomConnectionStatus) => {
    setRoom((current) => (current ? { ...current, status } : current));
    roomRef.current = roomRef.current
      ? { ...roomRef.current, status }
      : roomRef.current;
  }, []);

  const sendWs = useCallback((message: unknown) => {
    const socket = wsRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  const sendStatus = useCallback(
    (override?: {
      sharing?: boolean;
      paused?: boolean;
      quality?: QualityMode;
    }) => {
      sendWs({
        type: "status",
        sharing:
          override?.sharing ?? Boolean(localStreamRef.current),
        paused: override?.paused ?? pausedRef.current,
        quality: override?.quality ?? qualityRef.current
      });
    },
    [sendWs]
  );

  const setupDataChannel = useCallback((runtime: PeerRuntime, channel: RTCDataChannel) => {
    runtime.channel = channel;
    channel.onmessage = () => {
      // Reserved for future low-latency cursor and quality requests.
    };
  }, []);

  const applySenderQuality = useCallback(async (runtime: PeerRuntime) => {
    if (!runtime.videoSender) {
      return;
    }
    const settings = QUALITY_SETTINGS[qualityRef.current];
    try {
      const parameters = runtime.videoSender.getParameters();
      if (!parameters.encodings?.length) {
        parameters.encodings = [{}];
      }
      for (const encoding of parameters.encodings) {
        encoding.maxBitrate = settings.maxBitrate;
      }
      await runtime.videoSender.setParameters(parameters);
    } catch {
      // Some GPU/codec combinations do not allow bitrate changes at runtime.
    }
  }, []);

  const bindNegotiatedSenders = useCallback((runtime: PeerRuntime) => {
    for (const transceiver of runtime.pc.getTransceivers()) {
      const kind = transceiver.receiver.track.kind;
      if (kind === "video" && !runtime.videoSender) {
        runtime.videoSender = transceiver.sender;
      } else if (kind === "audio" && !runtime.audioSender) {
        runtime.audioSender = transceiver.sender;
      }
      if (
        (kind === "video" || kind === "audio") &&
        transceiver.direction === "recvonly"
      ) {
        transceiver.direction = "sendrecv";
      }
    }
  }, []);

  const attachLocalMedia = useCallback(
    async (runtime: PeerRuntime) => {
      bindNegotiatedSenders(runtime);
      const source = localStreamRef.current;
      const fallback = getPlaceholderMedia();
      const videoTrack =
        pausedRef.current && pausedTrackRef.current
          ? pausedTrackRef.current
          : source?.getVideoTracks()[0] ?? fallback.videoTrack;
      const audioTrack = pausedRef.current
        ? null
        : source?.getAudioTracks()[0] ?? fallback.audioTrack;

      await Promise.all([
        runtime.videoSender?.replaceTrack(videoTrack),
        runtime.audioSender?.replaceTrack(audioTrack)
      ]);
      if (localStreamRef.current) {
        await applySenderQuality(runtime);
      }
    },
    [applySenderQuality, bindNegotiatedSenders, getPlaceholderMedia]
  );

  const replaceOutgoingTracks = useCallback(async () => {
    await Promise.all(
      [...peersRef.current.values()].map((runtime) => attachLocalMedia(runtime))
    );
  }, [attachLocalMedia]);

  const negotiate = useCallback(
    async (runtime: PeerRuntime) => {
      if (runtime.makingOffer) {
        return;
      }
      runtime.makingOffer = true;
      try {
        const offer = await runtime.pc.createOffer();
        await runtime.pc.setLocalDescription(offer);
        sendWs({
          type: "signal",
          to: runtime.summary.id,
          payload: { description: runtime.pc.localDescription }
        });
      } catch (reason) {
        console.warn("[rtc] offer failed:", reason);
      } finally {
        runtime.makingOffer = false;
      }
    },
    [sendWs]
  );

  const ensurePeer = useCallback(
    (summary: PeerSummary): PeerRuntime => {
      const existing = peersRef.current.get(summary.id);
      if (existing) {
        existing.summary = { ...existing.summary, ...summary };
        publishPeers();
        return existing;
      }

      const selfId = roomRef.current?.selfId ?? "";
      const shouldInitiate = Boolean(selfId && selfId < summary.id);
      const pc = new RTCPeerConnection({
        iceServers: [],
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require"
      });
      const videoTransceiver = shouldInitiate
        ? pc.addTransceiver("video", { direction: "sendrecv" })
        : null;
      const audioTransceiver = shouldInitiate
        ? pc.addTransceiver("audio", { direction: "sendrecv" })
        : null;
      const runtime: PeerRuntime = {
        summary,
        pc,
        remoteStream: new MediaStream(),
        channel: null,
        videoSender: videoTransceiver?.sender ?? null,
        audioSender: audioTransceiver?.sender ?? null,
        pendingCandidates: [],
        makingOffer: false,
        connectionState: pc.connectionState,
        ready: Promise.resolve()
      };
      peersRef.current.set(summary.id, runtime);

      pc.ontrack = (event) => {
        if (!runtime.remoteStream.getTracks().some((track) => track.id === event.track.id)) {
          runtime.remoteStream.addTrack(event.track);
        }
        event.track.onended = () => {
          if (runtime.remoteStream.getTrackById(event.track.id)) {
            runtime.remoteStream.removeTrack(event.track);
            publishPeers();
          }
        };
        publishPeers();
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendWs({
            type: "signal",
            to: summary.id,
            payload: { candidate: event.candidate.toJSON() }
          });
        }
      };

      pc.onconnectionstatechange = () => {
        runtime.connectionState = pc.connectionState;
        publishPeers();
      };

      pc.ondatachannel = (event) => setupDataChannel(runtime, event.channel);

      runtime.ready = (shouldInitiate
        ? attachLocalMedia(runtime)
        : Promise.resolve())
        .then(() => {
          if (shouldInitiate) {
            setupDataChannel(runtime, pc.createDataChannel("nearview"));
            void negotiate(runtime);
          }
        })
        .catch(() => {
          // The peer may have left while the capture track was being attached.
        });

      publishPeers();
      return runtime;
    },
    [
      attachLocalMedia,
      negotiate,
      publishPeers,
      sendWs,
      setupDataChannel
    ]
  );

  const removePeer = useCallback(
    (peerId: string) => {
      const runtime = peersRef.current.get(peerId);
      if (!runtime) {
        return;
      }
      runtime.pc.close();
      peersRef.current.delete(peerId);
      publishPeers();
    },
    [publishPeers]
  );

  const handleSignal = useCallback(
    async (
      fromPeerId: string,
      payload: {
        description?: RTCSessionDescriptionInit;
        candidate?: RTCIceCandidateInit;
      }
    ) => {
      await roomStateReadyRef.current;
      let runtime = peersRef.current.get(fromPeerId);
      if (!runtime) {
        runtime = ensurePeer({
          id: fromPeerId,
          name: "成员",
          joinedAt: Date.now(),
          sharing: false,
          paused: false,
          quality: "balanced"
        });
      }

      try {
        await runtime.ready;
        if (payload.description) {
          await runtime.pc.setRemoteDescription(payload.description);
          await attachLocalMedia(runtime);
          for (const candidate of runtime.pendingCandidates.splice(0)) {
            await runtime.pc.addIceCandidate(candidate);
          }

          if (payload.description.type === "offer") {
            const answer = await runtime.pc.createAnswer();
            await runtime.pc.setLocalDescription(answer);
            sendWs({
              type: "signal",
              to: fromPeerId,
              payload: { description: runtime.pc.localDescription }
            });
          }
        } else if (payload.candidate) {
          if (runtime.pc.remoteDescription) {
            await runtime.pc.addIceCandidate(payload.candidate);
          } else {
            runtime.pendingCandidates.push(payload.candidate);
          }
        }
      } catch (reason) {
        console.warn("[rtc] signaling failed:", reason);
      }
    },
    [attachLocalMedia, ensurePeer, sendWs]
  );

  const handleServerMessage = useCallback(
    (event: MessageEvent<string>) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        return;
      }

      switch (message.type) {
        case "room-state": {
          const state = message as unknown as ServerRoomState;
          const currentRoom = roomRef.current;
          if (!currentRoom) {
            return;
          }
          const nextRoom: ActiveRoom = {
            ...currentRoom,
            id: state.room.id,
            name: state.room.name,
            hostName: state.room.hostName,
            hasPassword: state.room.hasPassword,
            selfId: state.selfId,
            status: "connected"
          };
          roomRef.current = nextRoom;
          setRoom(nextRoom);

          const remoteIds = new Set<string>();
          for (const summary of state.peers) {
            if (summary.id !== state.selfId) {
              remoteIds.add(summary.id);
              ensurePeer(summary);
            }
          }
          for (const peerId of peersRef.current.keys()) {
            if (!remoteIds.has(peerId)) {
              removePeer(peerId);
            }
          }

          resolveRoomStateReadyRef.current?.();
          resolveRoomStateReadyRef.current = null;

          if (!initialStatusSentRef.current) {
            initialStatusSentRef.current = true;
            sendStatus();
          }
          const pending = pendingJoinRef.current;
          if (pending) {
            window.clearTimeout(pending.timeout);
            pendingJoinRef.current = null;
            pending.resolve();
          }
          return;
        }
        case "signal": {
          if (
            typeof message.from === "string" &&
            message.payload &&
            typeof message.payload === "object"
          ) {
            void handleSignal(
              message.from,
              message.payload as {
                description?: RTCSessionDescriptionInit;
                candidate?: RTCIceCandidateInit;
              }
            );
          }
          return;
        }
        case "peer-left": {
          if (typeof message.peerId === "string") {
            removePeer(message.peerId);
          }
          return;
        }
        case "chat-history": {
          if (Array.isArray(message.messages)) {
            setMessages(message.messages as ChatMessage[]);
          }
          return;
        }
        case "chat": {
          if (message.message && typeof message.message === "object") {
            const chat = message.message as ChatMessage;
            setMessages((current) =>
              current.some((item) => item.id === chat.id)
                ? current
                : [...current, chat].slice(-80)
            );
          }
          return;
        }
        case "annotation": {
          if (message.annotation && typeof message.annotation === "object") {
            const annotation = message.annotation as IncomingAnnotation;
            setAnnotations((current) => [...current, annotation].slice(-30));
            const timer = window.setTimeout(() => {
              setAnnotations((current) =>
                current.filter((item) => item.id !== annotation.id)
              );
              annotationTimersRef.current.delete(annotation.id);
            }, annotation.tool === "pulse" ? 2600 : 5200);
            annotationTimersRef.current.set(annotation.id, timer);
          }
          return;
        }
        case "error": {
          if (typeof message.message === "string") {
            setError(message.message);
            updateRoomStatus("disconnected");
            const pending = pendingJoinRef.current;
            if (pending) {
              window.clearTimeout(pending.timeout);
              pendingJoinRef.current = null;
              pending.reject(new Error(message.message));
            }
          }
          return;
        }
        default:
          return;
      }
    },
    [
      ensurePeer,
      handleSignal,
      removePeer,
      sendStatus,
      updateRoomStatus
    ]
  );

  const resetSession = useCallback(async () => {
    intentionalCloseRef.current = true;
    resolveRoomStateReadyRef.current?.();
    resolveRoomStateReadyRef.current = null;
    const pending = pendingJoinRef.current;
    if (pending) {
      window.clearTimeout(pending.timeout);
      pendingJoinRef.current = null;
      pending.reject(new Error("连接已取消"));
    }
    const socket = wsRef.current;
    wsRef.current = null;
    socket?.close();

    for (const runtime of peersRef.current.values()) {
      runtime.pc.close();
    }
    peersRef.current.clear();
    publishPeers();

    if (freezeTimerRef.current) {
      window.clearInterval(freezeTimerRef.current);
      freezeTimerRef.current = null;
    }
    pausedTrackRef.current?.stop();
    pausedTrackRef.current = null;
    disposePlaceholderMedia();
    for (const track of localStreamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    localStreamRef.current = null;
    setLocalStream(null);
    pausedRef.current = false;
    setPaused(false);
    initialStatusSentRef.current = false;
    setMessages([]);
    setAnnotations([]);
    for (const timer of annotationTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    annotationTimersRef.current.clear();
  }, [disposePlaceholderMedia, publishPeers]);

  const leaveRoom = useCallback(async () => {
    await resetSession();
    await window.nearview.leaveRoom();
    roomRef.current = null;
    setRoom(null);
    setError(null);
  }, [resetSession]);

  const connect = useCallback(
    async (options: JoinOptions, closeExistingHostServer = true) => {
      await resetSession();
      if (closeExistingHostServer) {
        await window.nearview.leaveRoom();
      }
      intentionalCloseRef.current = false;
      setError(null);
      setPeers([]);
      setMessages([]);

      const initialRoom: ActiveRoom = {
        id: options.roomId ?? "",
        name: options.roomName ?? "局域网房间",
        hostName: options.hostName ?? "房主",
        hasPassword: options.hasPassword ?? Boolean(options.password),
        selfId: peerIdRef.current,
        isHost: options.isHost,
        selfName: options.displayName,
        wsUrl: options.wsUrl,
        status: "joining"
      };
      roomRef.current = initialRoom;
      setRoom(initialRoom);
      roomStateReadyRef.current = new Promise<void>((resolve) => {
        resolveRoomStateReadyRef.current = resolve;
      });

      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(options.wsUrl);
        wsRef.current = socket;
        const timeout = window.setTimeout(() => {
          if (pendingJoinRef.current?.timeout === timeout) {
            pendingJoinRef.current = null;
          }
          socket.close();
          reject(new Error("连接房间超时，请检查防火墙或房主地址"));
        }, 8_000);
        pendingJoinRef.current = { resolve, reject, timeout };

        socket.onopen = () => {
          socket.send(
            JSON.stringify({
              type: "join",
              roomId: options.roomId || undefined,
              password: options.password || undefined,
              peerId: peerIdRef.current,
              name: options.displayName.trim().slice(0, 32) || "访客"
            })
          );
          updateRoomStatus("joining");
        };
        socket.onmessage = handleServerMessage;
        socket.onerror = () => {
          const pending = pendingJoinRef.current;
          if (pending) {
            window.clearTimeout(pending.timeout);
            pendingJoinRef.current = null;
            pending.reject(new Error("无法连接房主，请确认地址、端口和防火墙"));
          }
        };
        socket.onclose = () => {
          const pending = pendingJoinRef.current;
          if (pending) {
            window.clearTimeout(pending.timeout);
            pendingJoinRef.current = null;
            pending.reject(new Error("房主关闭了连接或密码校验失败"));
          }
          if (!intentionalCloseRef.current) {
            updateRoomStatus("disconnected");
          }
        };
      }).catch(async (reason: unknown) => {
        await resetSession();
        roomRef.current = null;
        setRoom(null);
        const message =
          reason instanceof Error ? reason.message : "加入房间失败";
        setError(message);
        throw reason;
      });
    },
    [handleServerMessage, resetSession, updateRoomStatus]
  );

  const createRoom = useCallback(
    async (request: {
      roomName: string;
      password?: string;
      displayName: string;
      interfaceAddress?: string;
    }) => {
      const created = await window.nearview.createRoom({
        roomName: request.roomName,
        password: request.password,
        hostName: request.displayName,
        interfaceAddress: request.interfaceAddress
      });
      try {
        await connect({
          wsUrl: created.wsUrl,
          roomId: created.id,
          password: request.password,
          displayName: request.displayName,
          isHost: true,
          roomName: created.name,
          hostName: request.displayName,
          hasPassword: Boolean(request.password)
        }, false);
        return created;
      } catch (reason) {
        await window.nearview.leaveRoom();
        throw reason;
      }
    },
    [connect]
  );

  const joinDiscoveredRoom = useCallback(
    async (
      announcement: RoomAnnouncement,
      password: string | undefined,
      displayName: string
    ) => {
      await connect({
        wsUrl: `ws://${announcement.hostAddress}:${announcement.signalingPort}`,
        roomId: announcement.id,
        password,
        displayName,
        isHost: false,
        roomName: announcement.name,
        hostName: announcement.hostName,
        hasPassword: announcement.hasPassword
      });
    },
    [connect]
  );

  const joinManualRoom = useCallback(
    async (endpoint: string, password: string | undefined, displayName: string) => {
      const wsUrl = normalizeManualEndpoint(endpoint);
      await connect({
        wsUrl,
        password,
        displayName,
        isHost: false
      });
    },
    [connect]
  );

  const applyQuality = useCallback(
    async (mode: QualityMode) => {
      qualityRef.current = mode;
      setQualityState(mode);
      const settings = QUALITY_SETTINGS[mode];
      const videoTrack = localStreamRef.current?.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.contentHint = settings.contentHint;
        try {
          await videoTrack.applyConstraints({
            width: { ideal: settings.width },
            height: { ideal: settings.height },
            frameRate: { ideal: settings.frameRate, max: 60 }
          });
        } catch {
          // Display capture may reject constraints not supported by the GPU.
        }
      }
      await Promise.all(
        [...peersRef.current.values()].map((runtime) =>
          applySenderQuality(runtime)
        )
      );
      sendStatus({ quality: mode });
    },
    [applySenderQuality, sendStatus]
  );

  const startShare = useCallback(
    async (sourceId: string, includeAudio: boolean) => {
      await window.nearview.selectCaptureSource(sourceId);
      const settings = QUALITY_SETTINGS[qualityRef.current];
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: settings.width },
          height: { ideal: settings.height },
          frameRate: { ideal: settings.frameRate, max: 60 }
        },
        audio: includeAudio
      });

      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("没有获取到屏幕画面");
      }
      videoTrack.contentHint = settings.contentHint;
      videoTrack.addEventListener("ended", () => {
        if (localStreamRef.current === stream) {
          void stopShare();
        }
      });

      const previous = localStreamRef.current;
      previous?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = stream;
      setLocalStream(stream);
      pausedRef.current = false;
      setPaused(false);
      await replaceOutgoingTracks();
      await Promise.all(
        [...peersRef.current.values()].map((runtime) =>
          applySenderQuality(runtime)
        )
      );
      sendStatus({ sharing: true, paused: false });
    },
    [applySenderQuality, replaceOutgoingTracks, sendStatus]
  );

  const stopShare = useCallback(async () => {
    const stream = localStreamRef.current;
    localStreamRef.current = null;
    if (freezeTimerRef.current) {
      window.clearInterval(freezeTimerRef.current);
      freezeTimerRef.current = null;
    }
    pausedTrackRef.current?.stop();
    pausedTrackRef.current = null;
    pausedRef.current = false;
    setPaused(false);
    setLocalStream(null);
    stream?.getTracks().forEach((track) => track.stop());
    await replaceOutgoingTracks();
    sendStatus({ sharing: false, paused: false });
  }, [replaceOutgoingTracks, sendStatus]);

  const toggleFreeze = useCallback(async () => {
    const stream = localStreamRef.current;
    const videoTrack = stream?.getVideoTracks()[0];
    if (!stream || !videoTrack) {
      return;
    }

    if (pausedRef.current) {
      pausedRef.current = false;
      setPaused(false);
      if (freezeTimerRef.current) {
        window.clearInterval(freezeTimerRef.current);
        freezeTimerRef.current = null;
      }
      pausedTrackRef.current?.stop();
      disposePlaceholderMedia();
      pausedTrackRef.current = null;
      await replaceOutgoingTracks();
      sendStatus({ paused: false });
      return;
    }

    const freezeVideo = document.createElement("video");
    freezeVideo.muted = true;
    freezeVideo.playsInline = true;
    freezeVideo.srcObject = stream;
    await freezeVideo.play();
    if (!freezeVideo.videoWidth || !freezeVideo.videoHeight) {
      throw new Error("当前画面尚未准备好，请稍后再试");
    }

    const canvas = document.createElement("canvas");
    canvas.width = freezeVideo.videoWidth;
    canvas.height = freezeVideo.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("无法冻结当前画面");
    }
    const draw = () =>
      context.drawImage(
        freezeVideo,
        0,
        0,
        canvas.width,
        canvas.height
      );
    draw();
    const frozenStream = canvas.captureStream(1);
    const frozenTrack = frozenStream.getVideoTracks()[0];
    pausedTrackRef.current = frozenTrack;
    pausedRef.current = true;
    setPaused(true);
    freezeTimerRef.current = window.setInterval(draw, 500);
    await replaceOutgoingTracks();
    sendStatus({ paused: true });
  }, [replaceOutgoingTracks, sendStatus]);

  const sendChat = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed) {
        sendWs({ type: "chat", text: trimmed });
      }
    },
    [sendWs]
  );

  const sendClipboard = useCallback(async () => {
    const text = await window.nearview.readClipboard();
    if (!text.trim()) {
      throw new Error("剪贴板里没有文本");
    }
    sendChat(text);
  }, [sendChat]);

  const sendAnnotation = useCallback(
    (annotation: AnnotationPayload) => {
      sendWs({ type: "annotation", ...annotation });
    },
    [sendWs]
  );

  useEffect(() => {
    const debugWindow = window as Window & {
      __nearviewDiagnostics?: () => Promise<unknown>;
    };
    debugWindow.__nearviewDiagnostics = async () =>
      Promise.all(
        [...peersRef.current.entries()].map(async ([peerId, runtime]) => {
          const stats = await runtime.pc.getStats();
          return {
            peerId,
            connectionState: runtime.pc.connectionState,
            signalingState: runtime.pc.signalingState,
            localSdpMedia:
              runtime.pc.localDescription?.sdp
                .split("\n")
                .filter((line) => /^m=|^a=(send|recv)/.test(line)) ?? [],
            remoteSdpMedia:
              runtime.pc.remoteDescription?.sdp
                .split("\n")
                .filter((line) => /^m=|^a=(send|recv)/.test(line)) ?? [],
            transceivers: runtime.pc.getTransceivers().map((transceiver) => ({
              mid: transceiver.mid,
              direction: transceiver.direction,
              currentDirection: transceiver.currentDirection,
              senderTrack: transceiver.sender.track
                ? {
                    kind: transceiver.sender.track.kind,
                    id: transceiver.sender.track.id,
                    enabled: transceiver.sender.track.enabled,
                    muted: transceiver.sender.track.muted,
                    readyState: transceiver.sender.track.readyState
                  }
                : null,
              receiverTrack: transceiver.receiver.track
                ? {
                    kind: transceiver.receiver.track.kind,
                    id: transceiver.receiver.track.id,
                    enabled: transceiver.receiver.track.enabled,
                    muted: transceiver.receiver.track.muted,
                    readyState: transceiver.receiver.track.readyState
                  }
                : null
            })),
            stats: [...stats.values()]
              .filter(
                (item) =>
                  item.type === "inbound-rtp" ||
                  item.type === "outbound-rtp" ||
                  item.type === "candidate-pair"
              )
              .map((item) => ({
                type: item.type,
                id: item.id,
                kind: "kind" in item ? item.kind : undefined,
                bytesReceived: "bytesReceived" in item ? item.bytesReceived : undefined,
                bytesSent: "bytesSent" in item ? item.bytesSent : undefined,
                framesDecoded: "framesDecoded" in item ? item.framesDecoded : undefined,
                framesEncoded: "framesEncoded" in item ? item.framesEncoded : undefined,
                state: "state" in item ? item.state : undefined
              }))
          };
        })
      );

    return () => {
      delete debugWindow.__nearviewDiagnostics;
      intentionalCloseRef.current = true;
      wsRef.current?.close();
      for (const runtime of peersRef.current.values()) {
        runtime.pc.close();
      }
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      pausedTrackRef.current?.stop();
      if (freezeTimerRef.current) {
        window.clearInterval(freezeTimerRef.current);
      }
      for (const timer of annotationTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
    };
  }, [disposePlaceholderMedia]);

  return {
    room,
    peers,
    messages,
    annotations,
    localStream,
    quality,
    paused,
    error,
    setError,
    createRoom,
    joinDiscoveredRoom,
    joinManualRoom,
    leaveRoom,
    startShare,
    stopShare,
    toggleFreeze,
    applyQuality,
    sendChat,
    sendClipboard,
    sendAnnotation
  };
}
