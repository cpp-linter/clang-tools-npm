import type { SpawnSyncOptions } from 'node:child_process';

/** Tool name, e.g. "clang-tidy". */
export declare const tool: string;

/** LLVM version of the binary, e.g. "23.1.3". */
export declare const llvmVersion: string;

/** Platforms with a binary, as `${process.platform}-${process.arch}`. */
export declare const supportedPlatforms: readonly string[];

/** Absolute path of the native binary for this platform. Throws if it is not installed. */
export declare function binaryPath(): string;

/** Runs the tool with `args` and returns its exit code. */
export declare function run(args?: readonly string[], options?: SpawnSyncOptions): number;

/**
 * Runs git-clang-format with the clang-format binary of this package and returns its
 * exit code. Only in @cpp-linter/clang-format, in versions that include the script
 * (it throws otherwise). Needs Python 3 on PATH.
 */
export declare function gitClangFormat(args?: readonly string[], options?: SpawnSyncOptions): number;
