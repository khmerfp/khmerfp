# Shared Packages

Shared packages contain stable cross-service contracts and invariants. They must not become a dumping ground for unrelated helpers.

- `domain/` — identifiers, state machines, integer money/order types, and events.
- `db/` — Drizzle schemas, versioned migrations, and repositories.
- `ledger/` — double-entry posting rules, holds, and invariants.
- `authz/` — roles, policy checks, and recent-auth requirements.
- `contracts/` — reviewed ABIs, addresses, and generated bindings.
- `observability/` — structured telemetry conventions and redaction.

These are structural placeholders only; no workspace configuration or dependencies have been added.

