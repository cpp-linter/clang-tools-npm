# {{NAME}}

[![part of cpp-linter](https://img.shields.io/badge/part%20of-cpp--linter-ffc20a?labelColor=454a63)](https://cpp-linter.github.io/)

[clang-format](https://clang.llvm.org/docs/ClangFormat.html) {{VERSION}} as a static binary, for Linux, macOS and Windows on x64 and arm64.

```sh
npm install --save-dev {{NAME}}@{{MAJOR}}
npx clang-format -i src/*.cpp
# check only, for CI
npx clang-format --dry-run --Werror src/*.cpp
```

The npm version is the LLVM version. clang-format output changes between LLVM major versions, so pin one: `{{NAME}}@{{MAJOR}}` always installs the newest LLVM {{MAJOR}} release. Older LLVM majors are under the [Versions](https://www.npmjs.com/package/{{NAME}}?activeTab=versions) tab, such as `{{NAME}}@18`.

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

[Website](https://cpp-linter.github.io/) · [Source](https://github.com/cpp-linter/clang-tools-npm) · [Issues](https://github.com/cpp-linter/clang-tools-npm/issues) · [Discussions](https://github.com/orgs/cpp-linter/discussions)
