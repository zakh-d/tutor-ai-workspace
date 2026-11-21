# Materials and durable jobs

## Upload and conversion

Tutor originals: PDF, PPTX, DOCX, Markdown (`.md`) and UTF-8 text (`.txt`), maximum 25 MiB each. Student files: PDF, DOCX, TXT, PNG and JPEG, maximum 10 MiB each, 5 files/question and 50 MiB/attempt. Default workspace quota is 2 GiB counting retained versions and student uploads; all limits are configurable server-side and advertised to clients. Enforce quotas transactionally with reservations so concurrent uploads cannot bypass them.

Flow: authorize and reserve capacity → stream to private staged object while hashing and limiting bytes → verify type → commit version metadata and conversion job together → worker validates/reads original → write immutable Markdown artifact → commit artifact/chunks and status. Interrupted uploads expire after 24 hours. Reconcile unreferenced staged objects older than 24 hours; never delete a referenced original or historical artifact. An S3 failure leaves an explicit retryable upload/job failure, not a ready record.

Use MarkItDown's local PDF/DOCX/PPTX converters, without LLM clients, remote plugins or image-description services. Markdown/text are normalized as UTF-8 and retained as artifacts. Preserve original bytes. Reject malformed, encrypted/password-protected or unsupported input with actionable errors. Restrict expanded Office archive size to 100 MiB, output to 5 MiB, processing to 120 seconds and converter memory to 512 MiB. Run extraction in a killable isolated subprocess/container context without network access.

Chunk normalized Markdown by headings/paragraph boundaries into at most 2,000 characters, splitting oversized paragraphs deterministically. Retain chunk ordinal and heading; do not invent page/slide numbers the converter did not provide. Store converter version, artifact checksum and warning list. Empty extraction fails with `no_extractable_text`; unusually sparse extraction and omitted image content produce warnings, not claims of full fidelity. Text-bearing scans may need manual correction. Tutor correction creates a new artifact and chunk set without overwriting prior artifacts or originals. Published citations remain pinned to their original artifact.

No quality guarantee for equations, diagrams or layout. Website preview presents original download, extracted text and warnings together. A re-upload is a new material version. Retrying conversion of the same version creates a new derived artifact only after successful extraction; keep any previous successful artifact accessible.

Student PDF/DOCX/TXT extraction uses the same sandbox/limits and is queued transactionally on submission. Reading text never enqueues processing; a failed extraction can be retried by the tutor through the job retry endpoint. Student uploads are never searchable across unrelated assignments; their text is accessible only to the owning tutor/agent and scoped to the submission. Image interpretation is deferred.

## Queue contract

Use a PostgreSQL job table and `FOR UPDATE SKIP LOCKED` claims in short transactions. Types: convert_material, extract_submission_file, sync_calendar, mutate_calendar, reconcile_objects. Jobs carry workspace/operation IDs and resource references, not raw tokens or document bodies. Transactions that require work insert the job atomically with domain changes.

Worker default concurrency 2; one calendar sync per connection at a time. Lease for 180 seconds, heartbeat every 30 seconds. Expired leases are reclaimable. Each claim receives a fencing generation; stale workers may not commit results after lease replacement. Handlers are idempotent, using unique logical operation IDs and deterministic object keys or checksum deduplication within a workspace.

Maximum 5 attempts, exponential backoff starting at 5 seconds with jitter and cap 15 minutes; honor provider Retry-After. Validation/unsupported-format errors are permanent. Credential failures pause calendar work as reauth_required. Failures expose sanitized codes and retry availability in the UI/MCP. Manual retry creates a new audited retry operation, not new teaching content.

Long-running work never blocks the request loop. Poll job state with increasing intervals (start 2 seconds, cap 15 seconds); polling does not create new jobs. Keep failed job records for 30 days, compact successful technical job detail after 7 days, and retain domain revision/operation history independently. Operations with unresolved provider outcomes must not be compacted.

[MarkItDown's official repository](https://github.com/microsoft/markitdown) documents format support and optional dependencies. Conversion bounds and quality checks above are project decisions, to be validated against representative fixtures in P2.

## Implementation hardening (2026-11-21)

The Linux conversion subprocess loads a fail-closed libseccomp filter before parsing documents. It denies socket creation/network entry points and process creation/exec; explicit PDF/DOCX/PPTX local converters avoid detector initialization that requires native threads. stdout and stderr go to bounded regular files rather than unbounded capture pipes. Docker includes libseccomp2. Unsupported hosts must report conversion failure rather than run without the filter.

Hourly per-workspace reconciliation holds the same workspace lock as uploads and deletes only generated-key objects older than 24 hours without Blob metadata. Referenced originals and historical versions are retained. Technical job retention never compacts calendar compensation payloads or operation/revision history. See backend regression tests for native syscall denial and object-reference preservation.
