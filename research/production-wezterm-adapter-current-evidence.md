# Production WezTerm surface adapter: current evidence

Research date: 2026-08-20

Status: implementation evidence for the production-tree primitive; this is not a
claim that the adapter is product-integrated or release-ready. See the
[Phase 6 results](phase-6-wezterm-adapter-results.md).

## Executive conclusion

WezTerm is a plausible first terminal-surface adapter. Its CLI provides explicit mux-instance selection, JSON pane discovery, and pane-targeted `send-text`. A production adapter must pin both the instance and pane on every operation, preflight the binary, use bounded subprocesses, and fail closed to Copy when the route is stale or ambiguous.

The transport can prove that bytes were accepted by a particular WezTerm pane. It cannot, from the documented CLI alone, prove that an agent composer opened, that an image was attached, or that the intended agent received the message. ScreenFling should therefore report Stage as `dispatched-unverified` until agent-specific, visible, cross-platform acceptance evidence exists.

## Research method

Context7 was queried first for `/websites/wezterm` (CLI discovery/send, instance selection, spawning, mux domains, and version gates). Factual claims below were then checked against the official WezTerm documentation/source and Node.js documentation only. The Context7 result was used for routing to the relevant primary pages, not as the final authority.

## Documented control surface

### Instance and pane selection

The WezTerm CLI can select a mux instance with `--prefer-mux`, `WEZTERM_UNIX_SOCKET`, or the running GUI (in that precedence order); GUI selection can also use `--class`. If `--pane-id` is omitted, WezTerm falls back to `WEZTERM_PANE` and then the most recently interacted/focused pane. ScreenFling must never rely on that implicit fallback: every `list`, `send-text`, and optional `get-text` call must carry the pinned instance selector and explicit `--pane-id`.

