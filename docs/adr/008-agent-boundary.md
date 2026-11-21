# ADR-008 — External generation and autonomous scoped agents

Status: Accepted

Date: 2026-11-14

## Context

Tutors want to outsource preparation and organization without operating a server-side LLM, while retaining control over final assessment.

## Decision

Expose typed, bounded, paginated MCP tools over shared application services. External agents generate structured homework, flashcards and grading proposals. Permit autonomous record changes, assignment publication and calendar actions within granted scopes. Grade release and reopening remain tutor-only. Export flashcards as TSV for manual Quizlet import.

## Consequences

The platform validates structure, references and permissions, not pedagogical correctness. Retrieved documents are untrusted data. Client compatibility, data disclosure and missing image extraction must be clear. Website workflows remain usable without an agent.

## Alternatives and deferred work

Embedded chat, model routing/billing, server-side inference, unrestricted execution tools, automatic grading publication and direct Quizlet API integration are excluded. Binary MCP upload is deferred in favor of website/REST uploads.

## Specifications and verification

[MCP](../mcp.md), [REST](../rest-api.md), [product](../product.md), [assignments](../assignments.md). Validation: T02, T12, T13, T16.
