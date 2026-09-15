# ADR 0003: Pin the WezTerm connection before dispatch

Status: implemented; native headless regression observed. GUI and agent
acceptance remain separate. Original decision: September 13–14, 2026.

## The reproduced failure

A generation check validated the configured socket path immediately before
launching the WezTerm CLI. The CLI connected afterward. Replacing the socket in
that interval could redirect the pending command to a different endpoint.

The [negative control](../../src/main/wezterm-process.test.ts) deliberately
reproduces that unsafe pathname-only behavior. Checking twice without retaining
the connection would leave the same kind of gap.

## Decision

For Stage and Reveal, [the transport](../../src/main/wezterm-process.ts):

1. Validates the selectors and connects to the chosen Unix socket.
2. Creates a private, unpredictable one-command socket in the validated parent,
   sets mode 0600, and checks its ACL.
3. Revalidates the original generation after connecting, before allowing traffic.
4. Runs the CLI with the explicit pane ID and its socket variable pointing to
   the temporary socket. One client forwards to the already-established upstream.
5. Closes connections, streams, and listener after completion or failure. It
   never resolves the original path again to reconnect.

The existing subprocess deadline covers setup and dispatch. Paths are limited
to 103 UTF-8 bytes and total bidirectional traffic to 1 MiB. Backpressure and
independent EOF handling preserve pending responses. Extra or premature clients
stop the transport. Read-only probes still use the bounded subprocess runner.

## What this does not prove

This removes the reproduced pathname-replacement gap. It does not identify the
agent inside a live pane or defend against root, a compromised same-user process,
or arbitrary replacement by a trusted principal. Abrupt main-process termination
can leave an empty socket pathname; future commands do not reuse it.

A failure after launch does not prove nothing arrived. Stage still reports
uncertainty and does not retry. Reveal stays a separate action. There is no
persistent service, TCP listener, agent read-back, or automatic submission.

## Evidence

Implementation `68476f1a7d51b680d6f3d83ac5cc3b4c729a55ec` was tested in
[run 34800803518](https://github.com/d-sandhu/screenfling/actions/runs/34800803518).
The native macOS fixture routed 100 uniquely identified alternating payloads;
a final-boundary replacement received zero connections and zero bytes. Separate
real-socket tests exercised 20 replacement interleavings. That run tested a PR
merge candidate, not a completed main-branch merge.

The [complete original record](https://github.com/d-sandhu/screenfling/blob/b7e321217faf94ee2016217405f3c39e1e872cb6/docs/adr/0003-pinned-wezterm-transport.md)
retains commits, limitations, and verification details. Current regression tests
are [real-socket conformance](../../src/main/wezterm-process.test.ts) and
[the pinned CLI fixture](../../src/main/wezterm-native.test.ts).

A receiver is not an agent composer. Installed config/binding semantics, restart,
no-focus Stage, visible Reveal, and real image attachment still require the
[operator checks](../acceptance/macos-operator-acceptance.md).

## References

[WezTerm send-text](https://wezterm.org/cli/cli/send-text.html) ·
[CLI instance selection](https://wezterm.org/cli/cli/index.html) ·
[bounded process runner](../../src/main/bounded-process.ts)
