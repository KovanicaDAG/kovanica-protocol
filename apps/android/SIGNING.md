# Android release signing

Release builds are signed with material that is **never committed**. The store that
used to live at `apps/android/keystore/release.keystore` was committed to a public
repository together with its credential, so it is treated as compromised: it has been
untracked and replaced, and `apps/android/keystore/` is now gitignored.

## Where the material lives

Outside the repository, on the machine that builds releases:

    <signing-dir>/release.keystore     # 4096-bit RSA, alias `kovanica`
    <signing-dir>/credentials.env      # chmod 600

`credentials.env` defines `KEYSTORE_FILE`, `KEYSTORE_PASSWORD`, `KEY_ALIAS` and
`KEY_PASSWORD`. It is the only place the credential is written. Keep it out of the
repository and back it up somewhere safe — losing it means you can no longer ship
updates to an app that is already published.

## Building a signed release

    set -a; . <signing-dir>/credentials.env; set +a
    cd apps/android && ./gradlew :app:assembleRelease

`apps/android/app/build.gradle.kts` reads the four variables through `signingSecret()`,
which checks the environment first and Gradle properties second
(`-PKEYSTORE_PASSWORD=...`, or `~/.gradle/gradle.properties`). There are no defaults
for the credentials: a release build without them fails at signing time rather than
falling back to a shared secret.

## Rotating

Generate a new store and credentials, then rebuild and re-publish. An app that is
already on a store cannot change its signing identity, so rotate only when the old
material is compromised or when you are establishing a new app identity.

## CI

The Android CI job builds the **debug** variant only, so it needs no signing material.
