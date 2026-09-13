# ADR 0002 — read-only macOS selector ACL inspection

Status: accepted narrow security boundary; native tuple acceptance remains open

Date: 2026-09-13

## Problem

The configured WezTerm executable, config, socket, and their ancestors must not
be mutable through an extended ACL grant that Unix owner/mode checks miss.
Node's stat metadata does not expose macOS ACL entries. Parsing `ls -le` is not
an adequate substitute: Apple's implementation treats `acl_get_link_np` failure
as an absent ACL. A security check must distinguish that failure from no grants.

## Decision

Use one small unprivileged C executable calling the documented Darwin ACL APIs.
It accepts only a bounded list of absolute paths. It validates ACLs and permits
only deny entries; all allow entries, including owner-only grants, fail closed.
An unreadable/malformed ACL, changed identity during inspection, missing helper,
nonzero exit, timeout, or unexpected response disables this destination. Copy
remains available. The helper prints one fixed versioned success token and no
paths, principal identities, ACL text, screenshots, or notes.

Main continues to enforce owner, mode, type, canonical/lexical ancestors, private
socket parent, and generation checks. No permanent file, elevated runtime,
network service, new IPC authority, capture rewrite, or helper framework is added.
The executable is compiled by macOS Command Line Tools and included as a native
package resource. Windows does not build or run it.

## Evidence and limits

`macos-selector-acl.test.ts` contains real disposable-file checks for an extended
grant with unchanged private mode bits, default deny-only ACLs, missing paths,
and an ACL-read failure hidden by `ls`. The last fixture is CI-only and changes
ownership of its own disposable file, not a user's selector or host settings.
`trusted-wezterm-acl.test.ts` exercises grants on actual file/socket/ancestor
fixtures through the production selector reader. The packaged lifecycle runner
also executes the shipped helper against a disposable grant fixture.

These tests must pass in macOS CI. They do not approve a real WezTerm config,
agent binding, final endpoint race, or signed distribution identity. The strict
no-grant policy can reject otherwise safe custom ACLs; this is preferable to
interpreting an unproven effective-access policy for the experimental alpha.

## Sources

- [Apple ACL and BSD permission model](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/FileSystemDetails/FileSystemDetails.html)
- [Apple ls ACL-read implementation](https://github.com/apple-oss-distributions/file_cmds/blob/main/ls/ls.c)
- [Architecture native-code gate](../ARCHITECTURE.md#native-code-gate)
