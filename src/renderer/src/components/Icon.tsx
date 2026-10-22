import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "arrow"
  | "back"
  | "check"
  | "clipboard"
  | "close"
  | "expand"
  | "grid"
  | "link"
  | "lock"
  | "monitor"
  | "more"
  | "pause"
  | "pip"
  | "play"
  | "plus"
  | "send"
  | "signal"
  | "spark"
  | "users"
  | "video"
  | "wifi";

const paths: Record<IconName, ReactNode> = {
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  back: <path d="M19 12H5m6-6-6 6 6 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  clipboard: (
    <>
      <rect x="5" y="5" width="14" height="16" rx="2" />
      <path d="M9 5V3h6v2M8 10h8M8 14h6" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  expand: <path d="M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5" />,
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8m-4-4v4" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  pause: (
    <>
      <path d="M9 5v14M15 5v14" />
    </>
  ),
  pip: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="12" y="11" width="7" height="6" rx="1" />
    </>
  ),
  play: <path d="m8 5 11 7-11 7V5Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  send: <path d="m3 3 18 9-18 9 4-9-4-9Zm4 9h14" />,
  signal: <path d="M5 20v-3m5 3v-7m5 7V8m5 12V4" />,
  spark: <path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 5" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3" />
    </>
  ),
  wifi: <path d="M4 9a13 13 0 0 1 16 0M7 13a8.5 8.5 0 0 1 10 0m-7 4a3.5 3.5 0 0 1 4 0m-2 3h.01" />
};

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
