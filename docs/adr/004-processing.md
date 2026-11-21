# ADR-004 — Local text conversion and PostgreSQL jobs

Status: Accepted

Date: 2026-11-14

## Context

Document conversion is expensive and unreliable enough to require background processing, but the MVP has no hosted LLM or additional queue database.

## Decision

Use local MarkItDown for supported text documents; preserve originals and extracted artifact versions. Use PostgreSQL jobs with leased/fenced claims, bounded retries and idempotent handlers. Search extracted chunks with PostgreSQL full-text indexing. Conversion subprocesses have no network access and bounded resources.

## Consequences

Text-first conversion is feasible without inference costs but will not reliably interpret scans, diagrams or equations. Warnings, preview and manual correction are essential. Worker failure and object reconciliation are explicit states, not request timeouts.

## Alternatives and deferred work

Redis/Celery broker infrastructure, hosted document intelligence and LLM extraction are rejected for MVP. OCR, rich mathematical conversion and semantic retrieval are deferred.

## Specifications and verification

[Materials and jobs](../materials-and-jobs.md). Official reference: [MarkItDown](https://github.com/microsoft/markitdown). Validation: T05, T06, T07.
