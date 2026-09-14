# ADR 0003 — pin the local WezTerm connection before dispatch

Status: implemented; headless native conformance observed; GUI/agent acceptance open

Date: 2026-09-13 (verification completed 2026-09-14 UTC)

## Measured problem

The original generation guard validated the executable, config, and socket path
immediately before spawning WezTerm. The CLI connected afterward. Replacing the
socket pathname in that gap could route the command to a different endpoint.
A successful check was not an atomic compare-and-send operation.

`wezterm-process.test.ts` retains a negative control that deliberately performs
this replacement and proves that the old pathname-only runner reaches it. That
expected unsafe control is not counted as a production wrong-target success.
The change is required by the existing exact-target contract, not new scope.

## Decision

`runWezTermProcess` routes Stage (`send-text`) and Reveal (`activate-pane`) through
`runPinnedWezTermProcess`. Read-only version and discovery probes continue to use
the bounded subprocess runner. Adapter identity and destination IDs do not change.

For each side-effect command, the main-owned transport:

1. validates the original selectors and connects to the selected Unix socket;
2. creates an unpredictable, private one-command socket in the already-validated
   socket parent, sets mode 0600, and checks its ACL;
3. revalidates the original generation **after connecting**, before authorizing
   any protocol forwarding;
4. runs the existing CLI with the explicit pane ID and only its
   `WEZTERM_UNIX_SOCKET` overridden to the temporary socket;
5. forwards at most one accepted client to the existing upstream connection,
   without resolving or connecting to the original pathname again;
6. closes both sockets, forwarding streams, and listener on completion/failure.

The shared subprocess deadline covers setup and dispatch. Paths are rejected
above 103 UTF-8 bytes rather than risk native pathname truncation. Traffic is
capped at 1 MiB across both directions. Stream backpressure is retained. Either
direction may reach EOF without discarding a response still arriving in the
other direction. An extra or premature client stops the transport.

No TCP listener, remote transfer, persistent service, protocol parser, terminal
read-back, screenshot file, image upload, reconnect, retry, active-pane fallback,
or automatic submission is added. The transport cannot prove image attachment.
Stage still reports `dispatched-unverified`; Reveal remains a separate action.

## Failure and security limits

An inspection failure or expired pre-spawn guard authorizes no command. A
post-launch process or transport failure is not evidence that nothing arrived;
the existing uncertain-result mapping and no-retry rule remain authoritative.
Late read completions cannot resume an expired dispatch.

The private namespace and existing selector ownership/ACL policy are the trust
boundary. This does not defend against a compromised same-user process, root,
changes to an agent inside an otherwise live pane, or arbitrary executable/config
replacement by a trusted principal. No general filesystem transaction or
universal atomicity claim is made. A disconnected upstream is never replaced by
a fresh connection. Abrupt main-process termination may leave an empty socket
pathname, but not a screenshot/note file; later commands never reuse that path.

## Observed evidence

Implementation commit: `68476f1a7d51b680d6f3d83ac5cc3b4c729a55ec`.

[Check run 34800803518](https://github.com/d-sandhu/screenfling/actions/runs/34800803518)
passed macOS and Windows. GitHub tested synthetic merge
`652ae218ebb872d19b4cf92b843ef56c1f8d9fc3` into main `4c703f5`; this was not an
actual repository merge. The retained source archive's Git tree was independently
checked against the implementation tree before the final documentation update.

On macOS arm64, Node 24.13.0/npm 11.19.0:

- 381 Vitest cases in 43 files, 12 capture-runner helper tests, and 14 built-browser
  fixtures passed; formatting, lint, type checks, and audit passed with no
  vulnerabilities reported by the audit.
- The real-socket suite passed 20 post-authorization replacement interleavings,
  pre-dispatch rejection, timeouts, ACL failure, dead-upstream refusal, output
  bounds, and normal socket-file cleanup. These receivers are synthetic.
- The checksum-pinned native WezTerm `20240203-110809-5046fc22` CLI and headless
  mux passed 100 alternating, uniquely identified payloads across two disposable
  raw-byte consumers. Exact payload order/content matched each selected pane.
- A final-boundary native CLI test replaced the original mux pathname after
  connection/authorization but before launching `send-text`. The original pane
  received the payload; the replacement received **zero connections and bytes**.
- Production packaging, strict ad-hoc application/helper signature verification,
  packaged idle-lifecycle smoke, and archive/extract signature/identity checks
  passed. CI retained a hashed candidate archive with source/test commit metadata.

The native fixture is enabled only on macOS with explicit test binary paths;
other runs skip it rather than invent evidence. The fixture download's SHA-256
is fixed in the Check workflow. No application installation, GUI, permission
change, clipboard action, image attachment, or real agent is involved.

## Remaining acceptance

The [roadmap](../../ROADMAP.md#immediate-implementation-sequence) and
[operator protocol](../acceptance/macos-operator-acceptance.md) remain canonical.
The observed headless pathname-replacement case does not pass the whole installed
GUI/agent tuple. Visible no-focus Stage, separately observed Reveal, actual
config/binding semantics, restart behavior, and 30 trials per supported agent
still require direct evidence. Physical capture, permissions, resource/latency,
and comparative dogfooding remain separate gates. No support range is broadened.

## References

- [Production transport](../../src/main/wezterm-process.ts)
- [Real-socket conformance and negative control](../../src/main/wezterm-process.test.ts)
- [Pinned native CLI fixture](../../src/main/wezterm-native.test.ts)
- [Bounded subprocess lifecycle](../../src/main/bounded-process.ts)
- [WezTerm send-text reference](https://wezterm.org/cli/cli/send-text.html)
- [WezTerm CLI selection reference](https://wezterm.org/cli/cli/index.html)
