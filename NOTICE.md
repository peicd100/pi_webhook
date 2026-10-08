# Provenance and third-party notices

This repository packages the maintainer's existing local
`pi-webhook-notifier` 1.0.2 distribution. Its extension, masked-input helper,
versioned runtime implementation and compatibility facade were copied without
behavior changes. Test SDK resolution and distribution tooling are portable.

The supplied local distribution did not include a LICENSE or copyright notice.
Its complete upstream provenance has not been independently established.
No new MIT or other general open-source license is inferred or granted here.
The maintainer must confirm rights and any upstream attribution obligations
before selecting a general open-source license.

Pi host APIs (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`) are
provided by the user's Pi installation. They are peer dependencies and are not
bundled as production dependencies. Development dependencies retain their own
licenses and are not part of the production Git dependency install.
