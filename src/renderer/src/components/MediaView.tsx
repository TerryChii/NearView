import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type RefObject
} from "react";
import type {
  AnnotationPayload,
  IncomingAnnotation
} from "../../../shared/types";
import { Icon } from "./Icon";

interface VideoSurfaceProps {
  stream: MediaStream;
  muted?: boolean;
  paused?: boolean;
  className?: string;
  onVideoDimensions?: (dimensions: { width: number; height: number }) => void;
}

export const VideoSurface = forwardRef<HTMLVideoElement, VideoSurfaceProps>(
  function VideoSurface(
    {
      stream,
      muted = false,
      paused = false,
      className = "",
      onVideoDimensions
    },
    ref
  ) {
    const localRef = useRef<HTMLVideoElement | null>(null);
    useImperativeHandle(ref, () => localRef.current as HTMLVideoElement, []);

    useEffect(() => {
      const video = localRef.current;
      if (!video) {
        return;
      }
      video.srcObject = stream;
      const reportDimensions = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          onVideoDimensions?.({
            width: video.videoWidth,
            height: video.videoHeight
          });
        }
      };
      video.addEventListener("loadedmetadata", reportDimensions);
      video.addEventListener("resize", reportDimensions);
      reportDimensions();
      void video.play().catch(() => {
        // Electron will retry after the next user interaction if autoplay is blocked.
      });
      return () => {
        video.removeEventListener("loadedmetadata", reportDimensions);
        video.removeEventListener("resize", reportDimensions);
      };
    }, [onVideoDimensions, stream]);

    return (
      <>
        <video
          ref={localRef}
          className={`video-surface ${className}`}
          autoPlay
          playsInline
          muted={muted}
        />
        {paused ? (
          <div className="video-paused">
            <span className="paused-icon">
              <Icon name="lock" size={20} />
            </span>
            <strong>画面已暂停</strong>
            <span>共享者正在保护隐私</span>
          </div>
        ) : null}
      </>
    );
  }
);

function annotationColor(id: string): string {
  const colors = ["#ff5c46", "#1d7f68", "#315ce7", "#b34bd3", "#d27b14"];
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

interface AnnotationOverlayProps {
  annotations: IncomingAnnotation[];
  tool: "off" | "pulse" | "arrow";
  onAnnotate?: (annotation: Omit<AnnotationPayload, "targetPeerId">) => void;
  frame: { left: number; top: number; width: number; height: number };
}

function labelPosition(x: number, y: number) {
  const left = x > 0.72 ? `calc(${x * 100}% - 12px)` : `calc(${x * 100}% + 12px)`;
  const top = y < 0.2 ? `calc(${y * 100}% + 15px)` : `calc(${y * 100}% - 15px)`;
  return {
    left,
    top,
    transform:
      x > 0.72
        ? "translate(-100%, -50%)"
        : "translate(0, -50%)"
  };
}

function AnnotationOverlay({
  annotations,
  tool,
  onAnnotate,
  frame
}: AnnotationOverlayProps) {
  const [drag, setDrag] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);

  function point(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))
    };
  }

  return (
    <>
      <svg
        className="annotation-layer"
        style={frame}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <defs>
          <marker
            id="annotation-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#ff5c46" />
          </marker>
        </defs>
        {annotations.map((annotation) => {
          const color = annotationColor(annotation.fromPeerId);
          if (annotation.tool === "pulse") {
            return (
              <g key={annotation.id}>
                <circle
                  className="annotation-pulse"
                  cx={annotation.x1 * 100}
                  cy={annotation.y1 * 100}
                  r="2.2"
                  fill={color}
                  color={color}
                />
              </g>
            );
          }
          return (
            <g key={annotation.id}>
              <line
                x1={annotation.x1 * 100}
                y1={annotation.y1 * 100}
                x2={annotation.x2 * 100}
                y2={annotation.y2 * 100}
                stroke={color}
                strokeWidth="0.65"
                vectorEffect="non-scaling-stroke"
                markerEnd="url(#annotation-arrow)"
              />
              <circle
                cx={annotation.x1 * 100}
                cy={annotation.y1 * 100}
                r="1"
                fill={color}
              />
            </g>
          );
        })}
        {drag && tool === "arrow" ? (
          <line
            x1={drag.x1 * 100}
            y1={drag.y1 * 100}
            x2={drag.x2 * 100}
            y2={drag.y2 * 100}
            stroke="#ff5c46"
            strokeWidth="0.65"
            strokeDasharray="1.5 1.5"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
      <div className="annotation-label-layer" style={frame}>
        {annotations.map((annotation) => {
          const point =
            annotation.tool === "pulse"
              ? { x: annotation.x1, y: annotation.y1 }
              : { x: annotation.x2, y: annotation.y2 };
          return (
            <span
              key={`label-${annotation.id}`}
              className="annotation-label-chip"
              style={{
                ...labelPosition(point.x, point.y),
                color: annotationColor(annotation.fromPeerId)
              }}
            >
              {annotation.fromPeerName}
            </span>
          );
        })}
      </div>
      {tool !== "off" && onAnnotate ? (
        <div
          className={`annotation-hit annotation-hit-${tool}`}
          style={frame}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            const start = point(event);
            setDrag({ x1: start.x, y1: start.y, x2: start.x, y2: start.y });
          }}
          onPointerMove={(event) => {
            if (!drag) {
              return;
            }
            const current = point(event);
            setDrag((previous) =>
              previous ? { ...previous, x2: current.x, y2: current.y } : previous
            );
          }}
          onPointerUp={(event) => {
            if (!drag) {
              return;
            }
            const current = point(event);
            const distance = Math.hypot(
              current.x - drag.x1,
              current.y - drag.y1
            );
            onAnnotate({
              tool: tool === "arrow" && distance > 0.018 ? "arrow" : "pulse",
              x1: drag.x1,
              y1: drag.y1,
              x2: current.x,
              y2: current.y
            });
            setDrag(null);
          }}
          onPointerCancel={() => setDrag(null)}
        />
      ) : null}
    </>
  );
}

