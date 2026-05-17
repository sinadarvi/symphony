# Symphony TypeScript Implementation

This document describes a recommended TypeScript implementation shape for Symphony.
It is not a normative protocol specification. The language-agnostic contract remains
[`SPEC.md`](SPEC.md).

The goal of this document is to make implementation choices explicit without baking
Node.js or TypeScript assumptions into the core spec.

## Runtime Target

- Runtime: Node.js LTS
- Language: TypeScript with `strict` mode enabled
- Package format: implementation-defined, but ESM is recommended for new code
- CLI entrypoint: `symphony [path-to-WORKFLOW.md]`
- Default workflow path: `./WORKFLOW.md`
- Primary external services: Linear GraphQL API and Codex app-server

Implementation choices such as package manager, logger, test runner, HTTP framework,
and process supervisor are intentionally implementation-defined.

## Recommended Project Layout

```text
typescript/
  package.json
  tsconfig.json
  src/
    cli.ts
    main.ts
    workflow/
      loader.ts
      template.ts
      watcher.ts
    config/
      defaults.ts
      schema.ts
      resolve.ts
      validate.ts
    tracker/
      types.ts
      linear/
        client.ts
        queries.ts
        normalize.ts
    planning/
      gate.ts
      authorization.ts
      records.ts
    orchestrator/
      state.ts
      scheduler.ts
      dispatch.ts
      retry.ts
      reconcile.ts
      snapshot.ts
    workspace/
      manager.ts
      hooks.ts
      paths.ts
    codex/
      app-server-client.ts
      protocol.ts
      events.ts
      tools/
        linear-graphql.ts
    observability/
      logger.ts
      status.ts
      http-server.ts
    shared/
      errors.ts
      time.ts
      result.ts
  test/
```

The root repository may continue to host other implementations, such as the current
Elixir implementation. A `typescript/` subdirectory keeps implementation dependencies
and generated artifacts separate from the language-neutral spec.

## Module Responsibilities

### CLI And Host Lifecycle

`src/cli.ts` should parse the optional workflow path and optional implementation
flags, then start the service. It should fail fast on invalid startup config and
exit nonzero when startup fails.

`src/main.ts` should wire the long-lived components together:

- workflow loader and watcher
- effective config store
- tracker client
- planning gate
- workspace manager
- Codex app-server client factory
- orchestrator
- optional HTTP/status surface

### Workflow

The workflow layer should:

- find the workflow file from explicit path or `./WORKFLOW.md`
- parse optional YAML front matter
- expose the Markdown body as a strict prompt template
- watch for workflow changes
- keep the last known good workflow on invalid reload

Recommended libraries:

- YAML parser: `yaml`
- file watching: `chokidar` or Node's built-in watcher with defensive reload checks
- template rendering: a Liquid-compatible renderer configured in strict mode

Unknown template variables and filters must fail rendering, matching `SPEC.md`.

### Config

The config layer should convert raw front matter into a typed effective config.
It should be the only place that applies defaults, expands `$VAR` values, expands
`~`, resolves relative workspace paths, and validates dispatch preconditions.

Recommended approach:

- define explicit TypeScript interfaces for raw config and effective config
- use a runtime validator such as `zod` or equivalent
- keep Codex policy fields as pass-through values unless the implementation
  intentionally validates against a generated Codex schema

Environment variables should not globally override YAML values. They should only
be read when a supported config field explicitly references `$VAR_NAME`.

### Tracker

The tracker interface should be small and match the spec operations:

```ts
interface IssueTrackerClient {
  fetchCandidateIssues(): Promise<Issue[]>;
  fetchIssuesByStates(states: string[]): Promise<Issue[]>;
  fetchIssueStatesByIds(ids: string[]): Promise<Issue[]>;
}
```

The Linear implementation should isolate GraphQL query construction from response
normalization. Pagination, project `slugId` filtering, label lowercase conversion,
blocker extraction, and error mapping should be covered by tests.

The tracker client should also expose the planning-gate operations required by
`SPEC.md`: fetch issue discussion, write the canonical planning record to the
configured issue surface, and append planning comments.

### Planning Gate

The planning gate should decide whether a worker attempt runs in `planning` or
`implementation` mode.

Before implementation authorization:

- planning output is written to the Linear issue description by default
- comments may be used for discussion and questions
- planning docs are not written into the repo
- implementation changes, PR creation, final handoff, and done transitions are blocked

Authorization should require an explicit issue-discussion signal such as
`@symphony implement`, normalized according to Linear mention syntax. If
`planning.authorized_requesters` is configured, the author must match that allowlist.

### Orchestrator

The orchestrator should own all mutable scheduling state:

- `running`
- `claimed`
- `retryAttempts`
- `completed`
- Codex token/runtime totals
- latest rate-limit snapshot

State mutation should happen through one serialized control path. In Node.js this
can be a single event-loop owner object with carefully sequenced async methods.
Avoid letting worker promises mutate shared maps directly; workers should report
events and terminal outcomes back to the orchestrator.

