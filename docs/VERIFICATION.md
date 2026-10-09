# Verification — 1.0.3

## Current release local evidence

- Full mocked suite: 27/27 PASS; no provider calls or actual webhook delivery.
- Package/public checks and disposable local Pi Git install/tag/list/load/remove PASS.
- Format-first/cancel/key behavior＋hyphen routes＋mocked real HTTPS POST/test identity＋same-process reload PASS.
- Remote publication/CI evidence is tracked in the workspace release record; do not infer it from local tests.

## Historical release evidence (superseded for current runtime/version)

# Verification scope

The target host is Pi coding-agent 1.1.0, resolved from devDependencies or
PI_TEST_HOST. No tests access signed-in provider credentials or send a real
webhook. Unit transports and DNS resolvers are injected/mocked.

Coverage includes endpoint restrictions, private/reserved addresses, DNS
pinning, TLS and redirect rejection, timeout/no-retry behavior, exclusive
claims, UNKNOWN receipt handling, metadata-only payloads, existing Discord
mentions, masked setup cancellation, non-interactive suppression and the
same-process versioned-module reload correction.

The local Git installation smoke verifies actual Pi CLI tag/branch installation,
listing/loading, genuine branch advancement, removal and retention of a dummy
private store, using an isolated agent directory and paths with spaces/non-ASCII
characters. The remote mode checks the actual public tag/default branch with
no repository mutations. Neither mode executes setup/test commands or runs an
agent conversation.

Windows mode bits are not an NTFS ACL qualification. Local-store permissions
must be checked separately; moving package code does not require moving the
user's existing protected store. Successful local tests do not claim observed
live-provider activation or endpoint delivery, or CI success on other OSes.

Run the commands in README.md and record the exact results for each release.
