import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type KeyboardEvent
} from "react";
import type {
  AnnotationPayload,
  AppPreferences,
  ChatMessage,
  NetworkMode,
  NetworkInterfaceInfo,
  RoomProbeResult,
  UserProfile
} from "../../shared/types";
import { CapturePicker } from "./components/CapturePicker";
import { Icon } from "./components/Icon";
import { AnnotatedVideo } from "./components/MediaView";
import {
  useRoom,
  type PeerConnectionMetrics,
  type QualityMode,
  type RoomViewPeer
} from "./hooks/useRoom";

type DialogState =
  | { type: "create" }
  | { type: "manual" }
  | null;

type AnnotationTool = "off" | "pulse" | "arrow";

const USER_NAME_KEY = "nearview.displayName";
const PROFILE_KEY = "nearview.profile";
const UI_SETTINGS_KEY = "nearview.uiSettings";
const ADAPTER_KEY = "nearview.interface";
const ROOM_NAMES = ["薄荷", "松果", "山雀", "海盐", "青柠", "云杉", "小满", "白露"];
const AVATAR_COLORS = ["#17634f", "#315ce7", "#b34bd3", "#d27b14", "#ff634d", "#5b6470"];

interface UiSettings {
  defaultQuality: QualityMode;
  screenOverlayDefault: boolean;
}

function loadProfile(): UserProfile {
  try {
    const stored = JSON.parse(
      localStorage.getItem(PROFILE_KEY) ?? "null"
    ) as Partial<UserProfile> | null;
    if (stored && typeof stored.name === "string" && stored.name.trim()) {
      return {
        name: stored.name.trim().slice(0, 32),
        bio: typeof stored.bio === "string" ? stored.bio.slice(0, 80) : "",
        avatarColor:
          typeof stored.avatarColor === "string"
            ? stored.avatarColor
            : "#17634f"
      };
    }
  } catch {
    // Fall back to the legacy display-name setting.
  }
  const legacyName = localStorage.getItem(USER_NAME_KEY)?.trim();
  const name =
    legacyName ||
    `${ROOM_NAMES[Math.floor(Math.random() * ROOM_NAMES.length)]} ${
      Math.floor(Math.random() * 90) + 10
    }`;
  return { name, bio: "", avatarColor: "#17634f" };
}

