import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type KeyboardEvent
} from "react";
import type {
  AnnotationPayload,
  ChatMessage,
  NetworkInterfaceInfo,
  RoomAnnouncement
} from "../../shared/types";
import { CapturePicker } from "./components/CapturePicker";
import { Icon } from "./components/Icon";
import { AnnotatedVideo } from "./components/MediaView";
import {
  useRoom,
  type QualityMode,
  type RoomViewPeer
} from "./hooks/useRoom";

type DialogState =
  | { type: "create" }
  | { type: "manual" }
  | { type: "join"; room: RoomAnnouncement }
  | null;

type AnnotationTool = "off" | "pulse" | "arrow";

const USER_NAME_KEY = "nearview.displayName";
const ADAPTER_KEY = "nearview.interface";
const ROOM_NAMES = ["薄荷", "松果", "山雀", "海盐", "青柠", "云杉", "小满", "白露"];

function defaultDisplayName(): string {
  const stored = localStorage.getItem(USER_NAME_KEY);
  if (stored) {
    return stored;
  }
  const name = `${ROOM_NAMES[Math.floor(Math.random() * ROOM_NAMES.length)]} ${
    Math.floor(Math.random() * 90) + 10
  }`;
  localStorage.setItem(USER_NAME_KEY, name);
  return name;
}

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || "NV";
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}

function qualityLabel(quality: QualityMode): string {
  return quality === "sharp"
    ? "文字优先"
    : quality === "smooth"
      ? "流畅优先"
      : "均衡";
}

function RoomAvatar({ name, sharing }: { name: string; sharing: boolean }) {
  return (
    <span className={`member-avatar ${sharing ? "is-sharing" : ""}`}>
      {initials(name)}
      {sharing ? <i /> : null}
    </span>
  );
}

interface HomeProps {
  displayName: string;
  setDisplayName: (name: string) => void;
  interfaces: NetworkInterfaceInfo[];
  selectedInterface: string;
  setSelectedInterface: (address: string) => void;
  rooms: RoomAnnouncement[];
  busy: boolean;
  onCreate: () => void;
  onManualJoin: () => void;
  onJoinRoom: (room: RoomAnnouncement) => void;
  error: string | null;
  clearError: () => void;
}

