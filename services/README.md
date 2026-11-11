# Specialist Services

Specialist services are isolated only where correctness, runtime behavior, scaling, or security boundaries justify separation. The existing `server/` remains the core API during incremental development.

- `matcher/` — deterministic CLOB and recovery log.
- `relayer/` — transaction simulation, submission, and finality tracking.
- `indexer/` — Base event ingestion, reorg handling, and projections.
- `realtime/` — public/private WebSocket delivery.
- `reconciliation/` — ABA, ledger, chain, and treasury reconciliation jobs.

No service is implemented by these placeholders.

