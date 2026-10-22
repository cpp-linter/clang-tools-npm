# {{NAME}}

[clang-format](https://clang.llvm.org/docs/ClangFormat.html) {{VERSION}} as a static binary, for Linux, macOS and Windows on x64 and arm64.

```sh
npm install --save-dev {{NAME}}@{{MAJOR}}
npx clang-format -i src/*.cpp
npx clang-format --dry-run --Werror src/*.cpp   # check only, for CI
```

The npm version is the LLVM version. clang-format output changes between LLVM major versions, so pin one: `{{NAME}}@{{MAJOR}}` always installs the newest LLVM {{MAJOR}} release. Every major from LLVM 12 is published.

## How it is installed

This package has one optional dependency per platform, such as `{{NAME}}-linux-x64`, and npm installs only the one for your machine. Nothing is downloaded or run at install time, so it works with `--ignore-scripts`, pnpm, Yarn, offline caches and private registry mirrors.

## From Node.js

```js
const clangFormat = require('{{NAME}}');

clangFormat.binaryPath(); // absolute path of the clang-format binary
clangFormat.run(['--version']); // runs it and returns the exit code
```

## Where the binaries come from

They are built from the LLVM source by [cpp-linter/clang-tools-static-binaries](https://github.com/cpp-linter/clang-tools-static-binaries), with a GitHub build attestation for every file. Before publishing, the [release workflow](https://github.com/cpp-linter/clang-tools-npm) checks each binary's sha512 and attestation, and the packages are published from GitHub Actions with npm provenance.

Issues: https://github.com/cpp-linter/clang-tools-npm/issues
