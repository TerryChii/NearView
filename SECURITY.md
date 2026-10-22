# Security policy

## Supported versions

NearView 0.1.x receives security fixes on a best-effort basis.

## Threat model

NearView is designed for a trusted local network or a trusted virtual private network. It is not a hardened remote-access gateway.

Protected:

- Screen and audio media are carried over WebRTC DTLS-SRTP.
- A password-protected room rejects clients that do not know the password.
- Room passwords are persisted in memory as salted `scrypt` hashes on the host.
- IPC exposure from Electron to the renderer is limited to a typed allowlist.
- Node integration is disabled and context isolation is enabled.

Not currently protected against:

- A malicious host, because the host terminates room signaling.
- Active man-in-the-middle attacks on the LAN. There is no out-of-band certificate fingerprint comparison.
- Eavesdropping on the plaintext WebSocket signaling channel. The room password crosses this channel once when a guest joins.
- Forged discovery announcements from another device on the same multicast domain.
- A compromised operating system, screen-capture process, or GPU stack.

## Deployment guidance

- Use NearView on a trusted private LAN or an encrypted VPN.
- Do not port-forward the signaling port to the public Internet.
- Use a non-trivial room password on shared office or campus networks.
- Treat screen content as visible to every room member. Stop sharing before opening sensitive material.
- Windows Firewall should allow only trusted/private networks unless you intentionally need another profile.

## Reporting a vulnerability

Please do not publish a working exploit in a public issue. Open a private security advisory on the GitHub repository or contact the maintainers through the repository's private contact channel. Include:

- affected version;
- operating system and network setup;
- reproduction steps;
- impact and any suggested mitigation.

You should receive an acknowledgement within 7 days. Please allow time for a fix before disclosure.
