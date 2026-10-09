# Changelog

## 1.0.5 — Dispatch timestamp suffix

- Append sender-local date/time with seconds and explicit UTC offset to all Generic/Slack/Discord notification text, including tests/errors/cancellations.
- Capture once after DNS and before POST; use the same instant for legacy generic finished_at. Keep Discord everyone before the final timestamp and preserve dedup identities.
- Add fixed-clock, timezone/day-rollover/fractional-offset/DST and post-DNS/dedup regression tests. Use immutable core_v1.0.5 for reload safety; no store migration or real webhook required for validation.

## 1.0.4 — Portable test-store fixture

- Create the explicit POST test fixture through the production Store so POSIX private-file checks are exercised correctly. Do not relax production permissions.
- Retain the 1.0.3 features; add immutable core_v1.0.4 for version/reload identity. Published 1.0.2 and 1.0.3 files/tags remain unchanged.

## 1.0.3 — Format-first setup and hyphen commands

- Select Discord / Slack / Generic first; Discord setup only asks for the URL and skips Bearer key.
- Register `/webhook-status`, `-setup`, `-test`, `-on`, `-off`, `-events`, `-clear`; `/webhook` lists commands. Space-separated subcommands are replaced.
- Explicit test sends a real POST with a clearly labelled test message and fresh identity; generic test event is `pi.webhook.test`.
- Add mocked setup/cancellation and HTTPS POST regression tests. Retain immutable core_v1.0.2 and create core_v1.0.3 for reload safety.
- Keep private store, no automatic retry and Discord everyone behavior unchanged.

## 1.0.2 — Public Git package

- Package the existing 1.0.2 implementation for Pi Git installation and updates.
- Add portable SDK resolution, package checks, isolated Git install/update/remove tests and CI.
- Replace machine-specific installation notes with public setup/security documentation.
- Preserve the same-process reload correction through `core_v1.0.2.mjs`.
- Preserve existing metadata-only, durable at-most-once/no-retry behavior and Discord `@everyone`.
- No runtime behavior changes, credential migration or receipt reset.

License selection remains pending; package metadata is UNLICENSED.
