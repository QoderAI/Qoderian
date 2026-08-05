# Contributing to Qoderian

Thank you for helping improve Qoderian.

## Before you start

- Use Obsidian 1.7.2 or later on desktop.
- Install Node.js 24 and a working qodercli.
- Search existing issues before opening a new one.
- Do not include private vault content, credentials, or unredacted logs.

## Development setup

```bash
npm ci
npm run build
```

Copy `.env.local.example` to `.env.local` and set `OBSIDIAN_VAULT` only when
you want development builds copied into a local vault automatically. Local
environment files are ignored by Git.

## Quality checks

Run the complete local gate before opening a pull request:

```bash
npm run typecheck
npm run lint
npm run test
npm run test:coverage
npm run build
npm run release:check
npm run audit:prod
```

Tests that mock the SDK do not prove that a qodercli command supports
non-interactive SDK execution. Changes to commands, sessions, permissions, or
stream events should also be exercised manually against a real qodercli:

```bash
npm run smoke:qoder
```

This initialization-only check follows the official TypeScript model-selection
sample and does not send a model turn. Set `QODER_CLI_PATH` when qodercli is not
available on PATH.

## Naming conventions

- TypeScript, TSX, and script file names use `kebab-case`, including
  descriptive test suffixes: `qoder-chat-runtime.ts` and
  `input-toolbar.model-selector.test.ts`.
- Classes, interfaces, types, and enums use `PascalCase`.
- Functions and methods use `camelCase`.
- Entry points and conventional modules keep their natural lowercase names,
  such as `main.ts`, `index.ts`, and `types.ts`.

`npm run lint` enforces these conventions. Names required by Obsidian, the
Qoder SDK, or another external interface retain the spelling defined by that
interface.

## Pull requests

- Keep each pull request focused on one behavior or refactor.
- Add or update tests for behavior changes.
- Explain user-visible changes and migration impact.
- Preserve the Qoder-only service boundary; do not introduce provider routing
  without an agreed architecture change.
- Update `CHANGELOG.md` for user-visible changes.

By contributing, you agree that your contribution is licensed under this
repository's MIT License.