function Home({
  displayName,
  setDisplayName,
  interfaces,
  selectedInterface,
  setSelectedInterface,
  rooms,
  busy,
  onCreate,
  onManualJoin,
  onJoinRoom,
  error,
  clearError
}: HomeProps) {
  const currentInterface = interfaces.find(
    (item) => item.address === selectedInterface
  );

  return (
    <div className="home-page">
      <header className="home-topbar">
        <div className="brand">
          <span className="brand-mark">
            <span />
            <span />
            <span />
          </span>
          <span>
            <strong>NearView</strong>
            <small>近屏</small>
          </span>
        </div>
        <div className="profile-field">
          <span className="profile-avatar">{initials(displayName)}</span>
          <label>
            <small>房间内显示为</small>
            <input
              value={displayName}
              maxLength={32}
              onChange={(event) => setDisplayName(event.target.value)}
              aria-label="你的昵称"
            />
          </label>
        </div>
      </header>

      <main className="home-content">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">
              <i className="live-dot" />
              同一局域网，自动发现
            </span>
            <h1>
              打开，
              <br />
              就看到彼此。
            </h1>
            <p>
              不注册、不绕公网。在宿舍、办公室或 Radmin VPN
              虚拟局域网里，一键共享屏幕，把注意力放在同一块画面上。
            </p>
            <div className="hero-actions">
              <button type="button" className="primary-button" onClick={onCreate}>
                <Icon name="plus" size={18} />
                创建房间
              </button>
              <button type="button" className="secondary-button" onClick={onManualJoin}>
                <Icon name="link" size={18} />
                地址加入
              </button>
            </div>
            {error ? (
              <div className="inline-error">
                <span>{error}</span>
                <button type="button" onClick={clearError}>
                  知道了
                </button>
              </div>
            ) : null}
          </div>

          <div className="network-card">
            <div className="network-visual" aria-hidden="true">
              <span className="radar-ring ring-one" />
              <span className="radar-ring ring-two" />
              <span className="radar-ring ring-three" />
              <span className="radar-core">
                <Icon name="wifi" size={22} />
              </span>
              <span className="node node-a" />
              <span className="node node-b" />
              <span className="node node-c" />
            </div>
            <div className="network-details">
              <span className="eyebrow">当前网络</span>
              <select
                value={selectedInterface}
                onChange={(event) => setSelectedInterface(event.target.value)}
                disabled={interfaces.length === 0}
              >
                {interfaces.length === 0 ? (
                  <option value="">未检测到局域网网卡</option>
                ) : null}
                {interfaces.map((item) => (
                  <option key={item.id} value={item.address}>
                    {item.name} · {item.address}
                    {item.virtual ? "（虚拟网卡）" : ""}
                  </option>
                ))}
              </select>
              <div className="network-meta">
                <span>
                  <i className={currentInterface ? "online" : ""} />
                  {currentInterface ? "正在监听局域网" : "等待网络"}
                </span>
                <span>{rooms.length} 个可见房间</span>
              </div>
            </div>
          </div>
        </section>

        <section className="discovery-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">附近</span>
              <h2>可加入的房间</h2>
            </div>
            <span className="auto-refresh">
              <i />
              自动刷新
            </span>
          </div>

          {busy ? (
            <div className="room-list">
              <div className="room-skeleton" />
              <div className="room-skeleton" />
            </div>
          ) : rooms.length > 0 ? (
            <div className="room-list">
              {rooms.map((room) => (
                <button
                  type="button"
                  className="room-card"
                  key={room.id}
                  onClick={() => onJoinRoom(room)}
                >
                  <span className="room-icon">
                    <Icon name="monitor" size={22} />
                  </span>
                  <span className="room-copy">
                    <strong>{room.name}</strong>
                    <small>
                      {room.hostName} · {room.hostAddress}
                    </small>
                  </span>
                  <span className="room-meta">
                    {room.hasPassword ? <Icon name="lock" size={14} /> : null}
                    <span>{room.memberCount} 人</span>
                  </span>
                  <span className="room-enter">
                    <Icon name="arrow" size={18} />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-rooms">
              <span className="empty-illustration">
                <span />
                <span />
                <span />
              </span>
              <div>
                <strong>还没有发现房间</strong>
                <p>请让好友在同一网卡上创建房间。若组播被防火墙拦截，可使用“地址加入”。</p>
              </div>
            </div>
          )}
        </section>

        <footer className="home-footer">
          <span>画面只在设备之间传输</span>
          <span>WebRTC 加密</span>
          <span>兼容 Radmin VPN / ZeroTier / Tailscale</span>
        </footer>
      </main>
    </div>
  );
}

interface ActionDialogProps {
  state: Exclude<DialogState, null>;
  displayName: string;
  interfaces: NetworkInterfaceInfo[];
  selectedInterface: string;
  onClose: () => void;
  onCreate: (roomName: string, password: string) => Promise<void>;
  onJoinDiscovered: (room: RoomAnnouncement, password: string) => Promise<void>;
  onJoinManual: (endpoint: string, password: string) => Promise<void>;
}

function ActionDialog({
  state,
  displayName,
  interfaces,
  selectedInterface,
  onClose,
  onCreate,
  onJoinDiscovered,
  onJoinManual
}: ActionDialogProps) {
  const [roomName, setRoomName] = useState(`${displayName} 的房间`);
  const [endpoint, setEndpoint] = useState("");
  const [password, setPassword] = useState("");
  const [busyState, setBusyState] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusyState(true);
    setError(null);
    try {
      if (state.type === "create") {
        await onCreate(roomName, password);
      } else if (state.type === "manual") {
        await onJoinManual(endpoint, password);
      } else {
        await onJoinDiscovered(state.room, password);
      }
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败，请重试");
    } finally {
      setBusyState(false);
    }
  }

  const title =
    state.type === "create"
      ? "创建局域网房间"
      : state.type === "manual"
        ? "通过地址加入"
        : state.room.name;
  const subtitle =
    state.type === "create"
      ? "另一台设备会在大约 2 秒内看到这个房间。"
      : state.type === "manual"
        ? "输入房主界面里显示的 IP 和信令端口。"
        : `${state.room.hostName} 正在等待你加入。`;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal action-modal"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">{state.type === "create" ? "新建" : "加入"}</span>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>

        {state.type === "create" ? (
          <>
            <label className="field">
              <span>房间名称</span>
              <input
                autoFocus
                value={roomName}
                maxLength={40}
                onChange={(event) => setRoomName(event.target.value)}
                placeholder="例如：设计评审"
              />
            </label>
            <label className="field">
              <span>
                可选密码 <small>留空则附近的人可直接加入</small>
              </span>
              <input
                type="password"
                value={password}
                maxLength={64}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="设置房间密码"
              />
            </label>
            <div className="adapter-summary">
              <Icon name="wifi" size={17} />
              <span>
                使用网卡
                <strong>
                  {interfaces.find((item) => item.address === selectedInterface)?.name ??
                    "自动选择"}
                </strong>
              </span>
              <small>{selectedInterface || "127.0.0.1"}</small>
            </div>
          </>
        ) : state.type === "manual" ? (
          <>
            <label className="field">
              <span>房主地址</span>
              <input
                autoFocus
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                placeholder="26.12.3.4:41000"
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>
                房间密码 <small>没有密码可留空</small>
              </span>
              <input
                type="password"
                value={password}
                maxLength={64}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="可选"
              />
            </label>
          </>
        ) : (
          <>
            <div className="join-room-summary">
              <span className="room-icon">
                <Icon name="monitor" size={22} />
              </span>
              <span>
                <strong>{state.room.name}</strong>
                <small>
                  {state.room.hostAddress}:{state.room.signalingPort} ·{" "}
                  {state.room.memberCount} 人
                </small>
              </span>
              {state.room.hasPassword ? (
                <span className="security-pill">
                  <Icon name="lock" size={13} />
                  私密
                </span>
              ) : null}
            </div>
            {state.room.hasPassword ? (
              <label className="field">
                <span>房间密码</span>
                <input
                  autoFocus
                  type="password"
                  value={password}
                  maxLength={64}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="输入房主提供的密码"
                />
              </label>
            ) : null}
          </>
        )}

        {error ? <p className="form-error">{error}</p> : null}

        <div className="modal-actions">
          <button type="button" className="text-button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary-button" disabled={busyState}>
            {busyState
              ? "正在连接…"
              : state.type === "create"
                ? "创建并进入"
                : "加入房间"}
            {!busyState ? <Icon name="arrow" size={17} /> : null}
          </button>
        </div>
      </form>
    </div>
  );
}

interface StreamTileProps {
  name: string;
  stream: MediaStream | null;
  isLocal?: boolean;
  sharing: boolean;
  paused: boolean;
  focused?: boolean;
  annotations?: ComponentProps<typeof AnnotatedVideo>["annotations"];
  annotationTool?: AnnotationTool;
  onAnnotate?: ComponentProps<typeof AnnotatedVideo>["onAnnotate"];
  onFocus?: () => void;
}

function StreamTile({
  name,
  stream,
  isLocal = false,
  sharing,
  paused,
  focused = false,
  annotations,
  annotationTool,
  onAnnotate,
  onFocus
}: StreamTileProps) {
  return (
    <article
      className={`stream-tile ${stream ? "has-stream" : "is-idle"} ${
        focused ? "is-focused" : ""
      }`}
    >
      {stream ? (
        <AnnotatedVideo
          stream={stream}
          muted={isLocal}
          paused={paused}
          annotations={annotations}
          annotationTool={annotationTool}
          onAnnotate={onAnnotate}
          onClick={onFocus}
        />
      ) : (
        <div className="idle-visual">
          <RoomAvatar name={name} sharing={sharing} />
          <strong>{name}</strong>
          <span>{sharing ? "正在准备画面" : "在线 · 尚未共享"}</span>
        </div>
      )}
      <div className="tile-badge">
        <span className="tile-avatar">{initials(name)}</span>
        <span>{isLocal ? `${name}（你）` : name}</span>
        {stream ? (
          <span className={`share-state ${paused ? "paused" : ""}`}>
            <i />
            {paused ? "已暂停" : "正在共享"}
          </span>
        ) : null}
      </div>
      {stream ? (
        <span className="expand-hint">
          <Icon name="expand" size={15} />
          点击聚焦
        </span>
      ) : null}
    </article>
  );
}

interface RoomChromeProps {
  room: NonNullable<ReturnType<typeof useRoom>["room"]>;
  peers: RoomViewPeer[];
  messages: ChatMessage[];
  localStream: MediaStream | null;
  quality: QualityMode;
  paused: boolean;
  annotations: ComponentProps<typeof AnnotatedVideo>["annotations"];
  annotationTool: AnnotationTool;
  setAnnotationTool: (tool: AnnotationTool) => void;
  focusedPeerId: string | null;
  setFocusedPeerId: (id: string | null) => void;
  onLeave: () => void;
  onOpenCapture: () => void;
  onStopShare: () => void;
  onTogglePause: () => void;
  onChangeQuality: (quality: QualityMode) => void;
  onSendChat: (text: string) => void;
  onSendClipboard: () => Promise<void>;
  onAnnotate: (
    targetPeerId: string,
    annotation: Omit<AnnotationPayload, "targetPeerId">
  ) => void;
  setError: (message: string | null) => void;
}

function RoomView({
  room,
  peers,
  messages,
  localStream,
  quality,
  paused,
  annotations,
  annotationTool,
  setAnnotationTool,
  focusedPeerId,
  setFocusedPeerId,
  onLeave,
  onOpenCapture,
  onStopShare,
  onTogglePause,
  onChangeQuality,
  onSendChat,
  onSendClipboard,
  onAnnotate,
  setError
}: RoomChromeProps) {
  const [chatDraft, setChatDraft] = useState("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const focusVideoRef = useRef<HTMLVideoElement | null>(null);

  const focusedPeer = peers.find((peer) => peer.id === focusedPeerId) ?? null;
  const sharingPeers = peers.filter((peer) => peer.stream && peer.sharing);
  const selfName = room.selfName;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    if (focusedPeerId && (!focusedPeer?.stream || !focusedPeer.sharing)) {
      setFocusedPeerId(null);
    }
  }, [focusedPeer?.sharing, focusedPeer?.stream, focusedPeerId, setFocusedPeerId]);

  function sendMessage() {
    const text = chatDraft.trim();
    if (!text) {
      return;
    }
    onSendChat(text);
    setChatDraft("");
  }

  function handleChatKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      sendMessage();
    }
  }

  async function copyText(text: string) {
    await window.nearview.writeClipboard(text);
  }

  async function togglePictureInPicture() {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (focusVideoRef.current) {
        await focusVideoRef.current.requestPictureInPicture();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法开启画中画");
    }
  }

  const endpoint = room.wsUrl.replace(/^wss?:\/\//i, "");
  const gridColumns =
    sharingPeers.length + (localStream ? 1 : 0) <= 1
      ? "single"
      : sharingPeers.length + (localStream ? 1 : 0) <= 2
        ? "double"
        : "multi";

  return (
    <div className="room-page">
      <header className="room-header">
        <div className="room-title-block">
          <span className="brand-mark small">
            <span />
            <span />
            <span />
          </span>
          <div>
            <div className="room-title-line">
              <h1>{room.name}</h1>
              {room.hasPassword ? <Icon name="lock" size={14} /> : null}
            </div>
            <span className={`room-status status-${room.status}`}>
              <i />
              {room.status === "connected"
                ? `${peers.length + 1} 人在房间`
                : room.status === "joining"
                  ? "正在连接"
                  : "连接已断开"}
            </span>
          </div>
        </div>

        <div className="room-header-actions">
          <div className="quality-switch" aria-label="画质模式">
            {(["sharp", "balanced", "smooth"] as QualityMode[]).map((mode) => (
              <button
                type="button"
                key={mode}
                className={quality === mode ? "active" : ""}
                onClick={() => onChangeQuality(mode)}
                title={
                  mode === "sharp"
                    ? "1080p，优化文字清晰度"
                    : mode === "smooth"
                      ? "720p 60fps，优化动态画面"
                      : "1600×900，画质与性能均衡"
                }
              >
                {qualityLabel(mode)}
              </button>
            ))}
          </div>
          <button
            className="icon-button invite-button"
            type="button"
            title={`复制邀请地址 ${endpoint}`}
            onClick={() => void copyText(endpoint)}
          >
            <Icon name="link" />
          </button>
          <button className="leave-button" type="button" onClick={onLeave}>
            离开
          </button>
        </div>
      </header>

      {room.status !== "connected" ? (
        <div className="connection-banner">
          <Icon name="signal" size={17} />
          {room.status === "joining" ? "正在与房主建立连接…" : "与房主的连接已断开"}
          {room.status !== "joining" ? (
            <button type="button" onClick={onLeave}>
              返回
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="room-body">
        <main className="stage" ref={stageRef}>
          <div className="stage-toolbar">
            <div>
              <button
                type="button"
                className={`tool-button ${!focusedPeer ? "active" : ""}`}
                onClick={() => setFocusedPeerId(null)}
              >
                <Icon name="grid" size={16} />
                宫格
              </button>
              <span className="toolbar-divider" />
              <span className="annotation-label-text">画面标注</span>
              <button
                type="button"
                className={`tool-button ${annotationTool === "pulse" ? "active" : ""}`}
                onClick={() =>
                  setAnnotationTool(annotationTool === "pulse" ? "off" : "pulse")
                }
                disabled={sharingPeers.length === 0}
              >
                <Icon name="spark" size={16} />
                光圈
              </button>
              <button
                type="button"
                className={`tool-button ${annotationTool === "arrow" ? "active" : ""}`}
                onClick={() =>
                  setAnnotationTool(annotationTool === "arrow" ? "off" : "arrow")
                }
                disabled={sharingPeers.length === 0}
              >
                <Icon name="arrow" size={16} />
                箭头
              </button>
            </div>
            {localStream ? (
              <div className="sharing-actions">
                <button
                  type="button"
                  className={`tool-button ${paused ? "warning" : ""}`}
                  onClick={onTogglePause}
                >
                  <Icon name={paused ? "play" : "pause"} size={16} />
                  {paused ? "继续画面" : "隐私暂停"}
                </button>
                <button type="button" className="stop-share" onClick={onStopShare}>
                  停止共享
                </button>
              </div>
            ) : (
              <button type="button" className="share-button" onClick={onOpenCapture}>
                <span className="share-button-icon">
                  <Icon name="monitor" size={18} />
                </span>
                共享我的屏幕
              </button>
            )}
          </div>

          {focusedPeer?.stream && focusedPeer.sharing ? (
            <section className="focus-stage">
              <div className="focus-heading">
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setFocusedPeerId(null)}
                >
                  <Icon name="back" />
                </button>
                <div>
                  <strong>{focusedPeer.name}</strong>
                  <span>
                    {focusedPeer.paused
                      ? "已暂停共享"
                      : `${qualityLabel(focusedPeer.quality)} · P2P 连接`}
                  </span>
                </div>
                <div className="focus-actions">
                  <button
                    type="button"
                    className={`tool-button ${
                      annotationTool !== "off" ? "active" : ""
                    }`}
                    onClick={() =>
                      setAnnotationTool(annotationTool === "off" ? "pulse" : "off")
                    }
                  >
                    <Icon name="spark" size={16} />
                    标注
                  </button>
                  <button type="button" className="tool-button" onClick={togglePictureInPicture}>
                    <Icon name="pip" size={16} />
                    画中画
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => void stageRef.current?.requestFullscreen()}
                  >
                    <Icon name="expand" />
                  </button>
                </div>
              </div>
              <AnnotatedVideo
                stream={focusedPeer.stream}
                paused={focusedPeer.paused}
                className="focus-video"
                videoRef={focusVideoRef}
                annotations={annotations?.filter(
                  (item) => item.targetPeerId === focusedPeer.id
                )}
                annotationTool={annotationTool}
                onAnnotate={(annotation) =>
                  onAnnotate(focusedPeer.id, annotation)
                }
              />
              <div className="focus-caption">
                <span>
                  <i className={focusedPeer.paused ? "paused" : ""} />
                  来自 {focusedPeer.name}
                </span>
                <span>只在局域网设备间传输</span>
              </div>
            </section>
          ) : (
            <section className={`stream-grid grid-${gridColumns}`}>
              {localStream ? (
                <StreamTile
                  name={selfName}
                  stream={localStream}
                  isLocal
                  sharing
                  paused={paused}
                />
              ) : null}
              {peers.filter((peer) => peer.stream && peer.sharing).map((peer) => (
                <StreamTile
                  key={peer.id}
                  name={peer.name}
                  stream={peer.stream}
                  sharing={peer.sharing}
                  paused={peer.paused}
                  annotations={annotations?.filter(
                    (item) => item.targetPeerId === peer.id
                  )}
                  annotationTool={annotationTool}
                  onAnnotate={(annotation) => onAnnotate(peer.id, annotation)}
                  onFocus={
                    peer.stream ? () => setFocusedPeerId(peer.id) : undefined
                  }
                />
              ))}
              {!localStream && !peers.some((peer) => peer.stream && peer.sharing) ? (
                <div className="empty-stage-note">
                  <span className="empty-screen-icon">
                    <Icon name="monitor" size={28} />
                  </span>
                  <strong>房间很安静</strong>
                  <p>点击右上角共享屏幕，其他人会立刻看到你的画面。</p>
                </div>
              ) : null}
            </section>
          )}
        </main>

        <aside className="room-sidebar">
          <section className="members-panel">
            <div className="sidebar-heading">
              <span>
                成员 <strong>{peers.length + 1}</strong>
              </span>
              <span className="secure-badge">
                <Icon name="lock" size={12} />
                端到端媒体
              </span>
            </div>
            <div className="member-list">
              <div className="member-row">
                <RoomAvatar
                  name={room.isHost ? room.hostName : selfName}
                  sharing={Boolean(localStream)}
                />
                <span className="member-copy">
                  <strong>{room.isHost ? room.hostName : selfName}</strong>
                  <small>{room.isHost ? "房主" : "你"}</small>
                </span>
                <span className="member-state">
                  {localStream ? (paused ? "已暂停" : "共享中") : "在线"}
                </span>
              </div>
              {peers.map((peer) => (
                <div className="member-row" key={peer.id}>
                  <RoomAvatar name={peer.name} sharing={peer.sharing} />
                  <span className="member-copy">
                    <strong>{peer.name}</strong>
                    <small>{peer.connectionState === "connected" ? "已连接" : "连接中"}</small>
                  </span>
                  <span className={`member-state ${peer.sharing ? "sharing" : ""}`}>
                    {peer.sharing ? (peer.paused ? "已暂停" : "共享中") : "在线"}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="chat-panel">
            <div className="sidebar-heading chat-heading">
              <span>房间消息</span>
              <button
                type="button"
                className="clipboard-button"
                title="发送剪贴板文本"
                onClick={() =>
                  void onSendClipboard()
                    .then(() => setError(null))
                    .catch((reason: unknown) =>
                      setError(
                        reason instanceof Error ? reason.message : "读取剪贴板失败"
                      )
                    )
                }
              >
                <Icon name="clipboard" size={15} />
                粘贴发送
              </button>
            </div>
            <div className="chat-list">
              {messages.length === 0 ? (
                <div className="chat-empty">
                  <Icon name="spark" size={20} />
                  <p>把报错、代码片段或链接直接贴在这里，不必再开聊天软件。</p>
                </div>
              ) : (
                messages.map((message) => {
                  const mine = message.peerId === room.selfId;
                  return (
                    <div
                      className={`chat-message ${mine ? "mine" : ""}`}
                      key={message.id}
                    >
                      <div className="chat-meta">
                        <strong>{mine ? "你" : message.peerName}</strong>
                        <span>{formatTime(message.sentAt)}</span>
                        <button
                          type="button"
                          title="复制"
                          onClick={() => void copyText(message.text)}
                        >
                          <Icon name="clipboard" size={12} />
                        </button>
                      </div>
                      <p>{message.text}</p>
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="chat-composer">
              <textarea
                value={chatDraft}
                onChange={(event) => setChatDraft(event.target.value)}
                onKeyDown={handleChatKey}
                placeholder="发送消息…"
                rows={2}
                maxLength={4000}
              />
              <button
                type="button"
                className="send-button"
                onClick={sendMessage}
                disabled={!chatDraft.trim()}
              >
                <Icon name="send" size={16} />
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

export default function App() {
  const [displayName, setDisplayNameState] = useState(defaultDisplayName);
  const [interfaces, setInterfaces] = useState<NetworkInterfaceInfo[]>([]);
  const [selectedInterface, setSelectedInterfaceState] = useState(
    () => localStorage.getItem(ADAPTER_KEY) ?? ""
  );
  const [discoveredRooms, setDiscoveredRooms] = useState<RoomAnnouncement[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [homeBusy, setHomeBusy] = useState(false);
  const [focusedPeerId, setFocusedPeerId] = useState<string | null>(null);
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>("off");
  const roomController = useRoom();
  const { room, peers, localStream, quality, paused } = roomController;

  useEffect(() => {
    let active = true;
    window.nearview
      .getNetworkInterfaces()
      .then((items) => {
        if (!active) {
          return;
        }
        setInterfaces(items);
        setSelectedInterfaceState((current) => {
          if (items.some((item) => item.address === current)) {
            return current;
          }
          return items[0]?.address ?? "";
        });
      })
      .catch((reason: unknown) => {
        roomController.setError(
          reason instanceof Error ? reason.message : "读取网络网卡失败"
        );
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return window.nearview.onDiscoveredRooms(setDiscoveredRooms);
  }, []);

  useEffect(() => {
    if (!selectedInterface) {
      return;
    }
    window.nearview
      .startDiscovery(selectedInterface)
      .then(setDiscoveredRooms)
      .catch((reason: unknown) =>
        roomController.setError(
          reason instanceof Error ? reason.message : "启动局域网发现失败"
        )
      );
  }, [selectedInterface]);

  const sortedRooms = useMemo(
    () => [...discoveredRooms].sort((a, b) => b.memberCount - a.memberCount),
    [discoveredRooms]
  );

  function setDisplayName(name: string) {
    setDisplayNameState(name);
    localStorage.setItem(USER_NAME_KEY, name);
  }

  function setSelectedInterface(address: string) {
    setSelectedInterfaceState(address);
    localStorage.setItem(ADAPTER_KEY, address);
  }

  async function createRoom(roomName: string, password: string) {
    setHomeBusy(true);
    try {
      await roomController.createRoom({
        roomName,
        password: password || undefined,
        displayName,
        interfaceAddress: selectedInterface
      });
    } finally {
      setHomeBusy(false);
    }
  }

  async function joinDiscovered(roomItem: RoomAnnouncement, password: string) {
    setHomeBusy(true);
    try {
      await roomController.joinDiscoveredRoom(
        roomItem,
        password || undefined,
        displayName
      );
    } finally {
      setHomeBusy(false);
    }
  }

  async function joinManual(endpoint: string, password: string) {
    setHomeBusy(true);
    try {
      await roomController.joinManualRoom(
        endpoint,
        password || undefined,
        displayName
      );
    } finally {
      setHomeBusy(false);
    }
  }

  async function leaveRoom() {
    setFocusedPeerId(null);
    setAnnotationTool("off");
    await roomController.leaveRoom();
  }

  async function changeQuality(mode: QualityMode) {
    try {
      await roomController.applyQuality(mode);
    } catch (reason) {
      roomController.setError(
        reason instanceof Error ? reason.message : "切换画质失败"
      );
    }
  }

  async function togglePause() {
    try {
      await roomController.toggleFreeze();
    } catch (reason) {
      roomController.setError(
        reason instanceof Error ? reason.message : "无法暂停画面"
      );
    }
  }

  if (!room) {
    return (
      <>
        <Home
          displayName={displayName}
          setDisplayName={setDisplayName}
          interfaces={interfaces}
          selectedInterface={selectedInterface}
          setSelectedInterface={setSelectedInterface}
          rooms={sortedRooms}
          busy={homeBusy}
          onCreate={() => setDialog({ type: "create" })}
          onManualJoin={() => setDialog({ type: "manual" })}
          onJoinRoom={(roomItem) => setDialog({ type: "join", room: roomItem })}
          error={roomController.error}
          clearError={() => roomController.setError(null)}
        />
        {dialog ? (
          <ActionDialog
            state={dialog}
            displayName={displayName}
            interfaces={interfaces}
            selectedInterface={selectedInterface}
            onClose={() => setDialog(null)}
            onCreate={createRoom}
            onJoinDiscovered={joinDiscovered}
            onJoinManual={joinManual}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <RoomView
        room={room}
        peers={peers}
        messages={roomController.messages}
        localStream={localStream}
        quality={quality}
        paused={paused}
        annotations={roomController.annotations}
        annotationTool={annotationTool}
        setAnnotationTool={setAnnotationTool}
        focusedPeerId={focusedPeerId}
        setFocusedPeerId={setFocusedPeerId}
        onLeave={() => void leaveRoom()}
        onOpenCapture={() => setCaptureOpen(true)}
        onStopShare={() =>
          void roomController.stopShare().catch((reason: unknown) =>
            roomController.setError(
              reason instanceof Error ? reason.message : "停止共享失败"
            )
          )
        }
        onTogglePause={() => void togglePause()}
        onChangeQuality={(mode) => void changeQuality(mode)}
        onSendChat={roomController.sendChat}
        onSendClipboard={roomController.sendClipboard}
        onAnnotate={(targetPeerId, annotation) =>
          roomController.sendAnnotation({ targetPeerId, ...annotation })
        }
        setError={roomController.setError}
      />
      {captureOpen ? (
        <CapturePicker
          onClose={() => setCaptureOpen(false)}
          onSelect={roomController.startShare}
        />
      ) : null}
      {roomController.error ? (
        <div className="toast" role="alert">
          <span>{roomController.error}</span>
          <button type="button" onClick={() => roomController.setError(null)}>
            <Icon name="close" size={16} />
          </button>
        </div>
      ) : null}
    </>
  );
}
