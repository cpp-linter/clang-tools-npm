# Contributing

## Build and test locally

Node.js 22 or newer and `tar` are needed.

```sh
node scripts/build.mjs --versions 23        # or "12 23", "latest", "all"
node test/smoke.mjs --version 23            # installs the packages for this machine and runs them
node test/smoke.mjs --version 23 --pm pnpm
npm test                                    # unit tests
node scripts/publish.mjs --dry-run          # what would be published
```

`build.mjs` writes the packages to `dist/packages/`, the tarballs to `dist/tarballs/` and the list to `dist/manifest.json`; downloads are cached in `.cache/`. Add `--verify-attestations` to check every file with `gh attestation verify` (needs `gh` and a GitHub token). `--only-missing` skips the versions that are already on npm.

A version is skipped by `--versions all` (and makes a named version fail) when its release has no `LICENSE.TXT`, or no clang resource headers for clang-tidy. Rebuild it in clang-tools-static-binaries first.

## Releases

The [Publish](.github/workflows/publish.yml) workflow runs daily and by hand (`versions`, `dry-run`). It packs every LLVM version from `index.json` that is not on npm yet, runs the smoke tests on all 6 platforms, and then the `publish` job waits in the `npm` environment for a maintainer's approval.

The newest LLVM major gets the dist-tag `latest`; older majors get `llvm-<major>`, so publishing an old version never changes what `npm install @cpp-linter/clang-tidy` installs. An npm version cannot be published twice: a rebuild of the same LLVM version in clang-tools-static-binaries (a new `-N` release) is not published again.

### One-time setup

npm trusted publishing can only be set up for packages that already exist, so the first run uses a short-lived token.

1. In this repository: Settings → Environments → New environment `npm`, with a maintainer as required reviewer and "main" as the only deployment branch.
2. On npmjs.com (with 2FA on): Access Tokens → Generate New Token → Granular Access Token, permission "Read and write" for the `@cpp-linter` scope, "Bypass two-factor authentication" checked (CI cannot answer a 2FA prompt), expiring after 1 day. Add it to the `npm` environment as the secret `NPM_TOKEN`.
3. Run the Publish workflow with versions `23`. This creates the 14 packages, with provenance.
4. Set up trusted publishing for all of them (npm 11.15 or newer; one 2FA prompt, then choose to skip 2FA for 5 minutes):

   ```sh
   for tool in clang-format clang-tidy; do
     for pkg in "$tool" "$tool"-{linux,darwin,win32}-{x64,arm64}; do
       npm trust github "@cpp-linter/$pkg" --repo cpp-linter/clang-tools-npm \
         --file publish.yml --env npm --allow-publish --yes
       sleep 2
     done
   done
   ```

5. Delete the `NPM_TOKEN` secret and revoke the token on npmjs.com.
6. Run the Publish workflow with versions `all`. From now on it publishes with the workflow's OIDC token.

When a new tool gets packages, its packages need steps 2–5 again.
