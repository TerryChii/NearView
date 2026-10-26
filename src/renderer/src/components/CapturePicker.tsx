import { useEffect, useMemo, useState } from "react";
import type {
  CaptureAudioMode,
  CaptureSource
} from "../../../shared/types";
import { Icon } from "./Icon";

interface CapturePickerProps {
  onClose: () => void;
  onSelect: (sourceId: string, audioMode: CaptureAudioMode) => Promise<void>;
}

export function CapturePicker({ onClose, onSelect }: CapturePickerProps) {
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [tab, setTab] = useState<"screen" | "window">("screen");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [audioMode, setAudioMode] = useState<CaptureAudioMode>("none");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.nearview
      .getCaptureSources()
      .then((items) => {
        if (!cancelled) {
          setSources(items);
          const firstScreen = items.find((item) => item.kind === "screen");
          setTab(firstScreen ? "screen" : "window");
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "无法读取共享画面");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleSources = useMemo(
    () => sources.filter((source) => source.kind === tab),
    [sources, tab]
  );

  useEffect(() => {
    if (tab === "screen" && audioMode === "application") {
      setAudioMode("none");
    }
  }, [audioMode, tab]);

  async function choose(source: CaptureSource) {
    setBusyId(source.id);
    setError(null);
    try {
      await onSelect(source.id, audioMode);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "开始共享失败");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="modal capture-modal"
        aria-label="选择共享内容"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">共享画面</span>
            <h2>你想分享什么？</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>

        <div className="capture-tabs">
          <button
            type="button"
            className={tab === "screen" ? "active" : ""}
            onClick={() => setTab("screen")}
          >
            <Icon name="monitor" size={17} />
            整个屏幕
          </button>
          <button
            type="button"
            className={tab === "window" ? "active" : ""}
            onClick={() => setTab("window")}
          >
            <Icon name="grid" size={17} />
            单个窗口
          </button>
        </div>

        <div className="capture-grid">
          {loading ? (
            <div className="capture-empty">正在读取可共享的画面…</div>
          ) : visibleSources.length === 0 ? (
            <div className="capture-empty">暂时没有可共享的{tab === "screen" ? "屏幕" : "窗口"}</div>
          ) : (
            visibleSources.map((source) => (
              <button
                type="button"
                className="capture-item"
                key={source.id}
                disabled={Boolean(busyId)}
                onClick={() => void choose(source)}
              >
                <img src={source.thumbnail} alt="" />
                <span>{source.name}</span>
                {busyId === source.id ? <em>正在开始…</em> : null}
              </button>
            ))
          )}
        </div>

        <div className="capture-footer">
          <div className="audio-capture-options">
            <label>
              <input
                type="radio"
                name="capture-audio"
                checked={audioMode === "none"}
                onChange={() => setAudioMode("none")}
              />
              <span>
                <strong>不共享声音</strong>
                <small>只传输画面</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="capture-audio"
                checked={audioMode === "system"}
                onChange={() => setAudioMode("system")}
              />
              <span>
                <strong>共享系统声音</strong>
                <small>捕获电脑正在播放的全部声音</small>
              </span>
            </label>
            {tab === "window" ? (
              <label>
                <input
                  type="radio"
                  name="capture-audio"
                  checked={audioMode === "application"}
                  onChange={() => setAudioMode("application")}
                />
                <span>
                  <strong>仅共享所选程序声音</strong>
                  <small>Windows 10 2004+，包含该程序的子进程声音</small>
                </span>
              </label>
            ) : null}
          </div>
          {error ? <p className="inline-error">{error}</p> : null}
        </div>
      </section>
    </div>
  );
}
