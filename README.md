# ScreenFling

Capture a screen region. Choose a coding session. Stage it without pressing Enter.

ScreenFling is a local desktop app for the part after taking a screenshot: getting
it into the right coding-agent session, with a short note, without submitting it.
It is built with **Electron, React, TypeScript, and Node.js**.

**Early development, macOS first.** Capture and clipboard copy are implemented.
Direct staging is an optional, experimental WezTerm integration. There is no
supported public release or verified agent compatibility list yet.

## Why this exists

When several coding sessions are open, taking a screenshot is easy. Finding the
right pane, pasting the image, and adding context is the repetitive part.
ScreenFling puts that handoff in one small workflow. It does not run an agent or
replace your terminal.

## Use it

1. Press **Cmd+Shift+9** on macOS, or click **Capture region**. Drag on one display.
2. Review the crop. Use **Copy only** for a normal image-clipboard handoff.
3. With [WezTerm connected](docs/usage.md#connect-wezterm-experimental), select a
   pane, add an optional note, and click **Stage, don’t send**.
4. Inspect the destination before submitting. **Reveal destination** is a
   separate action; ScreenFling does not press Enter for you.

Copy works without WezTerm. It copies the **image only**, not the note. Stage
reports **Staged — unverified** because a successful terminal write cannot prove
that the agent attached the image. Inspect the pane before trying another paste.

See [setup and troubleshooting](docs/usage.md) for permissions, shortcuts,
connection settings, and failure messages.

## Run from source

Use the Node version in [`.node-version`](.node-version) and the npm version in
[`package.json`](package.json). macOS also needs Apple's Command Line Tools
(`xcode-select --install`).

```bash
git clone https://github.com/d-sandhu/screenfling.git
cd screenfling
npm install --global npm@11.19.0
npm ci
npm start
```

The first start downloads the pinned Electron binary. On macOS, grant Screen
Recording to the app you are running, then quit and reopen it. For a local
application bundle, use `npm run package:mac`. Development and packaged apps can
have separate permission entries.

[Development and contribution guide](CONTRIBUTING.md) ·
[macOS test builds](docs/usage.md#macos-test-builds)

## Inside the app

The React interface handles selection, review, and feedback. Electron's Node.js
main process owns capture, clipboard access, settings, and terminal commands.
Zod validates the messages between them. There is no web server, database,
ScreenFling account, or hosted image service.

Three useful places to read the implementation:

- [Workflow rules](src/shared/workflow.ts): explicit states and operation IDs keep
  late events from changing a newer capture.
- [Capture controller](src/main/capture-controller.ts): capture and clipboard
  effects stay outside the UI, including cancellation and failure handling.
- [WezTerm transport](src/main/wezterm-process.ts): an established local
  connection prevents a replaced socket path from redirecting a pending write.

[Architecture and tradeoffs](docs/ARCHITECTURE.md) explains these decisions and
their limits. [Testing](docs/testing.md) separates browser fixtures, native
checks, and the observations still needed before release.

```bash
npm run check
```

This runs lint, TypeScript checking, and unit/helper tests. It is not a claim that
every desktop or agent combination works.

## Privacy and limits

ScreenFling keeps captures and notes in memory and does not upload them. The OS
clipboard and your chosen agent have their own storage and network behavior.
Saved shortcut and connection settings persist locally; diagnostics contain
counts and timings, not content.

One region on one display is supported per capture. Windows builds are checked
in CI, but Windows native acceptance is incomplete and direct staging is
macOS-only. Linux, remote sessions, screenshot history, and automatic submission
are not part of the current scope.

[Next work](ROADMAP.md) · [Security](SECURITY.md) · [MIT license](LICENSE)
