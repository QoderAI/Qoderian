# Architecture

Qoderian is an Obsidian product built specifically on Qoder CLI. It does not
carry a provider abstraction, provider registry, or compatibility layer from
Claudian. The architecture makes the Qoder dependency explicit and keeps its
protocol details in one place.

## Layer ownership

```text
main.ts / app
  ├── features ──► core
  │      └───────► qoder
  └──────────────► qoder

qoder ───────────► core
shared ──────────► core (types and host utilities only)
```

- `app/` is the Obsidian composition and persistence layer. It owns plugin
  lifecycle, settings loading, and application-level storage.
- `features/` owns user-visible use cases and UI state: chat, inline edit, and
  settings. Features may use Qoder-specific tool and MCP concepts directly;
  hiding them behind a fake provider-neutral interface would add indirection
  without adding a supported product boundary.
- `core/` owns stable product data and narrow host/runtime contracts. It is not
  a bridge and not a miscellaneous utilities folder. It must not import the
  Qoder SDK or contain Qoder CLI tool-name parsing, SDK message transforms, or
  process lifecycle code.
- `qoder/` owns every SDK and CLI concern: authentication, process spawning,
  Query lifecycle, session resume/fork/rewind, model discovery, permissions,
  hooks, tools, MCP option construction, transcript parsing, and SDK adapters.
- `shared/` contains reusable Obsidian UI and DOM helpers with no chat use-case
  ownership.

`QoderServices` is the integration composition root. `QoderHostContext` is the
narrow host contract supplied by `main.ts`, so SDK adapters never import the
concrete plugin class. Services are constructed directly; there is no registry
and no runtime selection by provider ID. ESLint enforces that `qoder/` cannot
import `main.ts`, `app/`, `features/`, or `shared/`.

`QoderChatRuntime` is the long-lived Query lifecycle coordinator. Turn metadata
and usage belong to `QoderTurnTracker`, SDK event routing belongs to
`QoderResponseRouter`, persisted/forked conversation projection belongs to
`QoderConversationSession`, and callback-to-async-iterator bridging belongs to
`PersistentTurnStream`. The feature layer follows the same rule: `Tab` composes
tab lifecycle helpers, while input approval, queueing, local commands, and
subagent streaming are separate controllers.

The model selector has one catalog source: SDK initialization and
`getAvailableModels()`. Account and CLI-configured custom models are ordinary
entries in that catalog. The plugin stores the discovered snapshot for UI
rendering but does not append a built-in fallback list or maintain a separate
custom-model registry.

## SDK lifecycle rules

The implementation follows the official
[Qoder Agent SDK TypeScript samples](https://github.com/QoderAI/qoder-agent-sdk-samples/tree/main/typescript):

1. Every created `Query` has one owner and is closed in `finally` or an awaited
   teardown path.
2. `interrupt()` cancels only the active turn. `close()` ends the Query while
   leaving a persisted session resumable.
3. Initialization-only operations use `initializationResult()` and control
   methods such as `getAvailableModels()`; they do not send a fake user prompt.
4. A `result` message is successful only when `subtype === "success"`. Cold
   queries also fail if iteration ends without a success result.
5. `tools` controls tool visibility. `allowedTools` means pre-approved tools;
   it is not a deny list. Runtime permission decisions remain in `canUseTool`.
6. Ephemeral queries use `persistSession: false` rather than manually adding a
   CLI flag.

Standalone official samples authenticate with a personal access token.
Qoderian deliberately uses `qodercliAuth()` so the Obsidian host reuses the
user's existing local CLI sign-in; the Query lifecycle remains the same.

The SDK is pinned because the Obsidian CommonJS build contains a guarded source
rewrite for the SDK's ESM `import.meta` lookup. An SDK upgrade must be reviewed
against the official samples and pass the full build and test gate.

## Session state

`Conversation.sessionId` is the sole current-session identifier. `QoderState`
stores only previous session IDs, fork origin, and cached subagent metadata.
Keeping a second current-session field would create conflicting sources of
truth during resume and fork flows.

## Where new code belongs

- A new button, modal, or chat workflow goes in its `features/` slice.
- SDK options, qodercli commands, tool payloads, hooks, or transcript behavior
  go in `qoder/`.
- A durable conversation value object or a narrow runtime contract shared by
  app and features may go in `core/`.
- A reusable DOM/Obsidian component with no product use-case ownership goes in
  `shared/`.

Tests mirror source ownership under `tests/unit` and `tests/integration`.
