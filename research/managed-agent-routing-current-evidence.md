# Managed-agent routing: current evidence

Research date: **2026-08-19**  
Scope: ScreenFling’s possible managed-agent adapters on macOS and Windows,
compared with adapters that address a user-owned terminal/application surface.

This is a dated evidence report, not a canonical product decision. It does not
change `PRODUCT.md`, `ARCHITECTURE.md`, or `ROADMAP.md`.

## Executive recommendation

Keep Gate B a surface-routing gate. It should prove that ScreenFling can select
one exact live local surface, stage an image and note without submitting or
stealing focus, reject stale targets, and report verification honestly. A
managed API cannot substitute for that proof: the official managed interfaces
below create or continue agent turns, while ScreenFling’s Stage contract is a
passive placement into a user-selected composer.

Add managed adapters only after the surface gate, behind a separate managed
session gate:

1. **First managed experiment: OpenAI Codex app-server (or its official SDK).**
   ScreenFling can own the app-server process/connection, address an exact
   `threadId`, send a local image as structured input, request a constrained
   result, and verify typed lifecycle events. This is a strong **verified Send**
   candidate, not a passive Stage adapter.
2. **Second managed experiment: Claude Agent SDK when local Claude Code
   semantics are required.** It provides exact session IDs, image-bearing
   streaming input, structured result messages, and a long-lived process, but
   ScreenFling must own that SDK process. It is not an API for attaching to an
   unrelated, already-running Claude Code TUI composer.
3. **Cloud option: Anthropic Claude Managed Agents.** It has explicit
   session/environment/agent identity, version pinning, image-bearing user
   events, status streams, and interrupt/redirect operations. It is a viable
   managed Send destination when cloud execution, API-key setup, beta API
   headers, and image upload are acceptable. It is not a local composer and
   should not be represented as one.

Keep Claude Code CLI, Ghostty, tmux, WezTerm, and similar integrations in the
surface-adapter family. The Claude CLI’s documented image-paste shortcut can
support a best-effort or read-back-capable Stage adapter only when a separate
surface control API supplies exact addressing. Claude session IDs alone do not
address a terminal composer.

## Terms used in this report

* **Passive Stage:** address a selected destination and place image/note input
  into an editable composer without starting agent execution. It must not press
  Submit/Enter.
* **Managed Send:** send structured user input to a ScreenFling-owned or
  provider-managed agent session and start execution. A typed completion event
  can support `sent-verified`, subject to target and version checks.
* **Surface adapter:** controls an existing user-visible terminal/application
  surface. Its primary identity is an exact live endpoint such as a terminal,
  pane, session, or cooperative bridge locator.
* **Managed adapter:** controls an agent protocol/session directly. Its primary
  identity is a provider-owned or ScreenFling-owned session/thread ID, not a
  window title or CWD.

These are different promises. A managed `threadId` is not proof that a visible
TUI composer contains a draft, and a terminal pane ID is not proof of a unique
agent conversation.

## Research method and source quality

Context7 was queried first, as required, for `/openai/codex` and
`/websites/code_claude_en_agent-sdk`. Its high-reputation results were then
checked against the owning first-party documentation/source. The source links
below are first-party OpenAI, Anthropic, or official vendor repositories. Web
pages and source trees were accessed or checked on 2026-08-19; page crawlers may
display an earlier crawl date.

