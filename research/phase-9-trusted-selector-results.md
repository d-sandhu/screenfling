# Phase 9 trusted selector results

Research and validation date: 2026-08-21

Status: repository-testable macOS selector policy implemented; Gate A, Gate B,
and the macOS alpha remain open.

## Outcome

The experimental WezTerm adapter now validates its configured executable,
configuration file, and mux socket before any subprocess is allowed to start.
Unsafe or replaced selectors fail closed to no destination or a stale/failed
Stage result. ScreenFling does not retry, choose another pane, activate a window,
or send bytes to a replacement; Copy remains available.

This phase also hardened the packaged capture runner after an unattended smoke
left the capture overlay visible and required the operator to press Escape. That
run is discarded. The headless regression suite now requires a bridge action to
close its overlay and explicitly closes an overlay retained by a readiness or
action failure. No further native capture UI was opened while validating this
phase.

## Selector policy

| Selector | Required leaf policy |
| --- | --- |
| Executable | Canonical regular file; current-user or root owner; no group/other write bits; executable by the running process |
| Config | Canonical regular file; current-user owner; no group/other write bits; readable by the running process |
| Socket | Canonical Unix-domain socket; current-user owner; no group/other write bits; canonical parent owned by the current user with no group/other permissions |

Every lexical path entry and canonical ancestor must be owned by the current
user or root. Non-symlink entries may not be group- or other-writable, and
non-leaf entries must be directories or symlinks. Both path views are inspected
so a writable directory hidden behind a lexical symlink does not bypass the
policy. All failures cross the adapter boundary as one generic error without a
configured path.

The generation fingerprint covers the version plus each selector's lexical and
canonical path, device, inode, mode, user and group owner, size, and birth,
change, and modification timestamps. Preflight reads that evidence before the
version probe, supplies a second check at its immediate spawn boundary, and
requires unchanged evidence after it. Pane listing and final send each have the
same immediate before-spawn guard; discovery also checks again after parsing the
list.

This narrows the check/use window but cannot make a pathname-based CLI operation
atomic with filesystem replacement. The policy protects against untrusted
shared path components; it does not claim protection from a malicious process
already running as the same user.

## Automated evidence

The trusted-selector fixtures use real temporary files and a real local
Unix-domain socket on macOS. They cover:

- a valid private current-user selector tree;
- a regular file masquerading as the mux socket;
- group-writable leaves and canonical ancestors;
- a writable ancestor hidden by a lexical symlink;
- a mismatched expected user;
- a non-private socket parent;
- an executable without execute access and a config without read access;
- a replaced socket producing a different generation;
- initial trust failure producing zero version requests;
- replacement before version or list spawn producing zero subprocesses at that
  boundary;
- the existing final send guard producing zero sends to a replacement.

The capture-runner regression is deterministic and headless. It proves that a
bridge response without a page close is rejected and invokes emergency overlay
closure, and that an overlay which never reaches `selecting` is closed before
the runner reports its timeout. This is runner-contract evidence, not a new
packaged capture result.

The normal quality gate still includes Prettier, strict TypeScript, type-aware
Oxlint, all vendored generic anti-slop rules at error severity, Vitest, the Node
acceptance-runner tests, the production build, and native packaging.
The Phase 9 branch passed that gate with 175 Vitest tests, ten headless
acceptance-runner tests, and an ad-hoc signed macOS arm64 directory package.
Packaging did not launch the application or open a capture surface.

## Research decisions

Context7 was used with `/websites/wezterm` before implementation. The current
WezTerm documentation confirms explicit `--config-file` selection, explicit mux
socket selection through `WEZTERM_UNIX_SOCKET`, and the secure default ownership
check for Unix-domain sockets. It also documents that a config load or parse
failure can fall back to built-in defaults. ScreenFling therefore does not
pretend to validate arbitrary Lua with a home-grown parser; exact config
semantics remain a pinned native acceptance row.

The separate
[permission acceptance plan](screen-recording-permission-acceptance-plan.md)
used Context7 with `/electron/electron` and first-party Apple documentation. It
recommends a future pure permission-policy slice while preserving the exact
packaged application and human-operated TCC checks. It is planning evidence, not
part of the Phase 9 implementation. No permission simulation or native helper
was added here.

## Remaining release blockers

- macOS extended ACLs are not exposed by the current Node filesystem seam and
  are not yet inspected. Mode/owner validation must not be described as complete
  platform authorization validation.
- Arbitrary WezTerm Lua semantics are not parsed. A pinned real configuration
  must demonstrate that it loads without built-in fallback and that its image
  binding stages without submission.
- WezTerm is not installed on the reference host, so this phase contains no
  visible no-focus, native socket-replacement, or agent-attachment evidence.
- Thirty observed Stage trials remain required for every terminal, agent,
  version, and binding tuple proposed for support.
- Real global-shortcut, physical-pointer, display-topology, sleep/wake,
  Screen Recording permission, stable signing identity, clipboard-preservation,
  and Windows rows remain outside this repository-only phase.

## Sources

- [WezTerm configuration files](https://wezterm.org/config/files.html)
- [WezTerm multiplexing and Unix domains](https://wezterm.org/multiplexing.html)
- [WezTerm `list`](https://wezterm.org/cli/cli/list.html)
- [WezTerm `send-text`](https://wezterm.org/cli/cli/send-text.html)
- [Electron system preferences](https://www.electronjs.org/docs/latest/api/system-preferences)
- [Phase 9 next-slice audit](phase-9-next-slice-audit.md)
- [Screen Recording permission acceptance plan](screen-recording-permission-acceptance-plan.md)
- [Roadmap](../ROADMAP.md)
- [Architecture](../docs/ARCHITECTURE.md)