interface AnnotatedVideoProps extends VideoSurfaceProps {
  annotations?: IncomingAnnotation[];
  annotationTool?: "off" | "pulse" | "arrow";
  onAnnotate?: (annotation: Omit<AnnotationPayload, "targetPeerId">) => void;
  onClick?: () => void;
  videoRef?: RefObject<HTMLVideoElement | null>;
  style?: CSSProperties;
}

export function AnnotatedVideo({
  stream,
  muted,
  paused,
  className = "",
  annotations = [],
  annotationTool = "off",
  onAnnotate,
  onClick,
  videoRef,
  style
}: AnnotatedVideoProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const update = () =>
      setContainerSize({
        width: container.clientWidth,
        height: container.clientHeight
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const contentFrame = useMemo(() => {
    const width = containerSize.width;
    const height = containerSize.height;
    if (!width || !height) {
      return { left: 0, top: 0, width, height };
    }
    if (!videoSize.width || !videoSize.height) {
      return { left: 0, top: 0, width, height };
    }
    const scale = Math.min(
      width / videoSize.width,
      height / videoSize.height
    );
    const renderedWidth = videoSize.width * scale;
    const renderedHeight = videoSize.height * scale;
    return {
      left: (width - renderedWidth) / 2,
      top: (height - renderedHeight) / 2,
      width: renderedWidth,
      height: renderedHeight
    };
  }, [containerSize, videoSize]);

  return (
    <div
      ref={containerRef}
      className={`media-view ${className}`}
      onClick={(event) => {
        if (annotationTool === "off" && event.target === event.currentTarget) {
          onClick?.();
        }
      }}
      style={style}
    >
      <VideoSurface
        ref={videoRef}
        stream={stream}
        muted={muted}
        paused={paused}
        onVideoDimensions={setVideoSize}
      />
      <AnnotationOverlay
        annotations={annotations}
        tool={annotationTool}
        onAnnotate={onAnnotate}
        frame={contentFrame}
      />
      <button
        type="button"
        className="media-click-target"
        aria-label="聚焦画面"
        onClick={(event) => {
          event.stopPropagation();
          if (annotationTool === "off") {
            onClick?.();
          }
        }}
      />
    </div>
  );
}
