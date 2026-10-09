# Release workflow

## Checks

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check:package
npm test
npm run test:install
npm pack --dry-run
```

Tests use disposable stores and mock DNS/HTTPS. Git install tests use a disposable
agent directory with no personal configuration or credentials. Do not run
`/webhook-test` as an automatic release check: it sends a real notification and
Discord mentions everyone.

## Runtime versioning

`src/core_v1.0.2.mjs` remains the immutable 1.0.2 implementation. The current
1.0.4 implementation is `src/core_v1.0.4.mjs`; `src/core.mjs` is its compatibility re-export. The extension imports the versioned implementation
explicitly because clearing Pi's factory cache does not evict native ESM caches.

For an implementation release, create a new `core_vX.Y.Z.mjs`, update VERSION and
User-Agent in that new file, the extension import, compatibility facade, package
version, tests, and documentation. Preserve and extend the same-process reload
regression test. Never edit a released versioned implementation in place.

The public 1.0.2 packaging release preserves the original runtime byte-for-byte.
No configuration migration or receipt reset is needed.

## Public exposure and license gate

Review all staged/tracked files and the pack list. Exclude node_modules, local
AGENTS, .pi, .peicd100, configuration, URLs/keys, delivery receipts, large logs,
fixtures and archives. Preserve upstream attribution if provenance is later
established. Do not change UNLICENSED to MIT or another general license without
confirming ownership and explicit maintainer authorization.

## Publish

Only with explicit authorization:

```sh
git add <reviewed-release-paths>
git commit -m "Release webhook package"
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

Do not force push or move published tags. Verify remote refs before retrying an
uncertain push. Consumers following the default branch use
`pi update git:github.com/peicd100/pi_webhook`; pinned tags do not advance.

After refs are public, verify the actual remote without personal Pi changes:

```sh
npm run test:remote
```

The script verifies v1.0.4 and the default branch for this release;
update those assertions deliberately for future releases. Record the exact
commit/tag and checks. CI failures are not waived by successful local tests.
