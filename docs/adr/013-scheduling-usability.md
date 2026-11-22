# ADR-013 — Teacher timezone preference and scheduling usability

Status: Accepted; refines [ADR-010](010-student-timezones-and-schedules.md).

Date: 2026-11-22

## Context

A UTC bootstrap setting is indistinguishable from an intentional teacher choice. The overview's creation-order preview groups generated lessons by student. Native datalist suggestions are unreliable on mobile, and verbose twelve-hour dates obscure the daily plan.

## Decision

Persist a `timezone_configured` workspace flag. New workspaces retain the server UTC fallback until the authenticated browser saves its detected IANA timezone through the ordinary revision-checked, idempotent workspace update. Explicit timezone updates mark the preference configured, including UTC. Preserve legacy non-UTC settings and legacy workspaces with revisions greater than one as configured; treat untouched revision-one UTC records as unset. This conservative inference cannot identify every historical intention, so teachers can explicitly select UTC in Settings.

The teacher can edit the saved timezone in a dedicated Settings surface. Browser changes never override a configured preference. Public deadlines and student fallback continue to use persisted workspace settings. No host timezone inference or unauthenticated settings mutation is introduced.

The overview loads all pages of planned lessons before filtering and chronological sorting. Today and Tomorrow use teacher-local calendar dates, including earlier lessons on the selected day; All includes unscheduled plans, after timed lessons. Calendar-linked start times take precedence over local lesson timing. Student/title grouping does not affect order.

Use explicit 24-hour display and concise labelled teacher/student times with timezone details available. Retain distinct dates across midnight and explicit offsets where necessary to choose an ambiguous DST instant. Replace datalist-only timezone input with a mobile-operable searchable selector. Required fields show a red asterisk, and failed validation shows red outlines plus textual feedback without discarding entered values.

## Alternatives

Always using browser time would silently override teachers working while travelling and disagree with public deadlines. Automatically replacing every UTC setting would erase intentional choices. Leaving every old UTC value configured would preserve the reported bootstrap bug. A custom ARIA combobox offers control but carries more keyboard and focus complexity than native selection controls.

## Consequences and validation

A schema migration adds preference provenance without changing existing instants or schedule zones. Conservatively preserved legacy settings may require a one-time teacher correction. Initial browser persistence must surface failures and handle revision conflicts rather than pretend a save succeeded.

Existing CI backend tests, PostgreSQL scheduling tests, frontend tests and TypeScript/build checks cover this change. Extend T15/T17 for pagination, date filtering across DST, chronological order, explicit UTC persistence, browser initialization, mobile selection and validation. Real mobile-browser interaction and external Google compatibility remain separate acceptance checks. See [validation](../validation.md).
