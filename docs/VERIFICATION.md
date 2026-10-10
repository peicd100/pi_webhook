# Verification — Webhook1.1.0 session/default preferences

- Targeted21/21 plus actualSDK1/1; full42/42 PASS. Package and disposable local Pi Git tag/branch install/list/load/update/remove PASS; config/preferences/receipts retained.
- New-dialog defaultOff, pre-setup default selector/args, global-master/session separation, explicit default snapshot adoption, legacy migration, cancellation/busy, corrupt state fail-closed, no automatic SDK/print/RPC alerts tested.
- Real SessionManager resume/fork/tree/compaction keeps raw policy and excludes custom entries from model context; actual AgentSession TUI commands call no model, reload does not resend, mock greeting/notification gates PASS.
- Session switch during awaited config read cannot submit stale terminal; sessionOff aborts pending DNS before POST and retains claim; privacy/payload/time/DNS/TLS/dedup/no-retry regression PASS.
- No real providers/POSTs, no personal configuration writes or live Docker/reload. Immutable1.0.5 core retained. Empty/--no-session dialogs are limited by Pi persistence; no end-to-end live Discord delivery claimed.
- Public Git refs/smoke/threeOSCI are release gates recorded against exact published commit.

## Historical evidence (not current execution authority)

# Verification — 1.0.5

- Local targeted timestamp/core/reload18/18 and full mocked30/30 PASS.
- Timezone child-process tests cover UTC/Taipei/Kathmandu/New_York DST and day rollover; DNS-to-POST capture and dedup PASS.
- Package check and disposable local Pi Git tag/branch install/update/load/remove PASS. No actual webhook/provider requests.
- Remote refs/install/CI verification is recorded with the release task; local PASS alone does not prove it.

## Historical evidence (not current version authority)

# Verification — 1.0.4

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

### Historical 1.0.3 CI correction

The published1.0.3 Windows job passed; POSIX jobs rejected an insecure test-only dummy config.1.0.4 creates that fixture using Store.writeConfig; no production security behavior was weakened. Original CI evidence is retained in the workspace release record.
