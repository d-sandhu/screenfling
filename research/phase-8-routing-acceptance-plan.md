# Phase 8 routing and visible real-agent acceptance plan

Research date: 2026-08-21
Scope: the next serious Gate B / Milestone 1 slice for the production WezTerm
adapter. This report does not change the support claim: the adapter remains an
opt-in developer experiment until the rows below have direct evidence.

## Recommendation

The smallest defensible next PR is one macOS acceptance harness plus trusted
path checks, for one pinned tuple:

```text
macOS version + packaged ScreenFling build
+ WezTerm stable version 20240203-110809-5046fc22
+ exact executable/config/socket paths
+ one named agent and exact version
+ one image-paste binding (including its raw bytes)
```

The PR should make the following repeatable rows pass before exposing that tuple
in the picker:

1. an owned two-pane byte receiver proves 100 alternating exact-pane writes,
   exact bytes, no CR/LF/Enter, and no write to the other receiver;
2. a visible no-focus trial proves that the selected pane changes while the
   WezTerm client focus and frontmost non-WezTerm application do not change;
3. an external GUI/mux restart or same-path socket replacement makes the old
   route stale and sends zero bytes to the replacement;
4. the real agent receives one image chip and one exact literal note in its
   idle composer, without submission, in 30 alternating trials; and
5. executable, config, socket, and parent-directory ownership/mode/replacement
   checks reject unsafe selectors before picker exposure.

Everything else stays outside this PR: Windows packaging, additional agents,
automatic keybinding discovery, verified Send, and a general GUI automation
fallback.

## What the current code already proves

The production adapter has useful transport-level coverage. It pins
`--config-file`, `WEZTERM_UNIX_SOCKET`, `--no-auto-start`, and
`send-text --no-paste --pane-id`; removes inherited `WEZTERM_PANE`; validates
bounded JSON list output; scopes pane routes to a generation fingerprint; runs
final generation checks; sends one joined image-key/note stdin payload; and
never retries an uncertain post-spawn result. The existing suite already covers
100 alternating fake-runner routes, duplicate/malformed discovery, stale pane
and generation refusal, final-guard interleaving, literal input, and no retry.

That is not visible acceptance. A WezTerm CLI success only means the CLI
accepted a request. It does not prove an agent composer was ready, an image was
attached, or a turn was not submitted. Keep runtime status
`dispatched-unverified` unless an agent-specific test supplies stronger evidence.

## WezTerm facts checked in primary sources

Context7 was queried first after resolving the current library ID to
`/websites/wezterm`. Its focused results were then checked against the official
documentation and source below.