Sources: [CLI targeting and instance selection](https://wezterm.org/cli/cli/index.html), [multiplexing and domains](https://wezterm.org/multiplexing.html), [Unix-domain configuration](https://wezterm.org/config/lua/config/unix_domains.html).

### `list --format json`

The documented JSON result is an array of pane records with this shape:

```json
[
  {
    "window_id": 0,
    "tab_id": 0,
    "pane_id": 0,
    "workspace": "default",
    "size": {"rows": 24, "cols": 80},
    "title": "…",
    "cwd": "file://…"
  }
]
```

`pane_id` is the routing target. `window_id`, `tab_id`, workspace, title, and cwd are useful observations and UI context, but must not become a substitute for an instance generation. The parser should validate required numeric/string fields and bounded sizes, tolerate additive fields, and treat title/cwd as untrusted labels. Malformed JSON, duplicate/ambiguous selected panes, or an unexpected record shape is a discovery failure.

The list command is documented since `20220624-141144-bd1b7c5d`; the page does not promise a separately versioned JSON schema. The adapter therefore needs a versioned parser fixture and a compatibility policy rather than assuming the example is an eternal schema.

Source: [CLI list](https://wezterm.org/cli/cli/list.html).

### `send-text --pane-id`

`wezterm cli send-text` writes text to the selected pane, accepts text on stdin, and supports `--pane-id`. `--no-paste` selects direct input rather than paste-mode behavior and is documented since `20220624-141144-bd1b7c5d`. Use explicit arguments and stdin; do not put user content in a shell command line. The adapter should send the configured agent key sequence and note bytes exactly once, with no implicit Enter unless an agent-specific contract explicitly requires it.

This is a byte/input transport, not a semantic “open composer” or “attach image” operation. A successful process exit means the CLI accepted the request; it is not proof of visible focus, composer readiness, image attachment, or turn completion.

`get-text` can read raw visible screen text for an explicit pane, but it is not a structured composer/agent state API. It is documented since `20230320-124340-559cb7b0`, so it should be an optional diagnostic signal, not a general Stage proof.

Sources: [CLI send-text](https://wezterm.org/cli/cli/send-text.html), [CLI get-text](https://wezterm.org/cli/cli/get-text.html).

### Version and preflight

The minimum documented versions for the required list/send surface and `--no-paste` are `20220624-141144-bd1b7c5d`; optional `get-text` requires `20230320-124340-559cb7b0`. The official release page identifies `20240203-110809-5046fc22` as a stable release available for pinning; the project is active, so the adapter must not silently treat an arbitrary nightly as equivalent.

Preflight should:

- resolve an explicit executable and run `wezterm --version`;
- verify the required CLI/help surface and parse the version against a support policy;
- reject unknown, too-old, or unsupported channels instead of falling back to an implicit GUI target;
- keep a stable-version fixture and run a separate non-gating canary for newer builds.

Sources: [official release](https://github.com/wezterm/wezterm/releases/tag/20240203-110809-5046fc22), [CLI index](https://wezterm.org/cli/cli/index.html), [macOS installation](https://wezterm.org/install/macos.html), [Windows installation](https://wezterm.org/install/windows.html).

## Process and socket boundary

The Electron main process should invoke the CLI with Node `spawn` or `execFile`, an argument array, `shell: false`, `windowsHide: true` on Windows, an explicit environment, and an AbortSignal/per-call timeout. Never interpolate pane IDs, paths, or note text into a shell string. `spawn` has no built-in output cap, so collect stdout/stderr with a byte limit and terminate a process that exceeds it. If `execFile` is used for a small command, set `timeout` and `maxBuffer`; Node documents that exceeding `maxBuffer` terminates/truncates the operation.

Source: [Node.js child-process API](https://nodejs.org/api/child_process.html).

If ScreenFling owns a mux server, `wezterm cli spawn` can create a pane and returns the new pane ID; it supports explicit cwd, domain, workspace, window, and `--` before the program. That is useful for a controlled fixture, but discovery of an existing user target must not spawn or redirect it. An owned server needs a private temporary socket/config, readiness polling through a successful pinned `cli list`, PID ownership, timeout, and platform-specific process-tree cleanup.

Source: [CLI spawn](https://wezterm.org/cli/cli/spawn.html).

Current WezTerm source shows that pane IDs are allocated by a process-local atomic counter, while the local mux listener removes/rebinds its socket when starting. This is implementation evidence, not a stable public identity guarantee. The listener also has different path-existence handling on Windows and permission checks on Unix. Consequently, a socket path or pane ID alone must never be treated as a durable identity across restart.

Sources: [pane ID allocation](https://raw.githubusercontent.com/wezterm/wezterm/main/mux/src/pane.rs), [local mux listener](https://raw.githubusercontent.com/wezterm/wezterm/main/wezterm-mux-server-impl/src/local.rs).

## Stale-generation strategy

ScreenFling should own an instance generation. A route should contain at least:

```text
adapter = wezterm
instance selector = exact socket/domain/config selection
instance generation = ScreenFling-owned discovery fingerprint/token
pane id = explicit WezTerm pane_id
```

Recommended flow:

1. Discover through the pinned instance selector and store a generation fingerprint (for an owned mux, process identity/start time plus socket/config identity; for an external mux, the strongest available socket/process/config fingerprint).
2. Before any side effect, re-run pinned `list --format json`, require the exact pane ID, and verify the instance generation has not changed.
3. If the pane is missing, the instance was replaced, the selector is ambiguous, or parsing/preflight fails, return `stale`/`failed` and offer Copy. Do not choose a new pane or retry automatically.
4. If validation passes, issue one explicit `send-text --pane-id … --no-paste` operation. An uncertain timeout or process failure is not safe to retry because bytes may already have arrived.

There is no documented WezTerm compare-and-swap operation combining revalidation and send. A replacement can therefore occur in the final time-of-check/time-of-use window. The adapter can reduce and detect this risk, but cannot claim mathematical atomicity; the conformance suite must exercise this interleaving and classify uncertain outcomes conservatively.

## Native macOS and Windows considerations

WezTerm publishes a macOS app bundle and universal binary, and supports the documented macOS release range. Windows distribution supports 64-bit Windows 10 version `10.0.17763` or newer, through an installer or portable ZIP. These packaging facts do not establish ScreenFling’s own capture/accessibility permissions or process-lifecycle behavior.

WezTerm documents Unix-domain mux support across systems, with a WSL2 AF_UNIX interoperability caveat. Tier 1 should target native macOS and native Windows only. Treat WSL as a later, separate endpoint scope rather than silently treating it as native Windows.

For macOS, test both an installed app bundle and a CLI discoverable on PATH. For Windows, test installer and portable layouts, short/private socket paths, `windowsHide`, process-tree termination, and cleanup when the app exits. The adapter must pass the exact socket/domain selector rather than assuming the user’s foreground GUI is the intended target.

Sources: [macOS install](https://wezterm.org/install/macos.html), [Windows install](https://wezterm.org/install/windows.html), [mux domains and platform notes](https://github.com/wezterm/wezterm/blob/main/docs/multiplexing.md).

## Minimal adapter and conformance design

The first production seam can remain small:

```ts
type WezTermDestination = {
  adapter: "wezterm";
  instance: { selector: string; generation: string; version: string };
  paneId: number;
  context: { workspace?: string; title?: string; cwd?: string };
};

type WezTermAdapter = {
  preflight(): Promise<PreflightResult>;
  discover(): Promise<readonly WezTermDestination[]>;
  stageIfCurrent(request: StageRequest): Promise<
    "dispatched-unverified" | "stale" | "permission-blocked" | "failed"
  >;
};
```

`discover` runs the pinned JSON list and validates it at the main-process boundary. `stageIfCurrent` performs exactly one final pinned discovery, checks generation and pane identity, then sends bounded stdin bytes with explicit args. It must not focus/activate a window, select a “best” pane, or retry a possibly accepted send. Optional `get-text` evidence may improve diagnostics but must not upgrade the result to verified attachment.

Minimum conformance cases:

- two similar panes: discovery yields distinct exact IDs and repeated dispatch never crosses targets;
- literal notes containing spaces, quotes, Unicode, and shell metacharacters: bytes arrive literally, with no implicit Enter;
- agent key sequence unbound or remapped: result remains unverified/fails closed, never claims attachment;
- target close, mux restart, and socket replacement: old route returns stale and sends zero bytes to the replacement;
- deterministic replacement in the final revalidation/send interleaving: no retry, and uncertain process outcomes are surfaced as unverified/failed;
- malformed/oversized JSON, non-zero exit, missing binary, unsupported version, timeout, and abort: bounded, diagnosable, fail-closed results;
- packaged native macOS and Windows runs, including external GUI and owned-mux fixtures, with release-pinned WezTerm builds.

## Explicit gaps

- ScreenFling now has a production-tree adapter primitive with automated
  conformance coverage, but it is not wired into the product workflow. Existing
  native prototype evidence remains transport-level, not agent-attachment or
  visible-focus proof.
- WezTerm exposes no documented atomic revalidate-and-send or pane-generation API, so stale protection has an unavoidable race window.
- `send-text` is not a semantic agent API. Agent keybindings, terminal modes, remapped keys, and image-transfer behavior remain external dependencies.
- `get-text` reports screen text, not composer state; it cannot prove image attachment or turn completion.
- Real-agent, multiple-version, multiple-keymap, external-GUI, mux-restart, packaged macOS, and packaged Windows acceptance evidence is still required.
- Installer signing, executable discovery, trusted executable/config/socket
  ownership and permissions, Unix socket-directory modes, Windows ACLs,
  process-tree cleanup, and capture-permission UX are product work not established
  by WezTerm CLI documentation. They remain acceptance work before picker
  exposure.
- The JSON example is documented, but there is no separately versioned schema contract. Keep parser fixtures and a compatibility policy for additive/changed fields.

## Primary-source register

- [WezTerm CLI index](https://wezterm.org/cli/cli/index.html)
- [WezTerm CLI list](https://wezterm.org/cli/cli/list.html)
- [WezTerm CLI send-text](https://wezterm.org/cli/cli/send-text.html)
- [WezTerm CLI get-text](https://wezterm.org/cli/cli/get-text.html)
- [WezTerm CLI spawn](https://wezterm.org/cli/cli/spawn.html)
- [WezTerm multiplexing](https://wezterm.org/multiplexing.html)
- [WezTerm Unix domains](https://wezterm.org/config/lua/config/unix_domains.html)
- [WezTerm macOS installation](https://wezterm.org/install/macos.html)
- [WezTerm Windows installation](https://wezterm.org/install/windows.html)
- [WezTerm stable release](https://github.com/wezterm/wezterm/releases/tag/20240203-110809-5046fc22)
- [WezTerm pane source](https://raw.githubusercontent.com/wezterm/wezterm/main/mux/src/pane.rs)
- [WezTerm local mux listener source](https://raw.githubusercontent.com/wezterm/wezterm/main/wezterm-mux-server-impl/src/local.rs)
- [Node.js child-process API](https://nodejs.org/api/child_process.html)
