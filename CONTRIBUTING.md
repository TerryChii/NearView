# Contributing to NearView

Thanks for helping improve peer-to-peer LAN screen sharing.

## Development setup

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm dev
```

Please keep changes focused. For substantial networking or media changes, open an issue first and describe:

- the user problem;
- affected operating systems and network types;
- expected connection topology;
- security and firewall implications;
- how the change was tested across at least two devices.

## Pull request checklist

- `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
- The change preserves context isolation and does not expose Node.js directly to the renderer.
- Network messages validate types and enforce size limits.
- New user-facing text is available in Chinese and is concise enough for the compact desktop UI.
- Documentation is updated when protocol, permissions, compatibility, or limitations change.

## Testing notes

Electron screen capture and WebRTC ICE behavior cannot be fully validated in a single renderer test. For media or networking PRs, include a short manual test matrix with:

- Windows-to-Windows over Wi-Fi and Ethernet;
- at least one virtual adapter such as Radmin VPN or Tailscale;
- multicast-enabled and multicast-blocked network;
- screen and window capture;
- password-protected room;
- two or more simultaneous sharers.

## Commit style

Use a short imperative subject, for example:

```text
Add multicast room discovery
Fix paused stream renegotiation
```

By contributing, you agree that your contribution is licensed under the MIT License.
