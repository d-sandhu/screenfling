# Security policy

ScreenFling handles screenshots, clipboard data, terminal destinations, and
operating-system automation. Treat security and privacy bugs as product bugs.

## Supported versions

ScreenFling is pre-alpha and has no supported release yet. This policy will be
updated with supported version ranges before the first public release.

## Reporting a vulnerability

Do not open a public issue containing exploit details, credentials, private
screenshots, clipboard contents, terminal contents, or other sensitive data.

Use GitHub's private vulnerability-reporting flow when it is available for this
repository. If it is not available, contact the repository owner through their
GitHub profile to request a private reporting channel before sending technical
details.

Include only what is necessary to reproduce and assess the issue:

- affected commit or version;
- operating system and destination adapter;
- expected and observed behavior;
- minimal reproduction steps;
- security impact;
- whether any user content was exposed or persisted.

The project will acknowledge a usable private report, investigate it, and agree
on a disclosure timeline before publication. Exact response targets will be set
when maintainership and public releases begin.

## Sensitive areas

Reports are especially valuable for:

- Electron preload or IPC privilege escalation;
- renderer sandbox, navigation, or content-policy bypass;
- command or AppleScript injection through destination data or notes;
- wrong-target routing or stale-target fallback;
- unintended Enter, submission, or focus automation;
- screenshot, clipboard, note, source-code, or terminal-content logging;
- insecure temporary-file creation or cleanup;
- permission confusion or automation without clear user intent;
- dependency, update, installer, signing, or release-artifact compromise.

## Security invariants

ScreenFling is designed to preserve these rules:

- renderers do not receive raw Node.js or Electron privileges;
- all IPC senders, operations, states, and payloads are validated;
- selected routing endpoints are revalidated immediately before dispatch;
- a stale destination never falls back to an active or similarly named target;
- generic adapters never submit or synthesize Enter;
- notes and destination identifiers are passed as data, never shell source;
- uncertain dispatch is not retried automatically;
- captures and notes are excluded from diagnostics;
- permanent storage and network transfer require explicit product behavior;
- unsupported capability combinations fail closed to Copy.

See [the architecture](docs/ARCHITECTURE.md) for the complete trust-boundary and
adapter model.
