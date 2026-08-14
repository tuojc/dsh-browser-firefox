# Agent Note: Browser profile bundle

Status: implemented

English | [中文](2026-08-14-browser-profile-bundle.zh.md)

## Problem

Installing the bridge as a plain profile dependency made its JavaScript resolvable but did not mount it in the `web` composition. The repository compensated with a root `--patch` file, so `pnpm start` could load the bridge while the standard `npx @deepseek-ai/dsh web` command could not. The two launchers therefore had different behavior and the bridge activation contract lived outside its package.

## Decision

The bridge package declares `dsh.bundle.patch` as `./cordis.patch.yml`, exports that file, and includes it in the published file set. The installer adds the linked package to the local `web` profile, allowing the Harness profile manager to register its patch layer.

`pnpm start` runs the workspace-pinned `dsh web`, while `npx @deepseek-ai/dsh web` runs npm's current public release. After installation, both commands resolve the same local profile bundle without a repository-relative `--patch` argument.

The bridge build invokes `tsdown` through the workspace script path. Runtime configuration, build tools, and plugin code all live inside this repository or its declared package graph; no command resolves dependencies from a parent checkout or parent `node_modules` directory.

## Alternatives considered

**Keep the root overlay and document an extra npx flag.** This would preserve two activation paths and would not make the standard npm command work as documented by Harness.

**Copy the patch into both the root and the package.** Duplicate configuration could drift or mount the plugin twice. The package owns the single profile layer.

## Verification

A clean lockfile install checks the public release dependency graph. Package assembly confirms that `cordis.patch.yml` is included. Isolated-home startup smokes add the bundle to a fresh `web` profile, boot both `pnpm start` and `npx @deepseek-ai/dsh web`, and require a successful `/ext/bridge-config` response.

## Consequences

The installer must run once for each dsh home that should expose browser control. The unversioned npx command follows npm's current dist-tag, so each Harness release still requires compatibility verification; the workspace-pinned command remains the reproducible path.
