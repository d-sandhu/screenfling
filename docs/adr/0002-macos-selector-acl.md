# ADR 0002: Read-only macOS ACL inspection

Status: implemented. Original decision: September 13, 2026.

## Problem

Unix owner/mode checks can miss write access granted through macOS extended ACLs.
Node's file metadata does not expose those entries. Parsing `ls -le` cannot
reliably distinguish an absent ACL from an unsuccessful security metadata read.

## Decision

Use one small, unprivileged [C helper](../../tools/native/selector-acl.c).
Require `lstatx_np` to read security metadata successfully, then query
`FILESEC_ACL` to distinguish absent and present ACLs. A failed read is not absence.
Validate present ACLs and reject every allow grant; deny-only entries are accepted.
Compare file identity around inspection.

The helper accepts a bounded list of absolute paths and emits only a fixed,
versioned success token. Missing helper, malformed input, identity changes,
inspection errors, unexpected output, and timeouts reject the route. Main still
checks ownership, mode, file type, ancestors, and private socket parent.

## Tradeoff and verification

The no-grant rule can reject otherwise safe custom ACLs. For this experimental
integration, that restriction is preferable to implementing a general effective
permissions engine. It does not establish that a trusted user's executable or
Lua config is safe.

[Native helper tests](../../src/main/macos-selector-acl.test.ts) and
[selector tests](../../src/main/trusted-wezterm-acl.test.ts) use disposable files,
sockets, ancestors, and read-failure fixtures. Packaged lifecycle checks execute
the shipped helper too. These are not installed-agent or signing acceptance.

The helper is built by macOS Command Line Tools, packaged as a resource, and never
runs on Windows. It is not a screenshot backend, privileged daemon, or native
framework. See the [native-code boundary](../ARCHITECTURE.md#native-code-gate).

## Sources

[Apple filesystem permission model](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/FileSystemDetails/FileSystemDetails.html),
[security properties](https://github.com/apple-oss-distributions/Libc/blob/main/gen/filesec.c),
and [Darwin ACL iterator](https://github.com/apple-oss-distributions/Libc/blob/main/posix1e/acl_entry.c).
The [original record](https://github.com/d-sandhu/screenfling/blob/b7e321217faf94ee2016217405f3c39e1e872cb6/docs/adr/0002-macos-selector-acl.md)
contains the full investigation.
