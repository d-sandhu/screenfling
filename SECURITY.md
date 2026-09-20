# Security

Security fixes target active development. There is no supported-version or
response-time guarantee.

## Report privately

Do not post exploit details, credentials, private screenshots, clipboard data,
or terminal conversations in a public issue.

Use GitHub's private vulnerability reporting when enabled for this repository.
Otherwise, ask the repository owner for a private channel before sharing details.
Include the affected commit, OS, adapter/version, minimal reproduction, impact,
and whether content was exposed or persisted.

## Trust boundaries

Renderers use Electron's sandbox and context isolation. Main validates IPC
senders, payloads, and workflow state. Stage uses an explicitly selected local
route, rechecks it, and does not fall back to an active window or retry uncertain
input. Notes are data, not shell commands. No generic Enter/submission action is
implemented.

Captures and notes are not saved by ScreenFling or uploaded to a ScreenFling
service. Browser session storage is nonpersistent; explicit shortcut and
connection settings are stored locally. Diagnostics exclude content and
identifiers. The OS clipboard and destination agent can retain or transmit data
under their own policies.

## Limits worth reporting

Wrong-target writes, unexpected submission or focus changes, IPC escalation,
unsafe selector paths, private-data logging, and packaging or dependency problems
are security-relevant bugs.

WezTerm's executable and Lua configuration must be trusted. Ownership and ACL
checks do not make arbitrary configuration safe to execute, prove which agent
is in a pane, or protect against a compromised same-user process or root.
A successful CLI write is not proof of image attachment.

[IPC validation](src/main/ipc-sender.ts), the
[pinned transport](src/main/wezterm-process.ts), and the
[read-only ACL helper](tools/native/selector-acl.c) are the implementation
references. [Release preparation](docs/releasing.md) distinguishes ad-hoc test
builds from trusted distribution. Do not disable platform protections to make a
check pass.
