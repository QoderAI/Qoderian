# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Layer ownership and SDK lifecycle rules live in `ARCHITECTURE.md`. The local quality gate and naming rules live in `CONTRIBUTING.md`.
- Obsidian's `addClass`, `removeClass` and `toggleClass` call `classList.add` or `classList.remove` without checking the current state, so every call rewrites the `class` attribute and notifies `MutationObserver`s even when nothing changes. Check `hasClass` before writing inside any subtree an observer watches, or the observer re-triggers itself every frame. Test doubles for these helpers must write unconditionally too (see `tests/unit/features/chat/controllers/context-row-overflow.test.ts`); `classList.toggle(cls, force)` hides the loop.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
