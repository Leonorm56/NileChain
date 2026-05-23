This file provides guidance to AI coding agents like Claude Code (claude.ai/code), Cursor AI, Codex, Gemini CLI, GitHub Copilot, and other AI coding assistants when working with code in this repository.

## Project snapshot

- Package: `close-with-grace` (CommonJS)
- Runtime: Node.js (CI tests on Node 18, 20, 22, 24)
- Purpose: install process-level handlers for signals/errors/`beforeExit` and run one graceful-shutdown callback before exiting.

## Development commands

All commands are run from repository root.

- Install deps: `npm install`
- Build: **none** (plain JavaScript, no build pipeline)
- Lint: `npx standard`
- Tests (full, same as CI): `npm test`
  - Runs: `standard && npm run test-only && tsd`
- Tests (runtime JS only): `npm run test-only`
  - Runs: `tape test/*.test.js | tap-dot`
- Single runtime test file: `npx tape test/close.test.js | npx tap-dot`
- Type definition tests only: `npx tsd`

## High-level architecture

### Core flow

- `index.js` exports `closeWithGrace(opts?, fn)`.
- On setup, it registers `process.once(...)` handlers for three event groups:
  - signal events from `events/signal.events.js`
  - error events from `events/error.events.js`
  - exit events from `events/exit.events.js`
- `opts.skip` removes selected events from those registration lists.
- When the first handled event arrives, `run(out)` executes:
  1. removes initial `once` handlers,
  2. installs secondary handlers (`process.on`) that force immediate exit on a second signal/error,
  3. sets `closeWithGrace.closing = true`,
  4. executes user callback via promise or Node-style callback bridge,
  5. races callback completion vs optional timeout (`opts.delay`),
  6. exits with code `0` or `1`.

### Exit/timeout semantics

- Default timeout is `10000ms`; timeout can be disabled by non-number `delay` (e.g. `false`).
- On timeout or second signal/error, library exits with code `1`.
- If graceful callback handles a normal signal/manual close and resolves, exit code is `0`.
- Logging uses `opts.logger` (default `console`); disable by passing falsy non-object/function.
- Hooks `onSecondSignal`, `onSecondError`, `onTimeout` override default logger behavior, but process exits immediately afterward.

### Public API shape

- Return value from `closeWithGrace(...)`:
  - `close()` triggers manual shutdown path (`manual: true`)
  - `uninstall()` removes all registered first-pass handlers
- Mutable module flag: `closeWithGrace.closing` indicates shutdown has started (used by server code to reject new work).

### TypeScript contract

- `index.d.ts` defines overloaded signatures for async and callback styles.
- `index.test-d.ts` verifies API typings with `tsd`; keep typings and runtime options in sync when adding/changing options.

### Test strategy

- `test/close.test.js` is the main behavior suite.
- Tests fork fixture scripts under `test/` and assert process exit code, stderr/stdout, signal behavior, and timing.
- Many assertions are timing-sensitive (500ms delay paths). Avoid introducing flakiness when modifying timeout logic.

## Change guidance

- If adding/removing handled events, update:
  1. corresponding file in `events/`
  2. README API docs
  3. tests covering event behavior
  4. type definitions if public option surface changes
- Any change to shutdown/exit behavior should be validated with `npm test` (not only individual tests).
