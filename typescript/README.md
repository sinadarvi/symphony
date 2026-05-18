# Symphony TypeScript

Experimental TypeScript implementation of Symphony based on the repository root
[`SPEC.md`](../SPEC.md) and [`IMPLEMENTATION.md`](../IMPLEMENTATION.md).

## Run

```bash
npm install
npm run build
npm test
npm exec symphony ./WORKFLOW.md
```

The CLI accepts an optional workflow path and defaults to `./WORKFLOW.md`.

Create `typescript/.env` for local secrets that should be loaded automatically:

```dotenv
LINEAR_API_KEY=your-linear-api-key
```

Keep workflow config as an environment reference:

```yaml
tracker:
  api_key: $LINEAR_API_KEY
```

To avoid re-running planning on the same ticket after Symphony has already posted the latest
comment, configure the Linear author identity used by the Symphony token:

```yaml
planning:
  assistant_authors:
    - symphony@example.com
    - symphony
  planning_record_location: comment
```

## Security Posture

- Workflow hooks are trusted code and run with `bash -lc` in the issue workspace.
- Hook output is bounded before logging.
- Codex launches only after the workspace path has been validated to sit under the configured
  workspace root.
- Codex defaults are high trust but explicit:
  - `codex.command`: `codex app-server`
  - `codex.approval_policy`: `never`
  - `codex.thread_sandbox`: `workspace-write`
  - `codex.turn_sandbox_policy`: generated per issue workspace as a workspace-write policy.
- User-input-required events are treated as run failures by the Codex client abstraction.
- Tracker tokens and resolved secrets are not included in structured logs by this implementation.

Workspace isolation is a baseline control, not a full sandbox.
