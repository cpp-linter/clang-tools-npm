## Only the lines you changed

This version also has `git-clang-format`, LLVM's script that formats only the lines that changed in git, with the clang-format of this package. It is a Python script, so Python 3 must be on `PATH`.

```sh
npx git-clang-format               # the lines changed since the last commit
npx git-clang-format main          # the lines changed since main
npx git-clang-format --diff main   # print the changes instead of making them
```

From Node.js: `require('{{NAME}}').gitClangFormat(['--diff', 'main'])`.
