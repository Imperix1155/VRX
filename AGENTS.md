# DOX framework

- DOX is highly performant AGENTS.md hierarchy installed here
- Agent must follow DOX instructions across any edits

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md found along each route
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences, durable workflow rules, and the top-level Child DOX Index
- Child AGENTS.md files own domain-specific instructions and their own Child DOX Index
- Each parent explains what its direct children cover and what stays owned by the parent
- The closer a doc is to the work, the more specific and practical it must be

## Child Doc Shape

- Create a child AGENTS.md when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards
- Work Guidance must reflect the current standards of the project or user instructions; if there are no specific standards or instructions yet, leave it empty
- Verification must reflect an existing check; if no verification framework exists yet, leave it empty and update it when one exists

Default section order:
- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

## Style

- Keep docs concise, current, and operational
- Document stable contracts, not diary entries
- Put broad rules in parent docs and concrete details in child docs
- Prefer direct bullets with explicit names
- Do not duplicate rules across many files unless each scope needs a local version
- Delete stale notes instead of explaining history
- Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist

## Closeout

1. Re-check changed paths against the DOX chain
2. Update nearest owning docs and any affected parents or children
3. Walk the Doc-Sync Matrix below and update every doc a changed surface maps to
4. Refresh every affected Child DOX Index
5. Remove stale or contradictory text
6. Run existing verification when relevant
7. Report any docs intentionally left unchanged and why

## Doc-Sync Matrix

Each kind of change owns a doc that must be updated **in the same PR** — doc drift is a defect, not a chore for later.

| If the change touches… | Update |
| --- | --- |
| The callable surface — any IPC channel, `window.vrx` method, `AdapterEvent`, hook, store, parser, service, or shared constant (added, renamed, resignatured, or removed) | its row in `docs/INTERNAL-API.md` |
| Visual or interaction design — tokens, component looks/behavior, design rules | `docs/DESIGN.md` (exact values, rule text) AND the reference renderings `docs/glass.html` / `docs/design.html` — they are design docs too and drift silently |
| Assumptions about the external VRChat/CVR APIs — wire shapes, endpoints, enum values, 🟡 unverified markers | `docs/api-volatility.md` (and `docs/api-policy.md` if etiquette/policy changed) |
| User-visible behavior | `CHANGELOG.md` |
| Purpose, structure, contracts, or workflows of a directory | the nearest owning `AGENTS.md` (Update After Editing rules) |
| Project-level facts — stack versions, feature status, doc links | `README.md` |

## User Preferences

When the user requests a durable behavior change, record it here or in the relevant child AGENTS.md

- Measure twice, cut once: establish a verified baseline, confirm constraints and compatibility, then make incremental changes with verification between steps.

## Child DOX Index

VRX project-wide rules — architecture, security non-negotiables, API etiquette, Git/PR workflow, Linear board hygiene, and behavioral guidelines — live in **[`CLAUDE.md`](./CLAUDE.md)**; read it alongside this contract. The design system spec is **[`docs/DESIGN.md`](./docs/DESIGN.md)** (rendered guide: `docs/design.html`; visual reference: `docs/glass.html`). The internal callable surface — every IPC channel, `AdapterEvent`, hook, store, parser, and constant — is catalogued in **[`docs/INTERNAL-API.md`](./docs/INTERNAL-API.md)**: consult it BEFORE building new surfaces (reuse beats rebuild), and update its rows in the same PR whenever a surface is added or changed (part of the DOX pass).

Children own their local technical contracts:
- **[`src/shared`](./src/shared/AGENTS.md)** — pure cross-process types + constants (no electron/node imports).
- **[`src/main`](./src/main/AGENTS.md)** — Electron main process: security trinity, electron-log + credential redaction.
- **[`src/renderer`](./src/renderer/AGENTS.md)** — React UI: Tailwind v4, design-token-only styling.

Not yet durable boundaries (no child doc until they gain real content): `src/preload` (owns `index.ts` + `index.d.ts` — the `window.vrx` bridge — durable but small; contracts documented in `src/main/AGENTS.md`), and the `.gitkeep`-only placeholder dirs `src/main/platform/` and `src/renderer/src/routes/`. The populated `src/renderer/src/{hooks,queries,utils}` subtrees are owned by `src/renderer/AGENTS.md` (see its per-file entries).
