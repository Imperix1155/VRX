# VRX internal API catalog

Look here before you build. This catalog lists every IPC channel, bridge
method, live event, hook, store, parser, service, and shared constant that
already exists. If what you need is here, use it instead of building another.
If you add or change a surface, update its row in the same PR.

The code is the source of truth. Every row names its defining file; read that
file before relying on a row. Rules that apply to a whole directory live in
the `AGENTS.md` files; this catalog is the index card, not the essay.

The catalog is split into one file per area so you can read only the part you
need. Search all of it at once with
`rg -n 'useFriends' docs/internal-api` (or `grep -rn`), then open the file
the match is in.

| Section                                                                     | Covers                                                     |
| --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [1. Renderer bridge: `window.vrx`](internal-api/1-renderer-bridge.md)       | The `window.vrx` methods the renderer can call             |
| [2. IPC channels](internal-api/2-ipc-channels.md)                           | Every invoke and push channel, its handler and budget      |
| [3. Live adapter events (`AdapterEvent`)](internal-api/3-adapter-events.md) | The `AdapterEvent` dictionary and who consumes each event  |
| [4. Platform adapter contract](internal-api/4-adapter-contract.md)          | `IPlatformAdapter`, Explore, and request admission         |
| [5. Renderer](internal-api/5-renderer.md)                                   | Queries, hooks, stores, utilities, and reusable components |
| [6. Main process](internal-api/6-main-process.md)                           | Services, adapter internals, and security helpers          |
| [7. Shared (`src/shared`)](internal-api/7-shared.md)                        | Constants, every settings field, and the core model types  |
| [8. Design guide fixtures (`docs/guide`)](internal-api/8-design-guide.md)   | The guide's sample bridge, scenarios, and isolation rules  |
