# Phase 3 feasibility results

Research and validation dates: 2026-08-19 to 2026-08-20  
Status: permanent decision record; acceptance gaps remain release-blocking

## Decision

Proceed with the production capture and adapter implementation needed to finish
the feasibility gates; keep the macOS alpha release blocked. Electron capture met
the latency/resource threshold only for the tested single-display macOS reference
workload, and the adapter-neutral WezTerm routing primitive produced zero
wrong-target events on native macOS and Windows. That limited evidence does not
yet justify Rust or another native capture helper.

Implement WezTerm as the first exact surface Stage adapter. This is an optional
integration, not a requirement for ScreenFling's Copy workflow and not the
identity of the project. tmux remains the Unix exactness/read-back reference;
Ghostty is an optional macOS adapter. Managed Codex or Claude sessions are a
separate future Send capability.

This is a **conditional go**, not an alpha release approval. Milestone 0 remains
open until the untested capture environments and real-agent Stage trials below
pass. No document or UI may call WezTerm/agent staging supported yet.

## Evidence boundary

The disposable harnesses remain out of `main` as primary sources:

- [Capture Gate A branch at `21fc703`](https://github.com/d-sandhu/screenfling/tree/21fc70395c5b81d9455920efb84f52926ac1020b)
- [Routing Gate B branch at `e790ba3`](https://github.com/d-sandhu/screenfling/tree/e790ba3f1fa559093ac06f138a7648acd4b1d47a)
- [Native Windows routing run recorded by the prototype, 32387884325](https://github.com/d-sandhu/screenfling/actions/runs/32387884325)
- [Unchanged post-documentation Windows rerun, 32388127573](https://github.com/d-sandhu/screenfling/actions/runs/32388127573)

Only validated decisions, the preload packaging fix, pure coordinate mapping,
adapter contracts, tests, and this evidence summary move into the production
branch.

## Gate A — capture

### Reference configuration

- MacBook Pro `Mac16,8`, Apple M4 Pro, 48 GB RAM
- macOS 26.5.2 (build 25F84), arm64
- Electron 43.4.1 in a packaged, ad-hoc-signed app
- one display: 1512 × 982 DIP, scale factor 2, rotation 0
- requested and returned image: 3024 × 1964 physical pixels
- Screen Recording permission granted

No screenshot pixels or user clipboard content were stored in the repository.

### Results

Twenty fresh packaged automatic-overlay trials produced 20 non-empty clipboard
images:

| Measure | nearest-rank p95 |
| --- | ---: |
| Full-display capture | 101.28 ms |
| JPEG overlay preview encoding | 14.47 ms |
| Shortcut-path start to overlay ready | 124.73 ms |
| Crop | 0.0571 ms |
| Clipboard write | 23.63 ms |

The overlay displayed a snapshot taken before the overlay existed. A manual drag
confirmed it was not present in the captured pixels. The reference fractional
selection mapped from `(378, 217.75, 756, 435.5)` DIP to
`(756, 435, 1512, 872)` pixels by measuring returned width and height ratios,
flooring left/top, and ceiling right/bottom.

A 200-cycle packaged cancel run encoded the same preview as the interactive path:

- previous clipboard unchanged: yes;
- capture p95: 69.31 ms;
- RSS first/last: 138,559,488 / 136,347,648 bytes;
- RSS maximum: 140,132,352 bytes;
- fitted RSS slope: -21,421.60 bytes per cycle;
- post-cooldown RSS: 136,265,728 bytes.

This is evidence that observed native image allocations are reclaimable for the
tested workload, not a universal leak proof.

### Permanent capture decisions

- snapshot before showing the overlay;
- capture and select one display at a time;
- keep the lossless image in main and send a compressed preview to the renderer;
- map display-local DIP coordinates with independent ratios derived from actual
  returned image dimensions;
- bundle Zod into the sandboxed preload: externalizing it caused a packaged
  preload failure, and electron-vite 5 documents `build.externalizeDeps.exclude`
  as the current configuration surface;
- do not add native capture code.

### Gate A evidence still required

- end-to-end selection release to clipboard-ready p95, rather than separate crop
  and clipboard p95 values;
- mixed-scale multiple displays and negative desktop origins;
- rotated displays;
- display disconnect/reconnect and sleep/wake;
- Screen Recording denial and runtime revocation;
- native Windows capture, clipboard, and mixed-DPI behavior;
- a production workflow soak without prototype-only forced garbage collection.

## Gate B — exact routing

### Baseline

- WezTerm stable `20240203-110809-5046fc22`
- macOS arm64 ZIP SHA-256:
  `e77388cad55f2e9da95a220a89206a6c58f865874a629b7c3ea3c162f5692224`
- Windows x64 ZIP SHA-256:
  `57e5d03b585303d81e8b8e96d1230362852eb39aca92b3b29c7a42cfb82f9ac4`
- macOS reference host above
- native Windows Server 2025 x64 GitHub runner, build 10.0.26100

The harness owned one headless mux generation, addressed two panes with the same
title/CWD by exact pane ID, passed all note/key bytes through process stdin, and
re-listed the pinned instance before every dispatch. It never omitted
`--pane-id`, invoked `activate-pane`, read or changed the clipboard, or sent CR/LF.

### Results on each Tier 1 platform

| Check | macOS | Windows |
| --- | ---: | ---: |
| Alternating Stage operations | 100/100 | 100/100 |
| Exact CLI sends | 200/200 | 200/200 |
| Wrong-target writes | 0 | 0 |
| Enter bytes | 0 | 0 |
| Exact final receiver buffers | yes | yes |
| Closed target refused before send | yes | yes |
| Active-pane fallback | never | never |
| Focus/activation command | never | never |

The transport primitive passes cross-platform. Headless operation proves that
dispatch needs no focus command; it does not observe focus in a visible desktop
or prove that a coding agent interpreted the transported key as image paste.

### Permanent routing decisions

- the route key is adapter + instance generation + exact surface locator;
- names, CWD, repository, worktree, agent type, and revision are context evidence,
  never routing identity;
- revalidate immediately and compare the complete routing identity;
- stale or changed routes fail closed without an active-pane fallback;
- call Stage at most once; uncertain success is `dispatched-unverified` and is
  never automatically retried;
- verified Stage requires composer-ready and image-attached evidence in addition
  to a live target;
- keep surface Stage and managed Send as separate adapter families.

### Gate B evidence still required

- at least 30 observed Stage trials for every WezTerm/agent/version/keybinding
  combination proposed for support;
- visible desktop confirmation that target dispatch does not change app, window,
  tab, or pane focus;
- actual image-chip and literal-note behavior, including remapped/unbound image
  paste bindings;
- clipboard fallback through the full product workflow after stale, unsupported,
  failed, and uncertain Stage results;
- version-preflight behavior for unsupported stable/nightly builds and runtime
  mux restarts.

Claude Code 2.1.237 and Codex CLI 0.148.0 were present on the reference host, but
availability is not compatibility evidence; neither is claimed supported by this
record.

## Documentation validation

Context7 was used during integration:

- `/websites/electron-vite` confirmed that version 5 deprecates
  `externalizeDepsPlugin`, enables dependency externalization by default, and
  uses `build.externalizeDeps.exclude` to force a dependency into a bundle;
- `/websites/wezterm` confirmed JSON pane enumeration and the precedence of
  explicit mux-instance selection before GUI discovery.

Context7 returned no native Windows socket statement. The pinned official
WezTerm mux-server and local-listener source was therefore inspected directly;
it uses the local listener on Windows and contains Windows-specific Unix-socket
path handling. Primary-source links are collected in
[the routing surface report](routing-surface-current-evidence.md).

## Reversal criteria

Reconsider the current decisions if:

- the remaining capture matrix misses correctness/latency gates on supported
  hardware and both practical Electron capture paths fail;
- visible or real-agent WezTerm trials produce focus theft, wrong targets,
  duplicate attachments, or unreliable keybinding behavior;
- WezTerm's stable/nightly compatibility burden is not maintainable;
- another surface provides materially safer exact Stage on both Tier 1 platforms;
  or
- a provider exposes a supported passive composer API with exact identity and
  image-attachment read-back (which would still be Stage, not ordinary managed
  Send).
