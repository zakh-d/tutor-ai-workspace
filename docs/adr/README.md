# Architecture decision records

All records below are accepted for the documentation baseline dated 2026-11-14. Implementation is pending. Supersede a decision with a new numbered record rather than silently changing its meaning.

- [ADR-001 — Modular monolith and shared interfaces](001-monolith.md)
- [ADR-002 — One PostgreSQL database and private object storage](002-storage.md)
- [ADR-003 — Keycloak identity and private tutor workspaces](003-identity.md)
- [ADR-004 — Local text conversion and PostgreSQL jobs](004-processing.md)
- [ADR-005 — Optimistic concurrency, revisions and compensating undo](005-history.md)
- [ADR-006 — Immutable assignments and secret-link student access](006-assignments.md)
- [ADR-007 — Google-authoritative timetable with guarded writes](007-calendar.md)
- [ADR-008 — External generation and autonomous scoped agents](008-agent-boundary.md)
- [ADR-009 — Typed aggregates in PostgreSQL JSONB](009-aggregate-persistence.md)
