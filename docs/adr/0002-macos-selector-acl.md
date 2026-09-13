# ADR 0002 — read-only macOS selector ACL inspection

Status: accepted narrow security boundary; native tuple acceptance remains open

Date: 2026-09-13

## Problem

The configured WezTerm executable, config, socket, and their ancestors must not
be mutable through an extended ACL grant that Unix owner/mode checks miss.
Node's stat metadata does not expose macOS ACL entries. Parsing `ls -le` is not
an adequate substitute: an omitted ACL is not proof that its security metadata
was read successfully. Depending on the macOS version, a denied read can also
make `ls` fail. Neither behavior is the security contract.

Darwin's `acl_get_link_np` returns NULL both when no extended ACL is present and
when reading it fails. Treating every NULL as failure incorrectly rejects clean
selectors; treating every NULL as absence would weaken the boundary.

## Decision

Use one small unprivileged C executable calling the documented Darwin security
APIs. Require a successful `lstatx_np` security read, then use
`filesec_query_property(FILESEC_ACL)` to distinguish absent ACLs from present
ones. A read or presence-query failure is never accepted as absence. Compare
file identity before, during, and after inspection.

For a present ACL, retrieve and validate it, then permit only deny entries. All
allow entries, including owner-only grants, fail closed. Darwin's entry iterator
returns zero for an entry and -1/EINVAL at its end; this is not the portable
POSIX iterator convention.

The helper accepts only a bounded list of absolute paths. An unreadable or
malformed ACL, changed identity, missing helper, nonzero exit, timeout, or
unexpected response disables this destination. Copy remains available. The
helper prints one fixed versioned success token and no paths, principal
identities, ACL text, screenshots, or notes.

Main continues to enforce owner, mode, type, canonical/lexical ancestors, private
socket parent, and generation checks. No permanent file, elevated runtime,
network service, new IPC authority, capture rewrite, or helper framework is added.
The executable is compiled by macOS Command Line Tools and included as a native
package resource. Windows does not build or run it.

## Evidence and limits

`macos-selector-acl.test.ts` contains real disposable-file checks for a clean
file without an extended ACL, a grant with unchanged private mode bits,
deny-only ACLs, missing paths, and a denied security read. The last fixture is
CI-only and changes ownership of its own disposable file, not a user's selector
or host settings. It tests rejection independently of `ls` output or exit status.
`trusted-wezterm-acl.test.ts` exercises grants on actual file/socket/ancestor
fixtures through the production selector reader. The packaged lifecycle runner
also executes the shipped helper against a disposable grant fixture.

These tests must pass in macOS CI. They do not approve a real WezTerm config,
agent binding, final endpoint race, or signed distribution identity. The strict
no-grant policy can reject otherwise safe custom ACLs; this is preferable to
interpreting an unproven effective-access policy for the experimental alpha.

## Sources

- [Apple ACL and BSD permission model](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/FileSystemDetails/FileSystemDetails.html)
- [Apple ACL file-read implementation](https://github.com/apple-oss-distributions/Libc/blob/main/posix1e/acl_file.c)
- [Apple security-property implementation](https://github.com/apple-oss-distributions/Libc/blob/main/gen/filesec.c)
- [Apple ACL entry-iterator implementation](https://github.com/apple-oss-distributions/Libc/blob/main/posix1e/acl_entry.c)
- [Architecture native-code gate](../ARCHITECTURE.md#native-code-gate)