function loadUiSettings(): UiSettings {
  try {
    const stored = JSON.parse(
      localStorage.getItem(UI_SETTINGS_KEY) ?? "null"
    ) as Partial<UiSettings> | null;
    return {
      defaultQuality:
        stored?.defaultQuality === "sharp" ||
        stored?.defaultQuality === "smooth" ||
        stored?.defaultQuality === "balanced"
          ? stored.defaultQuality
          : "balanced",
      screenOverlayDefault: stored?.screenOverlayDefault ?? true
    };
  } catch {
    return { defaultQuality: "balanced", screenOverlayDefault: true };
  }
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

function networkModeLabel(mode: NetworkMode): string {
  return mode === "virtual" ? "虚拟局域网" : "本地局域网";
}

function RoomAvatar({
  name,
  sharing,
  avatarColor
}: {
  name: string;
  sharing: boolean;
  avatarColor?: string;
}) {
  return (
    <span
      className={`member-avatar ${sharing ? "is-sharing" : ""}`}
      style={
        avatarColor
          ? { backgroundColor: avatarColor, borderColor: avatarColor }
          : undefined
      }
    >
      {initials(name)}
      {sharing ? <i /> : null}
    </span>
  );
}

function SignalStrength({
  metrics,
  isSelf = false
}: {
  metrics?: PeerConnectionMetrics;
  isSelf?: boolean;
}) {
  if (isSelf) {
    return <span className="signal-self">本机</span>;
  }
  const level =
    metrics?.signal === "excellent"
      ? 4
      : metrics?.signal === "good"
        ? 3
        : metrics?.signal === "fair"
          ? 2
          : metrics?.signal === "poor"
            ? 1
            : 0;
  return (
    <span className={`signal-meter signal-${metrics?.signal ?? "unknown"}`}>
      <span className="signal-bars" aria-hidden="true">
        {[1, 2, 3, 4].map((bar) => (
          <i key={bar} className={bar <= level ? "active" : ""} />
        ))}
      </span>
      <small>
        {metrics?.pingMs === null || metrics?.pingMs === undefined
          ? "--"
          : `${metrics.pingMs}ms`}
      </small>
    </span>
  );
}

interface HomeProps {
  profile: UserProfile;
  interfaces: NetworkInterfaceInfo[];
  selectedInterface: string;
  setSelectedInterface: (address: string) => void;
  onCreate: () => void;
  onManualJoin: () => void;
  onOpenSettings: () => void;
  error: string | null;
  clearError: () => void;
}

function Home({
  profile,
  interfaces,
  selectedInterface,
  setSelectedInterface,
  onCreate,
  onManualJoin,
  onOpenSettings,
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
            <small>P2P SCREEN SHARING</small>
          </span>
        </div>
        <div className="topbar-meta">
          <span className="service-chip">
            <Icon name="lock" size={13} />
            无云服务
          </span>
          <span className="service-chip direct">
            <Icon name="signal" size={13} />
            P2P 直连
          </span>
          <button
            type="button"
            className="profile-field profile-button"
            onClick={onOpenSettings}
          >
            <span
              className="profile-avatar"
              style={{ backgroundColor: profile.avatarColor, color: "#fff" }}
            >
              {initials(profile.name)}
            </span>
            <span className="profile-copy">
              <small>{profile.bio || "个人资料与设置"}</small>
              <strong>{profile.name}</strong>
            </span>
            <Icon name="more" size={16} />
          </button>
        </div>
      </header>

      <main className="home-content">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">
              <i className="live-dot" />
              虚拟局域网 IP 直连
            </span>
            <h1>
              输入 IP，
              <br />
              进入共享。
            </h1>
            <p>
              先接入 Radmin VPN、ZeroTier 或 Tailscale，再通过房主的虚拟 IP
              创建或加入共享节点。没有附近房间广播，也不主动弹出共享提醒。
            </p>
            <div className="hero-actions">
              <button type="button" className="primary-button" onClick={onCreate}>
                <Icon name="plus" size={18} />
                创建共享节点
              </button>
              <button type="button" className="secondary-button" onClick={onManualJoin}>
                <Icon name="link" size={18} />
                输入 IP 加入
              </button>
            </div>
            <div className="hero-assurances">
              <span>无需账号</span>
              <span>无公共中继</span>
              <span>屏幕数据不经过服务器</span>
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
              <span className="network-summary local">
                实体网卡 {interfaces.filter((item) => !item.virtual).length}
              </span>
              <span className="network-summary virtual">
                虚拟网卡 {interfaces.filter((item) => item.virtual).length}
              </span>
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
                  {currentInterface ? "本机虚拟/局域网地址" : "等待网络"}
                </span>
                <span>默认端口 42800</span>
              </div>
            </div>
          </div>
        </section>

        <section className="access-section access-guide">
          <div className="section-heading">
            <div>
              <span className="eyebrow">连接方式</span>
              <h2>三步进入同一个共享节点</h2>
            </div>
            <span className="manual-only-badge">
              <Icon name="lock" size={13} />
              仅手动 IP 连接
            </span>
          </div>

          <div className="access-steps">
            <article>
              <span>01</span>
              <Icon name="wifi" size={21} />
              <strong>进入同一个虚拟网络</strong>
              <p>先通过 Radmin VPN、ZeroTier 或 Tailscale 取得对方的虚拟 IP。</p>
            </article>
            <article>
              <span>02</span>
              <Icon name="monitor" size={21} />
              <strong>房主创建节点</strong>
              <p>选择虚拟网卡并创建共享节点，应用会显示可分享的 IP 地址。</p>
            </article>
            <article>
              <span>03</span>
              <Icon name="link" size={21} />
              <strong>输入 IP 查看并加入</strong>
              <p>先看到成员数量和是否有人共享；不会自动弹提醒，也不做房间扫描。</p>
            </article>
          </div>
        </section>

        <footer className="home-footer">
          <span>屏幕画面只在设备之间传输</span>
          <span>WebRTC 加密</span>
          <span>无房间广播 · 无自动发现</span>
        </footer>
      </main>
    </div>
  );
}

interface SettingsDialogProps {
  profile: UserProfile;
  uiSettings: UiSettings;
  preferences: AppPreferences;
  onClose: () => void;
  onSave: (
    profile: UserProfile,
    uiSettings: UiSettings,
    preferences: AppPreferences
  ) => Promise<void>;
}

function SettingsDialog({
  profile,
  uiSettings,
  preferences,
  onClose,
  onSave
}: SettingsDialogProps) {
  const [draftProfile, setDraftProfile] = useState(profile);
  const [draftUi, setDraftUi] = useState(uiSettings);
  const [draftPreferences, setDraftPreferences] = useState(preferences);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draftProfile.name.trim()) {
      setError("请输入昵称");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(
        {
          ...draftProfile,
          name: draftProfile.name.trim().slice(0, 32),
          bio: draftProfile.bio.trim().slice(0, 80)
        },
        draftUi,
        draftPreferences
      );
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal settings-modal"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">本地资料与偏好</span>
            <h2>个人资料与设置</h2>
            <p>资料保存在当前设备，不经过 NearView 服务器。</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>

        <div className="settings-preview">
          <span
            className="profile-avatar large"
            style={{ backgroundColor: draftProfile.avatarColor }}
          >
            {initials(draftProfile.name)}
          </span>
          <span>
            <strong>{draftProfile.name || "你的昵称"}</strong>
            <small>{draftProfile.bio || "添加一句状态，让房间成员更了解你"}</small>
          </span>
        </div>

        <label className="field">
          <span>昵称</span>
          <input
            autoFocus
            value={draftProfile.name}
            maxLength={32}
            onChange={(event) =>
              setDraftProfile((current) => ({
                ...current,
                name: event.target.value
              }))
            }
          />
        </label>

        <label className="field">
          <span>
            个人状态 <small>{draftProfile.bio.length}/80</small>
          </span>
          <input
            value={draftProfile.bio}
            maxLength={80}
            placeholder="例如：前端开发 · 在家办公"
            onChange={(event) =>
              setDraftProfile((current) => ({
                ...current,
                bio: event.target.value
              }))
            }
          />
        </label>

        <div className="field">
          <span>头像颜色</span>
          <div className="avatar-color-picker">
            {AVATAR_COLORS.map((color) => (
              <button
                type="button"
                key={color}
                className={
                  draftProfile.avatarColor === color ? "active" : ""
                }
                style={{ backgroundColor: color }}
                aria-label={`选择头像颜色 ${color}`}
                onClick={() =>
                  setDraftProfile((current) => ({
                    ...current,
                    avatarColor: color
                  }))
                }
              >
                {draftProfile.avatarColor === color ? (
                  <Icon name="check" size={14} />
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-grid">
          <label className="field compact">
            <span>默认画质</span>
            <select
              value={draftUi.defaultQuality}
              onChange={(event) =>
                setDraftUi((current) => ({
                  ...current,
                  defaultQuality: event.target.value as QualityMode
                }))
              }
            >
              <option value="sharp">文字优先</option>
              <option value="balanced">均衡</option>
              <option value="smooth">流畅优先</option>
            </select>
          </label>
          <label className="field compact">
            <span>点击关闭按钮时</span>
            <select
              value={draftPreferences.closeBehavior}
              onChange={(event) =>
                setDraftPreferences({
                  closeBehavior: event.target
                    .value as AppPreferences["closeBehavior"]
                })
              }
            >
              <option value="ask">每次询问</option>
              <option value="minimize">最小化到托盘</option>
              <option value="quit">直接退出</option>
            </select>
          </label>
        </div>

        <label className="settings-toggle">
          <span>
            <strong>默认展开屏幕信息浮层</strong>
            <small>在全屏观看时显示聊天和在线成员</small>
          </span>
          <input
            type="checkbox"
            checked={draftUi.screenOverlayDefault}
            onChange={(event) =>
              setDraftUi((current) => ({
                ...current,
                screenOverlayDefault: event.target.checked
              }))
            }
          />
        </label>

        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="text-button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? "正在保存…" : "保存设置"}
          </button>
        </div>
      </form>
    </div>
  );
}

interface ActionDialogProps {
  state: Exclude<DialogState, null>;
  displayName: string;
  interfaces: NetworkInterfaceInfo[];
  selectedInterface: string;
  onClose: () => void;
  onCreate: (request: {
    roomName: string;
    password: string;
    networkMode: NetworkMode;
    interfaceAddress: string;
  }) => Promise<void>;
  onRefreshInterfaces: () => Promise<NetworkInterfaceInfo[]>;
  onProbe: (endpoint: string) => Promise<RoomProbeResult>;
  onJoinManual: (
    endpoint: string,
    password: string,
    probe: RoomProbeResult
  ) => Promise<void>;
}

function ActionDialog({
  state,
  displayName,
  interfaces,
  selectedInterface,
  onClose,
  onCreate,
  onRefreshInterfaces,
  onProbe,
  onJoinManual
}: ActionDialogProps) {
  const [roomName, setRoomName] = useState(`${displayName} 的共享节点`);
  const [endpoint, setEndpoint] = useState("");
  const [password, setPassword] = useState("");
  const [networkMode, setNetworkMode] = useState<NetworkMode>(() =>
    interfaces.find((item) => item.address === selectedInterface)?.virtual
      ? "virtual"
      : "local"
  );
  const [adapterAddress, setAdapterAddress] = useState(selectedInterface);
  const [busyState, setBusyState] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<RoomProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const availableInterfaces = interfaces.filter((item) =>
    networkMode === "virtual" ? item.virtual : !item.virtual
  );

  useEffect(() => {
    if (state.type !== "create") {
      return;
    }
    if (!availableInterfaces.some((item) => item.address === adapterAddress)) {
      setAdapterAddress(availableInterfaces[0]?.address ?? "");
    }
  }, [
    adapterAddress,
    availableInterfaces,
    state.type
  ]);

  useEffect(() => {
    if (state.type !== "manual" || endpoint.trim().length < 5) {
      setProbe(null);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setProbing(true);
      onProbe(endpoint)
        .then((result) => {
          if (active) {
            setProbe(result);
            setError(null);
          }
        })
        .catch((reason: unknown) => {
          if (active) {
            setProbe(null);
            setError(
              reason instanceof Error ? reason.message : "无法读取节点信息"
            );
          }
        })
        .finally(() => {
          if (active) {
            setProbing(false);
          }
        });
    }, 550);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [endpoint, onProbe, state.type]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusyState(true);
    setError(null);
    try {
      if (state.type === "create") {
        if (!adapterAddress) {
          throw new Error(
            networkMode === "virtual"
              ? "没有检测到虚拟网卡，请先启动 Radmin VPN 等软件"
              : "没有检测到可用的本地网卡"
          );
        }
        await onCreate({
          roomName,
          password,
          networkMode,
          interfaceAddress: adapterAddress
        });
      } else {
        const result = probe ?? (await onProbe(endpoint));
        if (result.room.hasPassword && !password) {
          throw new Error("请输入房间密码");
        }
        await onJoinManual(endpoint, password, result);
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
      ? "创建共享节点"
      : "输入 IP 加入";
  const subtitle =
    state.type === "create"
      ? "房主会监听默认端口 42800；端口被占用时，以创建后的实际地址为准。"
      : "输入房主的虚拟局域网 IP，应用会读取房间人数和共享状态。";

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
            <div className="network-mode-picker" role="group" aria-label="建立房间的网络方式">
              <button
                type="button"
                className={networkMode === "local" ? "active" : ""}
                onClick={() => setNetworkMode("local")}
              >
                <Icon name="wifi" size={17} />
                <span>
                  <strong>本地局域网</strong>
                  <small>选择 Ethernet、Wi-Fi 等实体网卡</small>
                </span>
              </button>
              <button
                type="button"
                className={networkMode === "virtual" ? "active" : ""}
                onClick={() => setNetworkMode("virtual")}
              >
                <Icon name="link" size={17} />
                <span>
                  <strong>虚拟局域网</strong>
                  <small>使用 Radmin VPN 等已有虚拟网卡</small>
                </span>
              </button>
            </div>
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
                可选密码 <small>只有知道虚拟 IP 的人才能连接</small>
              </span>
              <input
                type="password"
                value={password}
                maxLength={64}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="设置房间密码"
              />
            </label>
            <label className="field">
              <span>
                {networkMode === "virtual" ? "虚拟网卡" : "实体网卡"}
                <small>共享节点只监听所选地址</small>
              </span>
              {availableInterfaces.length > 0 ? (
                <select
                  value={adapterAddress}
                  onChange={(event) => setAdapterAddress(event.target.value)}
                >
                  {availableInterfaces.map((item) => (
                    <option key={item.id} value={item.address}>
                      {item.name} · {item.address}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="adapter-empty">
                  <span>
                    {networkMode === "virtual"
                      ? "未检测到虚拟网卡。请先安装并启动 Radmin VPN、ZeroTier 或 Tailscale。"
                      : "未检测到实体网卡。请检查网络连接后刷新。"}
                  </span>
                  <button
                    type="button"
                    disabled={refreshing}
                    onClick={() => {
                      setRefreshing(true);
                      onRefreshInterfaces()
                        .then(() => setError(null))
                        .catch((reason: unknown) =>
                          setError(
                            reason instanceof Error
                              ? reason.message
                              : "刷新网卡失败"
                          )
                        )
                        .finally(() => setRefreshing(false));
                    }}
                  >
                    {refreshing ? "刷新中…" : "刷新网卡"}
                  </button>
                </div>
              )}
            </label>
            {networkMode === "virtual" && availableInterfaces.length > 0 ? (
              <div className="virtual-adapter-note">
                <Icon name="lock" size={14} />
                成员必须先加入同一个 Radmin VPN 等虚拟网络，再输入这里的 IP。
              </div>
            ) : null}
          </>
        ) : (
          <>
            <label className="field">
              <span>
                房主虚拟 IP
                <small>不填端口时使用 42800</small>
              </span>
              <input
                autoFocus
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                placeholder="26.12.3.4"
                spellCheck={false}
              />
            </label>
            {probing ? (
              <div className="probe-loading">
                <i />
                正在读取节点状态…
              </div>
            ) : probe ? (
              <div className="probe-card">
                <span className="room-icon">
                  <Icon name="monitor" size={22} />
                </span>
                <span className="probe-copy">
                  <strong>{probe.room.name}</strong>
                  <small>
                    {probe.room.hostName} 创建 · {networkModeLabel(probe.room.networkMode)} ·{" "}
                    {probe.memberCount} 人在线
                  </small>
                </span>
                <span
                  className={`share-discovery ${
                    probe.sharingCount > 0 ? "active" : ""
                  }`}
                >
                  <i />
                  {probe.sharingCount > 0
                    ? `${probe.sharingCount} 路屏幕正在共享`
                    : "当前无人共享"}
                </span>
              </div>
            ) : null}
            <label className="field">
              <span>
                房间密码 <small>{probe?.room.hasPassword ? "此节点需要密码" : "没有密码可留空"}</small>
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
        )}

        {error ? <p className="form-error">{error}</p> : null}

        <div className="modal-actions">
          {state.type === "manual" ? (
            <button
              type="button"
              className="text-button probe-button"
              disabled={probing || !endpoint.trim()}
              onClick={() => {
                setProbing(true);
                onProbe(endpoint)
                  .then((result) => {
                    setProbe(result);
                    setError(null);
                  })
                  .catch((reason: unknown) =>
                    setError(
                      reason instanceof Error ? reason.message : "无法读取节点信息"
                    )
                  )
                  .finally(() => setProbing(false));
              }}
            >
              {probing ? "检查中…" : "重新检查"}
            </button>
          ) : null}
          <button type="button" className="text-button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary-button" disabled={busyState}>
            {busyState
              ? "正在连接…"
              : state.type === "create"
                ? "创建并进入"
                : "加入节点"}
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
  syncLatencyTargetMs: number;
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
  profile: UserProfile;
  onOpenSettings: () => void;
  screenOverlayDefault: boolean;
}

function RoomView({
  room,
  peers,
  messages,
  localStream,
  quality,
  syncLatencyTargetMs,
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
  setError,
  profile,
  onOpenSettings,
  screenOverlayDefault
}: RoomChromeProps) {
  const [chatDraft, setChatDraft] = useState("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const focusVideoRef = useRef<HTMLVideoElement | null>(null);
  const [screenOverlayOpen, setScreenOverlayOpen] = useState(
    screenOverlayDefault
  );

  useEffect(() => {
    setScreenOverlayOpen(screenOverlayDefault);
  }, [screenOverlayDefault]);

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
            <span className="room-network-mode">
              {networkModeLabel(room.networkMode)} · {room.adapterName}
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
          <span
            className="latency-pill"
            title="所有观看端使用统一的目标播放延迟；慢连接会自动降码率或丢帧追赶"
          >
            <Icon name="signal" size={13} />
            自适应同步 ~{syncLatencyTargetMs}ms
          </span>
          <button
            className="invite-button"
            type="button"
            title={`复制邀请地址 ${endpoint}`}
            onClick={() => void copyText(endpoint)}
          >
            <Icon name="link" size={15} />
            复制 IP
          </button>
          <button
            className="room-profile-button"
            type="button"
            onClick={onOpenSettings}
            title="个人资料与设置"
          >
            <span style={{ backgroundColor: profile.avatarColor }}>
              {initials(profile.name)}
            </span>
            <Icon name="more" size={14} />
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
                className={`tool-button annotation-pulse-toggle ${
                  annotationTool === "pulse" ? "active" : ""
                }`}
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
                className={`tool-button annotation-arrow-toggle ${
                  annotationTool === "arrow" ? "active" : ""
                }`}
                onClick={() =>
                  setAnnotationTool(annotationTool === "arrow" ? "off" : "arrow")
                }
                disabled={sharingPeers.length === 0}
              >
                <Icon name="arrow" size={16} />
                箭头
              </button>
              <span className="toolbar-divider" />
              <button
                type="button"
                className={`tool-button screen-overlay-toggle ${
                  screenOverlayOpen ? "active" : ""
                }`}
                onClick={() => setScreenOverlayOpen((current) => !current)}
              >
                <Icon name="users" size={16} />
                屏幕覆盖
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

          {screenOverlayOpen ? (
            <aside className="screen-overlay-panel">
              <div className="overlay-panel-head">
                <span>
                  <Icon name="users" size={15} />
                  在线成员
                </span>
                <button
                  type="button"
                  onClick={() => setScreenOverlayOpen(false)}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
              <div className="overlay-members">
                <div>
                  <RoomAvatar
                    name={selfName}
                    sharing={Boolean(localStream)}
                    avatarColor={profile.avatarColor}
                  />
                  <span>
                    <strong>{selfName}</strong>
                    <small>你 · {localStream ? "共享中" : "在线"}</small>
                  </span>
                  <SignalStrength isSelf />
                </div>
                {peers.map((peer) => (
                  <div key={peer.id}>
                    <RoomAvatar
                      name={peer.name}
                      sharing={peer.sharing}
                      avatarColor={peer.avatarColor}
                    />
                    <span>
                      <strong>{peer.name}</strong>
                      <small>{peer.bio || "房间成员"}</small>
                    </span>
                    <SignalStrength metrics={peer.metrics} />
                  </div>
                ))}
              </div>
              <div className="overlay-panel-head chat">
                <span>
                  <Icon name="spark" size={15} />
                  房间消息
                </span>
              </div>
              <div className="overlay-chat">
                {messages.length === 0 ? (
                  <p>还没有消息</p>
                ) : (
                  messages.slice(-6).map((message) => (
                    <div key={message.id}>
                      <strong>
                        {message.peerId === room.selfId ? "你" : message.peerName}
                      </strong>
                      <span>{message.text}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="overlay-composer">
                <input
                  value={chatDraft}
                  placeholder="快速发送消息…"
                  onChange={(event) => setChatDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      sendMessage();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={sendMessage}
                  disabled={!chatDraft.trim()}
                >
                  <Icon name="send" size={14} />
                </button>
              </div>
            </aside>
          ) : null}

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
                  <p>共享后把右上角 IP 发给成员；有人加入时你会收到提示。</p>
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
                  avatarColor={profile.avatarColor}
                />
                <span className="member-copy">
                  <strong>{room.isHost ? room.hostName : selfName}</strong>
                  <small>
                    {room.isHost ? "房主" : "你"}
                    {localStream ? (paused ? " · 已暂停" : " · 共享中") : " · 在线"}
                  </small>
                </span>
                <span className="member-state">
                  <SignalStrength isSelf />
                </span>
              </div>
              {peers.map((peer) => (
                <div className="member-row" key={peer.id}>
                  <RoomAvatar
                    name={peer.name}
                    sharing={peer.sharing}
                    avatarColor={peer.avatarColor}
                  />
                  <span className="member-copy">
                    <strong>{peer.name}</strong>
                    <small>
                      {peer.bio ||
                        (peer.connectionState === "connected"
                          ? "已连接"
                          : "连接中")}
                    </small>
                  </span>
                  <span className={`member-state ${peer.sharing ? "sharing" : ""}`}>
                    <SignalStrength metrics={peer.metrics} />
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="chat-panel">
            <div className="sidebar-heading chat-heading">
              <span>房间消息</span>
              <span className="relay-badge">房主中转 · 非端到端</span>
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
  const [profile, setProfile] = useState<UserProfile>(loadProfile);
  const [uiSettings, setUiSettings] = useState<UiSettings>(loadUiSettings);
  const [preferences, setPreferences] = useState<AppPreferences>({
    closeBehavior: "ask"
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [interfaces, setInterfaces] = useState<NetworkInterfaceInfo[]>([]);
  const [selectedInterface, setSelectedInterfaceState] = useState(
    () => localStorage.getItem(ADAPTER_KEY) ?? ""
  );
  const [dialog, setDialog] = useState<DialogState>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [focusedPeerId, setFocusedPeerId] = useState<string | null>(null);
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>("off");
  const roomController = useRoom(uiSettings.defaultQuality);
  const { room, peers, localStream, quality, paused } = roomController;

  useEffect(() => {
    window.nearview
      .getPreferences()
      .then(setPreferences)
      .catch(() => undefined);
  }, []);

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

  function setSelectedInterface(address: string) {
    setSelectedInterfaceState(address);
    localStorage.setItem(ADAPTER_KEY, address);
  }

  async function createRoom(request: {
    roomName: string;
    password: string;
    networkMode: NetworkMode;
    interfaceAddress: string;
  }) {
    setSelectedInterface(request.interfaceAddress);
    await roomController.createRoom({
      roomName: request.roomName,
      password: request.password || undefined,
      profile,
      interfaceAddress: request.interfaceAddress,
      networkMode: request.networkMode
    });
  }

  async function refreshInterfaces() {
    const items = await window.nearview.getNetworkInterfaces();
    setInterfaces(items);
    if (!selectedInterface && items[0]) {
      setSelectedInterface(items[0].address);
    }
    return items;
  }

  async function joinManual(
    endpoint: string,
    password: string,
    probe: RoomProbeResult
  ) {
    await roomController.joinManualRoom(
      endpoint,
      password || undefined,
      profile,
      probe
    );
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

  async function saveSettings(
    nextProfile: UserProfile,
    nextUiSettings: UiSettings,
    nextPreferences: AppPreferences
  ) {
    const savedPreferences = await window.nearview.setPreferences(
      nextPreferences
    );
    setProfile(nextProfile);
    setUiSettings(nextUiSettings);
    setPreferences(savedPreferences);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile));
    localStorage.setItem(USER_NAME_KEY, nextProfile.name);
    localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(nextUiSettings));
    if (room && nextUiSettings.defaultQuality !== quality) {
      await roomController.applyQuality(nextUiSettings.defaultQuality);
    }
  }

  if (!room) {
    return (
      <>
        <Home
          profile={profile}
          interfaces={interfaces}
          selectedInterface={selectedInterface}
          setSelectedInterface={setSelectedInterface}
          onCreate={() => setDialog({ type: "create" })}
          onManualJoin={() => setDialog({ type: "manual" })}
          onOpenSettings={() => setSettingsOpen(true)}
          error={roomController.error}
          clearError={() => roomController.setError(null)}
        />
        {dialog ? (
          <ActionDialog
            state={dialog}
            displayName={profile.name}
            interfaces={interfaces}
            selectedInterface={selectedInterface}
            onClose={() => setDialog(null)}
            onCreate={createRoom}
            onRefreshInterfaces={refreshInterfaces}
            onProbe={roomController.probeRoom}
            onJoinManual={joinManual}
          />
        ) : null}
        {settingsOpen ? (
          <SettingsDialog
            profile={profile}
            uiSettings={uiSettings}
            preferences={preferences}
            onClose={() => setSettingsOpen(false)}
            onSave={saveSettings}
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
        syncLatencyTargetMs={roomController.syncLatencyTargetMs}
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
        profile={profile}
        onOpenSettings={() => setSettingsOpen(true)}
        screenOverlayDefault={uiSettings.screenOverlayDefault}
      />
      {captureOpen ? (
        <CapturePicker
          onClose={() => setCaptureOpen(false)}
          onSelect={roomController.startShare}
        />
      ) : null}
      {roomController.shareJoinNotice ? (
        <div className="share-notice" role="status">
          <span className="notice-icon">
            <Icon name="users" size={17} />
          </span>
          <span>{roomController.shareJoinNotice}</span>
          <button
            type="button"
            onClick={roomController.dismissShareJoinNotice}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      ) : null}
      {roomController.error ? (
        <div className="toast" role="alert">
          <span>{roomController.error}</span>
          <button type="button" onClick={() => roomController.setError(null)}>
            <Icon name="close" size={16} />
          </button>
        </div>
      ) : null}
      {settingsOpen ? (
        <SettingsDialog
          profile={profile}
          uiSettings={uiSettings}
          preferences={preferences}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
        />
      ) : null}
    </>
  );
}
