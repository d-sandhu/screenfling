# Phase 9 next-slice audit

Audit date: 2026-08-21

Scope: Immediate Implementation Sequence item 2; Gate A and Gate B only.

Evidence boundary: repository `main` at `64b1b16`, the canonical roadmap and
product/architecture contracts, and the Phase 8 plans/results. This report does
not claim acceptance or change product code.

## Requirement/evidence matrix

| Requirement | Current evidence | Status | Smallest remaining evidence |
| --- | --- | --- | --- |
| Gate A: one-display crop mapping and physical dimensions | Geometry fixtures, backend source-ID/geometry checks, and Phase 8 packaged macOS observation of 3024 x 1964 returned pixels | Partial; one named Retina host only | Repeat packaged run with fractional/edge selections and pixel read-back; hardware rows remain open |
| Gate A: shortcut to interactive overlay p95 <=150 ms | Phase 8 runner clicks the product button; its 377.33 ms value is not shortcut evidence | Open | Real global-shortcut samples on a packaged app |
| Gate A: selection release to clipboard-ready p95 <=150 ms | Provisional pre-hardening p95 106.51 ms; hardened runner has not repeated it | Open/provisional | Repeat hardened packaged runner and retain sanitized phase timings |
| Gate A: overlay exclusion, cancel/failure clipboard preservation | Snapshot-first implementation and unit tests; Phase 8 runner cannot fingerprint the production clipboard after cancel | Partial | Packaged sentinel-image cancel/failure run; visual/pixel evidence for overlay exclusion |
| Gate A: 200-cycle no-growth soak | 200 automated cancellations, one window each, cooled working set; no direct listener/native-allocation proof | Partial | Repeat accepted runner output; inspect only bounded, content-free counters |
| Gate A: mixed scale, negative origin, rotation, reconnect, sleep/wake, permission denial/revocation | Unit/event tests cover contracts, not compositor, TCC, or hardware state | Open/blocker | Native host matrix and stable packaged identity; human intervention for OS state where needed |
| Gate A: Windows capture/clipboard/mixed-DPI package evidence | No native Windows evidence | Open/blocker | Windows packaged host |
| Gate B: 100 alternating exact routes, stale refusal, literal bytes, no Enter/retry | Production adapter tests cover all; prior primitive passed native macOS/Windows transport harness | Strong primitive evidence, not acceptance | Keep as regression gate; no user-facing compatibility claim |
| Gate B: trusted executable/config/socket selectors | Absolute paths and generation hashing exist; owner/mode/ancestor/type policy is not implemented | Open, repository-testable | Add main-process fail-closed trusted-path policy and fixture tests |
| Gate B: no focus/frontmost change | No WezTerm installed; no visible trial | Blocker | Packaged macOS visible trial with unrelated frontmost app and focus observations |
| Gate B: real agent image attachment and no submission, 30 trials per tuple | Adapter advertises `readBack: none`; no real WezTerm/agent trials | Blocker | One pinned terminal/agent/keybinding tuple, human-observed 30-trial record |
| Gate B: replacement/socket race and actual attachment behavior | Deterministic fake final-guard test only; native replacement absent | Partial/blocker | Native WezTerm fixture and replacement run |

## Ranked options

1. **Add WezTerm trusted-path validation and tests (recommended).** Validate
   canonical executable/config/socket types, owner and write modes, every
   ancestor to a trusted boundary, and replacement identity before discovery
   and immediately before dispatch. This is issue-sized, production-relevant,
   requires no installed GUI or WezTerm, and closes a concrete fail-open gap in
   the Gate B plan. It does not claim Gate B acceptance.
2. **Repeat the hardened packaged capture runner with a content-free clipboard
   sentinel.** This converts the provisional 106.51 ms timing into current
   evidence and strengthens the 200-cancel row, but still cannot cover shortcut,
   pointer, permissions, or display topology without native/human state.
3. **Build a full native Gate A/B acceptance harness.** Highest evidence value,
   but not issue-sized here: it depends on macOS display/permission state,
   WezTerm, an agent binding, and visible observation. Do not add GUI automation
   or a native helper to simulate those facts.

## Recommendation

Make Phase 9 one narrow production slice: **trusted WezTerm selector policy**.
Add a main-process path-policy module used by adapter preflight and the final
dispatch guard. Fail closed to no destination (Copy remains available) for a
missing/dangling/non-regular executable or config, non-socket socket, unsafe
owner or group/other-writable leaf or ancestor, and any canonical identity/mode
replacement after discovery. Include device/inode, mode, owner, and canonical
path in generation evidence. Keep renderer configuration opaque and retain the
existing bounded subprocess, generation guard, no-focus, no-retry behavior.

This is the smallest safe improvement that strengthens the exact-target handoff
without pretending that CLI success proves agent attachment. After it lands,
run the existing full test gate and use a temporary-tree fixture suite as the
Phase 9 artifact. Separately schedule the hardened packaged timing/sentinel run
on the reference Mac; it is evidence work, not a second implementation slice.

## Exact tests and evidence

- Unit-test accepted user-owned executable/config/socket under a private `0700`
  tree; reject group/other-writable leaves and ancestors, wrong owner, missing
  path, dangling symlink, regular-file socket, and symlinked unsafe ancestor.
- Replace each selected path after discovery; assert preflight/final guard
  returns unavailable or stale and spawns zero send processes.
- Reject malformed config that would permit WezTerm's built-in config fallback;
  assert no picker destination and Copy remains possible.
- Preserve existing 100 alternating-route, literal-note, no-Enter, duplicate,
  timeout, stale-generation, and no-retry tests.
- Run `npm run check` (including Vitest and acceptance tests) and record the
  sanitized fixture results. No screenshots, notes, image bytes, clipboard
  contents, or paths outside the temporary fixture should be recorded.
- On the reference Mac, separately rerun `npm run acceptance:capture:package`
  with hardened timing and a sentinel image, then report shortcut/pointer,
  selection-to-clipboard, cancel-preservation, and soak rows independently.

## Explicit non-goals

No Gate A closure, Gate B closure, alpha claim, visible focus claim, real-agent
compatibility claim, Windows support claim, permission simulation, arbitrary GUI
automation, automatic retry/focus/Enter behavior, native ScreenCaptureKit or
Windows helper, new terminal/agent adapter, unsupported-result redesign, or
production diagnostics/content capture.

## Human/hardware blockers

The repository cannot establish real global-shortcut delivery, physical pointer
selection timing, mixed-scale/negative-origin/rotation/reconnect behavior,
sleep/wake, Screen Recording denial/grant/revocation, Windows capture or
mixed-DPI behavior, frontmost-app preservation, WezTerm replacement, or image
attachment in an agent composer. The current host lacks WezTerm; stable package
identity/TCC state and a native Windows host are also external prerequisites.
Those rows require the named packaged builds plus human/OS/hardware observation;
synthetic tests must remain explicitly partial evidence.

## Sources

- [ROADMAP.md](../ROADMAP.md)
- [PRODUCT.md](../docs/PRODUCT.md)
- [ARCHITECTURE.md](../docs/ARCHITECTURE.md)
- [Phase 8 capture lifecycle results](phase-8-capture-lifecycle-results.md)
- [Phase 8 capture acceptance plan](phase-8-capture-acceptance-plan.md)
- [Phase 8 routing acceptance plan](phase-8-routing-acceptance-plan.md)
- `src/main/wezterm-adapter.ts`, `src/main/configured-adapters.ts`,
  `tools/acceptance/capture.cjs`, and their tests
