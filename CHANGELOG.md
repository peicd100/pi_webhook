# Changelog

## 1.0.2 — Public Git package

- Package the existing 1.0.2 implementation for Pi Git installation and updates.
- Add portable SDK resolution, package checks, isolated Git install/update/remove tests and CI.
- Replace machine-specific installation notes with public setup/security documentation.
- Preserve the same-process reload correction through `core_v1.0.2.mjs`.
- Preserve existing metadata-only, durable at-most-once/no-retry behavior and Discord `@everyone`.
- No runtime behavior changes, credential migration or receipt reset.

License selection remains pending; package metadata is UNLICENSED.