The scheduler should perform each tick in this order:

1. Reconcile running issues.
2. Validate dispatch config.
3. Fetch candidate issues.
4. Sort by priority, creation time, and identifier.
5. Dispatch eligible issues while slots remain.
6. Notify observability consumers.

Retry timers should be cancelable and should re-fetch active candidates before
redispatching a claimed issue.

### Workspace

The workspace manager should enforce the filesystem invariants from `SPEC.md`:

- sanitize issue identifiers with `[^A-Za-z0-9._-] -> _`
- normalize workspace root and workspace path to absolute paths
- verify each workspace path remains under the workspace root
- verify Codex launches with `cwd` equal to the per-issue workspace path

Hooks should run with an abortable timeout. `after_create` and `before_run` failures
are fatal to the current attempt; `after_run` and `before_remove` failures should be
logged and ignored.

Use Node's `child_process.spawn` with explicit `cwd`, timeout/cancellation handling,
and bounded log capture for hook output.

### Codex App-Server Client

The Codex client should wrap the app-server subprocess and expose a narrow runner
API to the worker:

```ts
interface CodexSession {
  threadId: string;
  runTurn(input: RunTurnInput): AsyncIterable<CodexRuntimeEvent>;
  stop(): Promise<void>;
}
```

The client should:

- launch `bash -lc <codex.command>` in the issue workspace
- keep protocol stdout and diagnostic stderr separate
- enforce startup/read timeouts
- enforce per-turn timeout
- convert app-server updates into normalized runtime events
- extract thread and turn IDs
- extract token totals and rate-limit payloads
- handle unsupported tool calls without stalling the turn
- handle user-input-required events according to the documented implementation policy

The targeted Codex app-server protocol is the source of truth for message schemas.
Do not hard-code speculative protocol shapes when generated schemas or official
documentation are available.

### Agent Worker

A worker attempt should be a thin composition of:

1. create or reuse workspace
2. run `before_run`
3. fetch issue discussion and determine planning versus implementation mode
4. render the first prompt
5. start Codex session
6. in planning mode, capture and write the planning record to the tracker issue
7. in implementation mode, run one or more turns up to `agent.max_turns`
8. refresh issue state between successful implementation turns
9. run `after_run`
10. report normal or abnormal exit to the orchestrator

Continuation turns in the same live session should send concise continuation
guidance rather than resending the full issue prompt.

### Observability

Structured logs are required. The logger should support stable fields such as:

- `issue_id`
- `issue_identifier`
- `session_id`
- `event`
- `attempt`
- `error`

The optional HTTP server should be treated as an extension. If implemented, it
should read from orchestrator snapshots rather than maintaining a second source of
truth.

Recommended HTTP endpoints are the ones defined in `SPEC.md`:

- `GET /`
- `GET /api/v1/state`
- `GET /api/v1/:issue_identifier`
- `POST /api/v1/refresh`

## Error Model

Use typed error codes at module boundaries. Avoid relying on raw exception strings
for orchestration decisions.

Recommended shape:

```ts
type SymphonyError = {
  code: string;
  message: string;
  cause?: unknown;
  context?: Record<string, unknown>;
};
```

Errors that affect scheduling should be mapped into stable categories before they
reach retry and observability code.

## Testing Strategy

Use deterministic unit tests for core conformance:

- workflow parsing and strict template rendering
- config defaults, env indirection, path resolution, validation
- workspace sanitization, containment, hook behavior
- Linear query pagination and normalization
- planning authorization matching and planning record writes
- dispatch eligibility, sorting, concurrency, blocker handling
- retry backoff and slot exhaustion
- reconciliation for active, non-active, terminal, and missing issues
- Codex client timeout and event normalization using a fake app-server process
- token accounting and snapshot generation

Use integration tests separately for real Linear and real Codex app-server runs.
Those tests should be opt-in and skipped explicitly when credentials or network
access are unavailable.

## Implementation Order

A practical build order:

1. Create TypeScript project skeleton and test harness.
2. Implement workflow loader, config resolution, and validation.
3. Implement workspace manager and hook runner.
4. Implement Linear client with mocked GraphQL tests.
5. Implement planning authorization and tracker-surface planning record writes.
6. Implement orchestrator state, dispatch eligibility, retry, and reconciliation
   with fake tracker/workers.
7. Implement Codex app-server client against a fake protocol process.
8. Wire the real worker attempt flow.
9. Add structured logging.
10. Add optional HTTP snapshot API.
11. Add real integration smoke tests.

This order keeps the scheduler testable before the real Codex protocol is fully
wired in.

## Security Posture

The TypeScript implementation must document its selected Codex approval policy,
sandbox policy, user-input-required behavior, and tool-call behavior.

At minimum:

- do not log tracker tokens or resolved secret values
- run Codex only inside the validated issue workspace
- bound hook output in logs
- enforce hook and turn timeouts
- treat workflow hooks as trusted code
- make any high-trust defaults explicit in user-facing documentation

Workspace isolation is a baseline control, not a full sandbox.
