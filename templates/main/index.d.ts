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