The current official OpenAI changelog lists Codex CLI **0.148.0** on
2026-08-18. That is a useful release anchor, not a compatibility promise for
future releases. [OpenAI Codex changelog](https://learn.chatgpt.com/docs/changelog#month-2026-08)

## Comparison at a glance

| Candidate | Exact identity | Image path | Passive Stage into existing composer? | Structured verification | Lifecycle owner | macOS / Windows reach | User burden and security posture |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Codex app-server** | `threadId`, `turnId`; connection must initialize first | `turn/start` accepts `localImage` paths and image URL items | **No documented visible-composer Stage.** `thread/inject_items` can append prebuilt Responses items without starting a user turn, but the example is model-history text, not a composer draft or attachment chip | Strong: typed JSON-RPC responses and `turn/completed`; `outputSchema` applies to a turn | ScreenFling can spawn/own app-server or connect to a deliberately owned endpoint; server owns thread/turn state | Protocol is local stdio/Unix socket by default; Windows/macOS host support is a release/acceptance concern, not inferred from one machine | `codex` runtime/auth plus integration code. Keep stdio/Unix local; WebSocket is documented experimental/unsupported and requires auth/TLS for remote use |
| **Codex TypeScript/Python SDK and CLI** | SDK exposes start/continue/resume by Codex thread ID; CLI resume accepts session ID | SDK local-image entries become CLI `--image`; CLI resume also accepts `--image` | **No.** `run()`/`resume` with a prompt starts a turn; no official external draft-composer API | Strong streamed thread events, final result, and SDK output schema; CLI/SDK version must be pinned | SDK owns a spawned local Codex runtime; it is not an observer of an arbitrary existing TUI | Official package/runtime is intended for local use; test packaged macOS and Windows hosts explicitly | npm/pip and bundled/pinned runtime; local auth and sandbox policy remain integration responsibility |
| **Claude Code interactive CLI** | CLI session IDs/name/CWD identify saved conversation history, not a terminal endpoint | Clipboard image paste (`Ctrl+V`; `Cmd+V` in iTerm2; `Alt+V` on Windows) inserts an image chip | Surface-key Stage is documented as a CLI behavior, but there is **no official API found that injects into an arbitrary live composer without terminal control** | Session result/CLI output can verify a new turn, not passive chip insertion; terminal read-back depends on the surface adapter | User owns the interactive process; ScreenFling would need a separate terminal adapter | Documented shortcuts cover macOS and Windows, but terminal key mappings vary | User installs/authenticates Claude Code; automation needs terminal control permissions and must handle configurable keybindings |
| **Claude Agent SDK** | `session_id`; resume/fork/continue; session persistence is tied to project/CWD unless a `SessionStore` is used | Streaming user messages support base64 image blocks; local app reads image and encodes it | **No documented draft composer.** `query()`/`streamInput()` send user messages to an SDK-owned agent loop | Strong: `ResultMessage`/`SDKResultMessage` has subtype, session ID, usage; structured output validates JSON Schema and exposes `structured_output` | ScreenFling owns the long-lived SDK process/client; `close()` terminates the underlying process | TypeScript package bundles platform-specific native CLI optional dependencies; macOS/Windows packaging must be tested | npm/pip package, API auth, native optional dependency handling, and filesystem settings; process/session isolation must be explicit |
| **Claude Managed Agents API (beta)** | Provider returns exact session ID; session references exact agent and environment; event stream has session/thread identity | User events accept base64, URL, or Files API `file_id` image sources | **No.** Creating without initial events leaves an idle session; sending a `user.message` starts work. No draft/composer endpoint is documented | Strong lifecycle/status/event stream; use a provider event or adapter schema for completion evidence | Anthropic manages cloud session runtime; ScreenFling owns API client and session mapping | HTTP API is cross-platform from Electron; execution is Anthropic-managed or self-hosted environment, not local TUI | Console/API key, agent + environment resources, beta headers, cloud data handling, and image upload. Pin agent version for repeatability |
| **Anthropic Messages API** | No provider conversation/session identity; caller sends full history | Base64, URL, or Files API image content blocks | **No.** It is a stateless request/response API, not a composer | Typed response/stream events, but ScreenFling owns history and higher-level completion semantics | ScreenFling owns all conversation state and calls | HTTP API is cross-platform | API key and data-handling policy; lower setup than Managed Agents but no built-in agent runtime/session lifecycle |

The table’s “No” entries mean “no official passive composer API was found in
the cited first-party surface,” not that a provider could never add one. A
terminal key injection can still Stage in a specific surface, but that is a
surface adapter and must be evaluated with Gate B’s exact-routing harness.

## OpenAI Codex evidence

### Codex app-server: the strongest structured local candidate

**Documented facts**

* OpenAI describes app-server as the interface used by rich clients and says it
  is for deep integration with authentication, conversation history, approvals,
  and streamed agent events. The implementation is open source in the Codex
  repository. [Codex App Server](https://learn.chatgpt.com/docs/app-server)
* The protocol requires one `initialize` request and `initialized` notification
  per connection before other requests. `thread/start`, `thread/resume`, and
  `thread/fork` operate on explicit thread IDs. [Lifecycle and protocol](https://learn.chatgpt.com/docs/app-server#lifecycle-overview)
* `turn/start` requires a `threadId` and input; it starts Codex generation and
  returns a turn object. The server emits `turn/started`, item events, and
  `turn/completed`. `turn/interrupt` is explicit. [Turns](https://learn.chatgpt.com/docs/app-server#turns)
* Current docs accept `{ type: "localImage", path: "/..." }` in turn input,
  alongside text and image URL forms. `outputSchema` constrains the final
  assistant message for that turn. [Turns and local images](https://learn.chatgpt.com/docs/app-server#turns)
* Current docs also expose `thread/inject_items`: it appends prebuilt Responses
  API items to a loaded thread’s prompt history **without starting a user turn**.
  The documented example injects an assistant text item. The docs do not define
  this as a visible TUI composer draft, nor do they establish a passive image
  attachment chip. [Inject items](https://learn.chatgpt.com/docs/app-server#turns)
* App-server supports stdio JSONL by default, Unix sockets, and experimental
  WebSocket transport. OpenAI explicitly advises plain WebSockets only for
  localhost or SSH forwarding and calls the WebSocket command unsupported for
  production workloads; non-loopback listeners require explicit authentication
  and TLS. [Transports and remote mode](https://learn.chatgpt.com/docs/app-server)
* App-server can generate TypeScript or JSON Schema artifacts specific to the
  Codex version that generated them. Some API methods/fields require
  `experimentalApi` opt-in. [Version-specific schemas and experimental API](https://learn.chatgpt.com/docs/app-server)

**Engineering inference**

`thread/inject_items` is useful for a future “preload context” capability, but
it should not be called ScreenFling Stage unless an owned UI contract proves
that the user can review/edit the pending input before generation. The ordinary
`turn/start` path is a managed Send: it consumes text/image input and begins
execution immediately. The safe managed adapter can therefore expose
`Send`, `Interrupt`, and structured completion—not passive Stage.

The best lifecycle is for ScreenFling to spawn or deliberately register one
app-server endpoint, complete the handshake, record the exact server/runtime
version, resume a known thread ID, revalidate thread status, and start one turn.
It must not discover a random local app-server socket and treat its loaded
thread list as proof that a visible user composer is the selected destination.

### Codex SDK/CLI: useful managed process, still Send-only

**Documented facts**

* OpenAI’s Codex SDK docs describe a TypeScript library that starts, continues,
  and resumes local Codex threads; installation is `npm install
  @openai/codex-sdk`, requiring Node.js 18 or later. The Python SDK controls a
  local app-server and has a pinned Codex CLI runtime dependency. [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)
* The official TypeScript SDK source defines `startThread()` and
  `resumeThread(id)`. It says threads are persisted in `~/.codex/sessions`.
  [SDK thread source](https://github.com/openai/codex/blob/main/sdk/typescript/src/codex.ts)
* The SDK README accepts text and `{ type: "local_image", path }` entries;
  local images are forwarded to Codex CLI with `--image`. It also supports
  streamed structured events through `runStreamed()` and JSON Schema output.
  [TypeScript SDK README](https://github.com/openai/codex/blob/main/sdk/typescript/README.md)
* The official CLI source documents `codex exec resume SESSION_ID --image FILE
  PROMPT`. The prompt is the input sent after resuming. [Codex exec resume source](https://github.com/openai/codex/blob/main/codex-rs/exec/src/cli.rs)
* The Python SDK exposes `LocalImageInput(path)` and turns it into a
  `localImage` protocol item. [Python SDK input types](https://github.com/openai/codex/blob/main/sdk/python/src/openai_codex/_inputs.py)

**Engineering inference**

SDK `run()` and CLI `resume` are turn operations. They are excellent for a
ScreenFling-owned managed Send adapter and can produce typed completion evidence,
but they do not provide a passive way to place an image into the composer of an
arbitrary already-running Codex TUI. A terminal adapter can separately stage
into a Codex TUI if it has an exact terminal endpoint; the SDK does not remove
that routing problem.

The SDK reduces provider protocol work but increases packaging responsibility:
ScreenFling must select compatible SDK/CLI versions, preserve local auth and
sandbox settings, own subprocess lifetime, and run macOS and Windows acceptance
tests. The user should not be asked to install a second terminal or multiplexer
just because ScreenFling’s managed adapter exists.

## Anthropic evidence

### Claude Code CLI: image paste is a surface behavior

**Documented facts**

* Claude Code interactive mode documents `Ctrl+V`, `Cmd+V` in iTerm2, and
  `Alt+V` on Windows as image-paste shortcuts. The result is an `[Image #N]`
  chip at the cursor. Shortcut behavior varies by terminal. [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
* The action is named `chat:imagePaste`, and the keybinding can be changed or
  unbound. The default submit action is a separate `chat:submit` binding.
  [Keybindings](https://code.claude.com/docs/en/keybindings)
* Claude Code supports `claude --continue`, `claude --resume`, and
  `claude -r SESSION "query"`. Its docs describe these as resuming a saved
  conversation and, when a query is supplied, continuing with a new prompt.
  [CLI reference](https://code.claude.com/docs/en/cli-usage)
* Interactive sessions are saved in local transcript files under
  `~/.claude/projects/`, with session history tied to project directories and
  worktrees. [How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)

**Engineering inference**

The CLI’s image-chip behavior can be a Stage primitive only through a separate
surface adapter that can address an exact live terminal and, ideally, read back
the composer. A session ID from `--resume` identifies conversation history, not
the current terminal process, pane, cursor, or focused composer. Supplying a
query to `claude -r` starts agent work, so it is Send, not Stage. No official
Claude Code API cited here exposes “insert this image into the composer of that
already-running TUI and wait” as a standalone operation.

### Claude Agent SDK: local owned sessions with image input

**Documented facts**

* Anthropic describes Streaming Input Mode as a persistent, interactive session
  in which a long-lived process accepts user input, handles interruptions,
  permission requests, and session management. The example streams a user
  message containing text plus a base64 image block. [Streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)
* SDK sessions expose `session_id`; `resume` targets a specific session and
  `fork` creates another. Resuming generally requires the session transcript on
  the current machine and matching CWD; the docs recommend a `SessionStore` for
  cross-host persistence. [Work with sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
* The SDK emits lifecycle/result messages. `ResultMessage`/`SDKResultMessage`
  includes session ID, subtype, usage, and error information; partial API
  events can be enabled for streaming. [Agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop), [streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output)
* Structured output accepts JSON Schema (or Zod/Pydantic wrappers), validates
  the result, and exposes validated `structured_output`; a dedicated error
  subtype reports failure after structured-output retries. [Structured outputs](https://code.claude.com/docs/en/agent-sdk/structured-outputs)
* The TypeScript SDK is installed with `npm install @anthropic-ai/claude-agent-sdk`
  and bundles a platform-specific native Claude Code binary as an optional
  dependency. The docs warn that package managers which skip optional
  dependencies require a separately installed binary or `pathToClaudeCodeExecutable`.
  [TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)
* The SDK’s `close()` method closes the query and terminates the underlying
  process. [TypeScript Agent SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)
* The current session docs note that an experimental TypeScript V2 session API
  with `createSession()`/`send`/`stream` was removed in Agent SDK 0.3.142.
  [Session version note](https://code.claude.com/docs/en/agent-sdk/sessions)

**Engineering inference**

This is a credible managed Send adapter: ScreenFling can own one SDK client,
store the exact session ID and CWD, send a local capture encoded as a supported
image block, and wait for a typed result. It is not a passive Stage adapter.
`query()` and `streamInput()` deliver user messages to the agent loop; the docs
do not expose a draft composer or an attachment-only operation. The process
must be treated as an owned runtime with explicit shutdown, version checks, and
session-store policy. Do not attach ScreenFling to a user’s unrelated
interactive `claude` process and claim SDK-level verification.

The removal of the experimental V2 session API is a concrete versioning warning:
keep the adapter behind a narrow compatibility layer and pin tested SDK/native
binary versions rather than designing against undocumented convenience methods.

### Claude Managed Agents API: exact cloud session routing

**Documented facts**

* Anthropic’s Managed Agents API models an agent as a versioned configuration,
  an environment as the execution location, and a session as an agent instance
  within an environment. A session has conversation history and an exact
  session ID. [Define an agent](https://platform.claude.com/docs/en/managed-agents/agent-setup), [start a session](https://platform.claude.com/docs/en/managed-agents/sessions)
* A session can be pinned to a specific agent version. Creating a session with
  no `initial_events` leaves it idle; a non-empty `initial_events` list starts
  the agent loop. Sending a `user.message` event delegates work. [Start a session](https://platform.claude.com/docs/en/managed-agents/sessions)
* User-message content can include text, image, and document blocks. Image
  sources support base64 data, URL, or a previously uploaded Files API
  `file_id`. [Create Session API](https://platform.claude.com/docs/en/api/beta/sessions/create), [Send Events API](https://platform.claude.com/docs/en/api/beta/sessions/events/send)
* Communication is event-based. The API exposes session/agent/span events and
  a stream; sessions have explicit statuses such as `idle`, `running`, and
  `terminated`. [Session event stream](https://platform.claude.com/docs/en/managed-agents/events-and-streaming), [session operations](https://platform.claude.com/docs/en/managed-agents/session-operations)
* Managed Agents requests require the `managed-agents-2026-04-01` beta header
  (with a separate memory-store beta header); Anthropic’s SDK sets headers
  automatically. The quickstart requires a Claude Console account and API key,
  and describes installing the `ant` CLI and an SDK. [Managed Agents quickstart](https://platform.claude.com/docs/en/managed-agents/quickstart)
* Environments can be Anthropic-managed cloud sandboxes or self-hosted
  sandboxes. [Managed Agents quickstart](https://platform.claude.com/docs/en/managed-agents/quickstart)

**Engineering inference**

This is the cleanest Anthropic option for exact managed routing, but its
identity is `environment + agent/version + session (+ thread where applicable)`,
not a local window. ScreenFling can persist that tuple, revalidate status, send
one image-bearing `user.message`, stream events, and map termination to a
verified Send result. It cannot honestly call an idle session or an unsent
provider event a visible Stage draft: the documented event that supplies user
content starts work, and no draft/composer endpoint is described.

The cloud boundary must be visible in product copy and consent. A capture sent
to this adapter leaves the local machine for Anthropic’s API and the selected
execution environment. Self-hosted environments can alter data residency and
network risk but increase setup and operational burden. Pinning an agent version
is required for reproducible behavior; using the latest agent by ID is a moving
target.

### Anthropic Messages API: lower-level, caller-owned state

**Documented facts**

* The Messages API accepts structured text and image content, and supports
  base64, URL, and Files API image sources. [Vision](https://platform.claude.com/docs/en/build-with-claude/vision), [Create a Message](https://platform.claude.com/docs/en/api/messages/create)
* Anthropic explicitly calls the Messages API stateless: the caller sends the
  full conversational history on each request. [API usage primer](https://platform.claude.com/docs/en/claude_api_primer), [Working with messages](https://platform.claude.com/docs/en/build-with-claude/working-with-messages)

**Engineering inference**

Messages API can power a future ScreenFling-owned assistant destination, but it
is not a route to a Claude Code conversation or composer. ScreenFling would own
session IDs, transcript/history, retry policy, tool lifecycle, and any
structured result contract. It is therefore later than both a local surface
adapter and a provider-managed session adapter.

## Passive Stage versus Send: exact conclusions

| Operation | Officially supported by current evidence | What ScreenFling can verify |
| --- | --- | --- |
| Put image/note into arbitrary existing Claude/Codex TUI composer, do not submit | Only through a terminal/application surface control API; Claude documents the image-paste key, but not an external composer API | Surface endpoint accepted key/text; composer/image chip requires screen read-back or human observation |
| `codex app-server thread/inject_items` | Appends prebuilt Responses items without a user turn; docs do not promise visible composer state or image-chip semantics | Thread history mutation, if response succeeds; not a user-visible draft |
| Codex `turn/start`, SDK `run`, CLI `exec resume ... PROMPT` | Yes, structured user input starts generation | Typed turn/item events, final status, optional JSON Schema result |
| Claude Agent SDK `query`/`streamInput` | Yes, sends user messages into an SDK-owned long-lived agent | Typed session/result events and optional structured output |
| Claude Managed Agents `user.message` event | Yes, starts or steers cloud session work | Session status/event stream; agent/version/environment tuple |
| Anthropic Messages API request | Yes, generates a response from caller-supplied history | HTTP/stream response; caller-defined conversation and completion state |

The product model should therefore keep `Stage` and `Send` as separate adapter
capabilities. A managed adapter that starts work must not be presented as a
faster Stage button.

## Identity, revalidation, and verification contracts

### Surface adapters

The existing routing model is correct: endpoint scope, instance generation,
surface kind, and surface locator are the routing identity; CWD, repository,
worktree, branch, agent type, title, and inferred process are context evidence.
Revalidate the exact endpoint immediately before staging. A closed/replaced
surface becomes stale; never fall back to the focused or most-recent surface.

For an image-paste Stage, the minimum evidence is:

1. exact endpoint accepted the targeted input request;
2. no focus change and no submit key were sent; and
3. attachment/composer state is only marked verified if read-back or a
   cooperative receiver proves it.

Ghostty-style targeted Apple events can prove (1) while leaving (3) unknown;
that result remains `dispatched-unverified`. tmux/WezTerm/kitty/iTerm2-style
read-back can strengthen evidence but still needs agent/version-aware tests.

### Managed adapters

A managed destination should persist at least:

```text
provider + adapter version
transport endpoint / process generation
agent identifier + pinned version (when provider exposes it)
environment / cwd or sandbox identity
session or thread ID
active turn ID, when a turn exists
capability: send, interrupt, structured-output, image-input
observed status and timestamp
```

Before Send, revalidate the same provider endpoint and exact session/thread
identity. Do not use “most recent session,” “same repository,” or “same CWD” as a
substitute for the ID. For Codex, a turn’s `threadId` and streamed `turnId` are
the core identity. For Claude Managed Agents, retain agent/version, environment,
session, and stream/thread identifiers. For Claude Agent SDK, retain session ID
and the CWD/session-store namespace because resume can select the wrong history
when CWD differs.

Structured completion is not the same as safe execution. `turn/completed`, a
Claude `ResultMessage`, or a Managed Agents terminal event proves the provider
reported completion for the addressed session. It does not prove a human
reviewed the result, that an unrelated external UI updated, or that side effects
were harmless. ScreenFling should expose provider status and avoid stronger
claims.

## macOS and Windows reach

**Facts:** OpenAI’s app-server/SDK and Anthropic’s Agent SDK/Managed Agents are
protocols or packages that can be called from a desktop application; Claude Code
explicitly documents image-paste shortcuts for macOS/iTerm2 and Windows, and
Anthropic’s TypeScript SDK documents platform-specific native binaries.

**Inference:** cross-platform Electron reach is technically plausible for
managed Send adapters because the client can use stdio or HTTPS, but “the API is
cross-platform” is not the same as ScreenFling support. Gate each platform on:

* packaged runtime resolution (especially optional native dependencies);
* auth/account onboarding and credential storage;
* sandbox, filesystem, and network policy behavior;
* local image path/encoding and size limits;
* process shutdown and crash recovery;
* Windows code-signing/security-product behavior; and
* macOS Automation/Screen Recording permissions for any surface adapter.

The user must not be required to install Ghostty, tmux, WezTerm, Codex CLI, or
Claude Code solely to use a future managed adapter unless that dependency is an
explicitly selected surface destination. A managed adapter may bundle or spawn
its supported runtime, while a surface adapter necessarily targets the user’s
existing surface.

## Security and lifecycle implications

### Surface adapters

* Keep notes as data and use argument-array APIs; never interpolate them into
  AppleScript, shell, PowerShell, or key-sequence source.
* Request only the platform automation permission needed for the chosen adapter.
  Denial must produce Copy fallback, not focus-based automation.
* Clipboard state remains the user-visible fallback. Uncertain dispatches must
  not auto-retry because a duplicate image chip is possible.

### Local managed adapters

* ScreenFling owns subprocess lifetime, stdin/stdout framing, timeout, cancel,
  and crash recovery. App-server/SDK connection loss must not be interpreted as
  a completed turn.
* Pin tested runtime/API versions and generate or validate schemas against that
  version. Treat experimental protocol methods as opt-in and compatibility-risky.
* Store credentials in the OS credential facility or provider-approved auth
  path. Do not put bearer tokens/API keys in command arguments, logs, or
  renderer IPC.
* Apply explicit cwd, sandbox, network, approval, and writable-root settings on
  every managed turn. A provider’s default policy is not a ScreenFling product
  guarantee.

### Cloud managed adapters

* Make the egress boundary explicit before a capture is sent. Local-first
  defaults cannot silently route an image to Anthropic Managed Agents or another
  cloud API.
* Use provider file upload or bounded base64 handling with size/type checks;
  clean temporary files and record retention/cleanup state.
* Pin agent versions and record environment IDs. A latest-by-ID session can
  change behavior without a ScreenFling release.
* Use TLS, provider SDK auth, beta-header compatibility checks, and a clear
  failure result for expired credentials or a terminated session.

## What belongs in Gate B versus later milestones

### Gate B: exact-routing harness (now)

Gate B should remain provider-neutral and surface-focused:

* two instrumented live targets with exact endpoint IDs and duplicate labels;
* 100 alternating dispatches with zero wrong-target events;
* no focus changes and no Enter/submit events;
* stale/closed/replaced endpoint rejection;
* literal handling of quotes, backslashes, Unicode, and key-like note text;
* denied automation permission guidance and Copy fallback;
* no automatic retry on uncertain attachment state; and
* explicit `dispatched-unverified` when the surface cannot read back the
  composer.

Run the existing roadmap’s observed Stage trials for each terminal/agent version
proposed for support. Do not make a managed API pass Gate B merely because its
structured Send events are reliable; that tests a different capability.

### Managed session gate (later)

Create a separate harness for one owned managed runtime:

* start/resume an exact thread/session ID;
* attach one local PNG and bounded note as structured input;
* prove that a duplicate or wrong ID is rejected;
* capture streamed start, progress, interrupt, failure, and completion events;
* test crash/reconnect without duplicate Send;
* require a JSON Schema/typed completion fixture where the provider supports it;
* pin and report provider/runtime/SDK versions; and
* run the same acceptance on packaged macOS and Windows builds.

This gate may produce `sent-verified` for Codex app-server/SDK or Claude Agent
SDK/Managed Agents. It must not produce `staged-verified` unless a future
provider explicitly supplies an editable draft/composer API and the adapter can
verify it.

### Later demand-driven work

Prioritize based on user demand and maintenance capacity:

* Codex app-server adapter with explicit thread IDs, local images, output schema,
  and owned lifecycle;
* Claude Agent SDK adapter with session-store/CWD policy and structured output;
* Claude Managed Agents adapter if cloud execution and beta API obligations are
  product-compatible;
* provider-specific remote/self-hosted environments;
* cooperative registration from a running agent session; and
* surface read-back adapters for terminals with exact pane/session control.

Do not build a generic “agent plugin” abstraction yet. The evidence shows that
the stable seam differs between a terminal surface, a local owned process, and a
cloud-managed session. First maintain two or more real adapters and record
which identity, capability, lifecycle, and verification fields genuinely recur.

## Decision reversals to watch

Revisit the recommendation if any provider documents all of the following for a
supported version:

1. a stable API to address a user-visible existing composer by exact identity;
2. passive image/note insertion without starting a turn;
3. read-back or a typed attachment/composer-ready event;
4. explicit cancellation and stale-target semantics; and
5. a supported macOS/Windows installation and authentication path suitable for
   a desktop app.

Until then, a managed adapter is a structured Send destination; a surface
adapter is the route to passive Stage.