* `wezterm cli` chooses an instance using `--prefer-mux`,
  `WEZTERM_UNIX_SOCKET`, or a GUI; without `--pane-id`, it falls back to
  `WEZTERM_PANE` and then the most recently interacted/focused pane. Therefore
  every ScreenFling list/send/read command must keep both the explicit instance
  selector and `--pane-id`.
  [CLI targeting](https://wezterm.org/cli/cli/index.html)
* `list --format json` exposes `window_id`, `tab_id`, `pane_id`, workspace,
  size, title, and CWD. `pane_id` is the exact live surface locator; the other
  fields are descriptive observations. The docs do not promise pane-ID
  non-reuse across a GUI/mux restart.
  [CLI list](https://wezterm.org/cli/cli/list.html)
* `send-text` sends text to a specified pane; `--no-paste` selects direct input.
  `activate-pane` is a separate operation explicitly described as activating
  (focusing) a pane and must never be part of Stage.
  [CLI send-text](https://wezterm.org/cli/cli/send-text.html),
  [CLI activate-pane](https://wezterm.org/cli/cli/activate-pane.html),
  [Pane `send_text`](https://wezterm.org/config/lua/pane/send_text.html)
* `list-clients --format json` reports each client’s
  `focused_pane_id`; it is a useful before/after focus observation, not a
  dispatch primitive. `get-text --pane-id` is text-only read-back and cannot
  prove an image attachment.
  [CLI list-clients](https://wezterm.org/cli/cli/list-clients.html),
  [CLI get-text](https://wezterm.org/cli/cli/get-text.html)
* WezTerm supports iTerm2 inline images and has `wezterm imgcat`, but its
  official image page warns that the image protocol is not fully handled by
  multiplexer sessions. ScreenFling’s path is therefore an agent’s clipboard
  paste binding, not native image bytes sent through `send-text`.
  [iTerm image protocol](https://wezterm.org/imgcat.html)
* `--config-file` overrides normal config resolution. If an explicit candidate
  cannot be loaded, current docs say WezTerm uses the built-in default config;
  acceptance must treat a malformed/missing selected config as a failure and
  must not infer that a successful CLI call loaded the intended file.
  [Configuration files](https://wezterm.org/config/files.html),
  [`config_file`](https://wezterm.org/config/lua/wezterm/config_file.html)
* Unix domains can be configured with an explicit socket path. The official
  config docs say `skip_permissions_check` bypasses secure socket ownership and
  is not recommended on multi-user systems. The official mux listener source
  creates user-owned directories, rejects Unix socket directories with group or
  other write bits, removes/rebinds an existing socket, and sets a sticky bit.
  [Unix domains](https://wezterm.org/multiplexing.html),
  [`config/src/unix.rs`](https://github.com/wez/wezterm/blob/main/config/src/unix.rs),
  [`wezterm-mux-server-impl/src/local.rs`](https://raw.githubusercontent.com/wez/wezterm/main/wezterm-mux-server-impl/src/local.rs)
* Current WezTerm source allocates pane IDs from a process-local atomic counter.
  This is implementation evidence, not a durable identity guarantee; a new
  mux generation can reuse a numeric pane ID. The selected socket/config/
  executable generation must therefore remain part of the route.
  [`mux/src/pane.rs`](https://raw.githubusercontent.com/wez/wezterm/main/mux/src/pane.rs)

## Exact acceptance tests for the next PR

### A. Deterministic exact-route and no-Enter conformance

Retain the existing unit test as the fast gate and add a real WezTerm fixture
that is isolated from the user’s default instance:

1. Start a pinned WezTerm mux/GUI with a private config and private socket
   inside a `0700` temporary directory. Use `--no-auto-start`; do not connect
   to or mutate the user’s default GUI.
2. Spawn two panes running a tiny checked-in receiver command. Each receiver
   writes raw stdin bytes, length, and a per-trial marker to a separate file or
   local pipe, then stays alive. Give both panes the same title and CWD so
   labels cannot accidentally route the test.
3. Discover with the exact socket/config. Assert the list contains each
   `pane_id` exactly once and store the adapter destination IDs.
4. Run 100 alternating Stage operations with notes containing quotes,
   backslashes, Unicode, `$PATH`, `<C-v>`, and key-like words. Assert the two
   receiver logs alternate exactly, every payload equals configured image bytes
   followed by the exact note, and no payload contains CR, LF, or the Enter
   byte.
5. Before and after each write, record
   `wezterm cli list-clients --format json`; every client’s
   `focused_pane_id` must remain unchanged. No command trace may contain
   `activate-pane`, `activate-tab`, `start`, `spawn`, or an omitted
   `--pane-id`.

The receiver is an exact transport oracle only. It must not be described as
proof that a real agent attached an image.

### B. Visible no-focus trial

The automated `focused_pane_id` check is necessary but not sufficient for an OS
focus claim. Run the packaged app with two visible panes and a third, unrelated
frontmost application (for example, TextEdit) as the precondition. Capture a
screen recording and a timestamped log of:

* frontmost application/window before and immediately after the Stage side
  effect;
* `list-clients --format json` focus IDs before and after;
* selected and unselected pane text/markers; and
* the exact adapter subprocess arguments.

Pass only if the selected pane receives the input, the unselected pane does not,
the WezTerm focused pane IDs do not change, and the adapter does not bring
WezTerm to the front. A test observer may use macOS Accessibility APIs or a
human recording review; this permission belongs to the acceptance harness, not
to the ScreenFling product. Account separately for ScreenFling’s own capture or
review window becoming frontmost: Gate B is about the dispatch transaction not
activating a terminal target.

Repeat with the other WezTerm pane selected and with the panes in different tabs.
Do not use `activate-pane` to arrange the test after the precondition; arrange
focus first, then leave it untouched.

### C. External GUI/mux replacement and stale refusal

Use two checks because the real race cannot be made atomic by the documented
CLI:

* **Deterministic final-boundary check (existing, keep as a required unit):**
  pause the fake process runner after final generation validation, replace the
  socket/generation, release the runner, and assert zero send processes and a
  `stale` result.
* **Native replacement check:** discover pane A on socket S, stop the external
  GUI/mux, start a replacement on the same S (with a new receiver and, where
  possible, a reused pane number), then Stage using the old destination. Assert
  the old route is `stale` or unavailable and the replacement receiver has zero
  bytes. Rediscover and Stage only the new destination; assert the new route
  works. Also replace S with an ordinary file or an unauthorized socket and
  assert no send is attempted.

The source listener explicitly removes/rebinds a socket and pane IDs are
process-local, so same-path/same-number replacement is the important test.
There is no documented compare-and-send operation: the final generation guard
narrows the check/use window but cannot mathematically eliminate it. Do not
claim atomic stale safety beyond the deterministic guard and native evidence.

### D. Real image-binding and agent acceptance

Start with exactly one declared combination, preferably the agent already
documented in the project’s existing evidence. Record agent product/version,
terminal version, WezTerm version, OS build, config hash, image-binding bytes,
keybinding source, and whether the agent is local/idle before each trial.

Use a fixed small PNG with a recognizable dimensions/hash and a note such as:
`phase8-'quotes'\\unicode-☃-$PATH-<C-v>`. Put the PNG on the OS image
clipboard, invoke Stage, and wait only for the composer to settle. For each of
30 alternating trials across two same-version idle agent panes:

* exactly one image chip/attachment indicator appears in the selected composer;
* the note appears once, literally and unsubmitted;
* the other composer has no image, note, Enter, or turn/history change;
* the selected agent remains idle (no request/turn starts); and
* the clipboard still contains the PNG for manual Copy fallback.

Use `get-text --pane-id` only to collect textual marker evidence. It may prove
the note or a product-specific `[Image #N]` marker when one is visible, but it
cannot by itself prove an image chip. The image chip and no-submit condition
need human observation or an agent-specific read-back API. Save a per-trial
record rather than only a final screenshot.

Run two negative binding trials before claiming compatibility:

* remap the agent’s image-paste action to a different key; and
* unbind the image-paste action.

The configured byte sequence is an external compatibility input, not a
universal terminal key. If the tested binding is remapped, unbound, or cannot
be established, picker exposure must be empty or Stage must return an
unsupported/failed result while leaving Copy available. It must never guess a
default key, press Enter, retry, or call OS-wide automation. Since the current
adapter has no distinct `unsupported` result, the smallest safe behavior for
this PR is to keep that tuple out of the picker and record the trial as a
compatibility failure; adding a first-class unsupported status can follow.

If the agent needs time between the image key and note for the chip to settle,
the combined-payload behavior must fail this tuple rather than gain an
arbitrary sleep or a second potentially duplicated send. Any supported delay
would need its own versioned compatibility fixture and one-side-effect proof.

## Trusted path and Unix-permission slice (macOS)

Absolute paths are not trusted paths. Before discovery and again at the final
dispatch guard, add a main-process check (never renderer-controlled) for the
configured executable, config file, socket, and their parent directories:

1. canonicalize with `realpath`/`lstat`; require the expected regular-file or
   Unix-socket type and reject missing, dangling, or unexpected paths;
2. require an owner policy of the current user or a root-owned system install;
   reject any group/other writable executable, config, socket, or parent
   directory; for the socket directory, use a private user-owned directory
   (mode `0700` is the acceptance default);
3. inspect every parent up to the trusted boundary, not only the leaf; reject
   a world/group-writable or attacker-owned ancestor and reject symlinked
   ancestors unless their canonical target passes the same policy;
4. require the executable to be executable and the config to be readable;
   require the socket to be a live local socket owned by the allowed user;
5. include canonical identity, device/inode, mode, owner, size/timestamps, and
   version in the generation evidence; re-run all checks at the final guard;
6. if any check fails, expose no destination and make Copy the only available
   result. Do not fall back to `PATH`, the default config, the active GUI, or a
   different socket.

The test matrix should create a private temporary tree and run these exact
cases:

| Case | Expected result |
| --- | --- |
| User-owned executable/config/socket and `0700` parent | discoverable; Stage allowed |
| Parent `0777`, `0755` with group write, or wrong owner | no destination; zero CLI sends |
| Executable/config group- or other-writable | no destination; no spawn |
| Socket replaced by regular file, dangling symlink, wrong owner, or unsafe parent | stale/unavailable; zero bytes |
| Executable/config/socket replaced after discovery at same path | stale/unavailable; replacement receives zero bytes |
| Malformed config that would cause WezTerm’s built-in fallback | unavailable; never treat CLI success as proof of selected config |
| Config uses `skip_permissions_check` or points to a different mux path | unavailable for the ScreenFling tuple |

The exact owner allowance (current user vs root-owned app bundle) should be a
small documented policy test, not an implicit platform assumption. Do not
silently accept an arbitrary Homebrew/symlink layout until its canonical target
and all ancestors pass the policy.

## Fail-closed result contract

The acceptance harness and product path must preserve these outcomes:

* invalid/unsafe config or path: no picker destination; Copy remains available;
* pane missing, socket/GUI restart, generation mismatch, duplicate pane ID, or
  final guard rejection: `stale`; send zero bytes;
* unavailable/denied CLI before process creation: `failed` (or a future
  `permission-blocked` subtype) with guidance and Copy;
* timeout, broken pipe, or non-zero result after process creation:
  `dispatched-unverified`, exactly once, with no automatic retry;
* a real agent/binding mismatch: unsupported/failed, never an assumed image
  attachment;
* no evidence of attachment or composer state: remain
  `dispatched-unverified`, never `staged-verified`.

No failure may select the active/recent pane, a same-title/CWD pane, a new
socket, a replacement endpoint, or an OS GUI-automation fallback.

## What cannot be automated in this environment

This host has no `wezterm` executable or installed WezTerm app, so the native
fixture, GUI focus, socket replacement, macOS permission, and packaged
ScreenFling trials are blocked here. Claude Code 2.1.238 and Codex CLI 0.149.0
are installed, but that is not evidence that either agent’s composer binding
works in an uninstalled WezTerm target.

Even on a fixture host, the following cannot be established from the current
WezTerm CLI alone:

* a semantic image attachment or agent composer readiness;
* a guarantee that a remapped key invokes the intended agent action;
* an atomic compare-and-send across external mux replacement;
* OS frontmost-window behavior without a visible observer/Accessibility test;
* support for an agent/terminal/version tuple that has not completed its own 30
  trials; or
* security of a path merely because it is absolute or because WezTerm CLI exits
  successfully.

Those are release evidence gaps, not reasons to broaden the adapter with
focus automation or a retry.

## Source register

* [Roadmap Gate B and Milestone 1](../ROADMAP.md)
* [WezTerm adapter results](phase-6-wezterm-adapter-results.md)
* [Joined-flow results](phase-7-joined-flow-results.md)
* [Current production adapter evidence](production-wezterm-adapter-current-evidence.md)
* [Current routing-surface evidence](routing-surface-current-evidence.md)
* [Architecture destination and stale-route contract](../docs/ARCHITECTURE.md)
* [WezTerm CLI targeting](https://wezterm.org/cli/cli/index.html)
* [WezTerm CLI list](https://wezterm.org/cli/cli/list.html)
* [WezTerm CLI send-text](https://wezterm.org/cli/cli/send-text.html)
* [WezTerm CLI list-clients](https://wezterm.org/cli/cli/list-clients.html)
* [WezTerm CLI get-text](https://wezterm.org/cli/cli/get-text.html)
* [WezTerm CLI activate-pane](https://wezterm.org/cli/cli/activate-pane.html)
* [WezTerm iTerm image protocol](https://wezterm.org/imgcat.html)
* [WezTerm configuration file resolution](https://wezterm.org/config/files.html)
* [WezTerm Unix-domain configuration](https://wezterm.org/multiplexing.html)
* [WezTerm Unix-domain source](https://github.com/wez/wezterm/blob/main/config/src/unix.rs)
* [WezTerm local mux listener source](https://raw.githubusercontent.com/wez/wezterm/main/wezterm-mux-server-impl/src/local.rs)
* [WezTerm pane-ID source](https://raw.githubusercontent.com/wez/wezterm/main/mux/src/pane.rs)
* [Claude Code interactive image-paste behavior](https://code.claude.com/docs/en/interactive-mode)
* [Claude Code keybindings](https://code.claude.com/docs/en/keybindings)
