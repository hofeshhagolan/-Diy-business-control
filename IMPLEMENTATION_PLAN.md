# Implementation Plan

- This file is the project implementation source of truth.
- Update the relevant task immediately after each task is accepted.
- Never change original task scope silently.
- Any scope change must be recorded explicitly.
- Continue from the first incomplete task unless explicitly instructed otherwise.

1. [Infra] Add single-invoice compatibility guardrails and acceptance checks so each step preserves current one-invoice analyze-and-save behavior.
   - Status: Done
   - Completed: 2026-07-14
   - Result: Single-invoice compatibility guardrails were implemented and recorded in task-tagged commit history.
   - Verification: Confirmed by commit d4d1256 message: "Task 1: Add single-invoice compatibility guardrails".

2. [Infra] Introduce document-oriented request contract (invoice active now, other document types reserved) including operation metadata and versioning.
   - Status: Done
   - Completed: 2026-07-14
   - Result: A document-oriented request contract with metadata/versioning support was added.
   - Verification: Confirmed by commit ae068d6 message: "Task 2: Introduce document-oriented request contract".

3. [Infra] Implement deterministic page manifest generation for mixed uploads (images + multi-page PDFs) with stable per-page identities.
   - Status: Done
   - Completed: 2026-07-14
   - Result: Deterministic page manifest generation for mixed uploads was implemented.
   - Verification: Confirmed by commit 14e45e6 message: "Task 3: Add deterministic page manifest generation".

4. [Infra] Persist source file/page artifacts for processing pipeline use, with metadata linkage required for later review and viewer flows.
   - Status: Done
   - Completed: 2026-07-14
   - Result: Source scan files are persisted before extraction for downstream processing and review linkage.
   - Verification: Confirmed by commit 5a0c0fe message: "Task 4: Persist scan files before extraction".

5. [Infra] Add extraction response normalization to a document-oriented internal model while keeping invoice field compatibility unchanged.
   - Status: Done
   - Completed: 2026-07-14
   - Result: Extraction outputs were normalized into internal metadata while retaining invoice compatibility.
   - Verification: Confirmed by commit 944c412 message: "Task 5: Add normalized extraction result metadata".

6. [Infra] Implement atomic persistence orchestration for batch/item/page writes with explicit failure rollback/cleanup semantics.
   - Status: Done
   - Completed: 2026-07-14
   - Result: Atomic persistence behavior for scan batch writes was implemented.
   - Verification: Confirmed by commit 560827c message: "Task 6: Persist scan batches atomically".

7. [Infra] Add idempotency handling for extraction retries so repeated requests reuse existing processing state and avoid duplicate records.
   - Status: Done
   - Result: Task 7 idempotency migration/review artifacts exist and the task is marked complete per accepted implementation history.
   - Verification: Repository contains task7_forward_migration.sql and task7_idempotency_review.sql; no task-tagged commit/date was found in current git history.

8. [User-visible] Enable multi-invoice happy path extraction output handling and queue creation for automatically grouped results.
   - Status: Done
   - Result: Multi-invoice extraction handling and grouped queue item creation are present, and the accepted Task 8 corrective prerequisite was applied so each grouped invoice item now carries and persists item-level extracted invoice data (including idempotency payload-signature comparison coverage for extracted_data).
   - Verification: Static checks passed. Manual post-migration verification was attempted but could not be completed due to a Supabase infrastructure connection timeout (`upstream connect error or disconnect/reset before headers. reset reason: connection timeout`); no RPC, SQL migration, or application-code changes were made in response to that timeout.

9. [User-visible] Build minimal review list screen (one row per invoice: label, capture date/time, page count only).
   - Status: Done
   - Result: Added a lightweight in-flow review list in the existing expense dialog that renders one non-interactive row per persisted invoice item with deterministic label, capture date/time, and page count after successful grouped multi-invoice persistence.
   - Verification: Static checks passed; runtime UI verification deferred to the next appropriate deployed/integration test point.

10. [User-visible] Implement row-to-item open behavior to enter single-invoice review context from the list.
   - Status: Done
   - Result: Review-list rows are openable and bound to persisted invoice item ids; clicking a row sets active review context (batch id, scan item id, item order, entered-from-review-list) and visibly transitions from the list into a minimal single-invoice review-context state showing the deterministic invoice label only.
   - Verification: Static checks passed; runtime UI verification deferred to the next appropriate deployed/integration test point.

11. [User-visible] Build one-invoice review screen with large document panel plus existing expense form populated for that item only.
   - Status: Done
   - Result: Implemented a single-invoice review screen in the expense dialog review context with a large document panel; clicking a review-list row loads only that persisted scan item, loads only that item’s pages in deterministic `global_page_index` order, displays the first ordered page/document, clears invoice-derived form fields before each load, and populates the existing expense form only from that selected item’s persisted `extracted_data` with stale async-response protection.
   - Verification: Static checks passed; runtime end-to-end UI verification deferred to the next appropriate deployed/integration test point.

12. [User-visible] Add bottom invoice navigation on review screen (previous, back to list text action, next, position indicator).
   - Status: Pending

13. [User-visible] Implement save-current-invoice action that creates exactly one expense and marks the current item as saved.
   - Status: Pending

14. [User-visible] Implement remove-from-pending and immediate open-next behavior after successful save, with proper end-of-queue handling.
   - Status: Pending

15. [User-visible] Review state synchronization after each successful save:
- refresh pending review queue
- update counters immediately
- keep navigation indices consistent
- block reopening already-saved invoices
   - Status: Pending

16. [User-visible] Add fullscreen viewer entry from the large review image/document.
   - Status: Pending

17. [User-visible] Implement fullscreen zoom/pan interactions.
   - Status: Pending

18. [User-visible] Implement fullscreen page navigation constrained to pages of the current invoice item only.
   - Status: Pending

19. [Exception flow] Add low-confidence grouping gate so auto-grouping is blocked below threshold and no invoice items are auto-created.
   - Status: Pending

20. [Exception flow] Implement manual grouping UI and confirmation flow, then persist confirmed grouping and continue into the normal review list flow.
   - Status: Pending

21. [User-visible, final] Implement deferred review at end: שמרי חשבוניות לבדיקה מאוחר יותר plus resume later from persisted queue.
   - Status: Pending

22. [Regression tests] Add end-to-end and targeted regression coverage: single-invoice continuity, multi-invoice happy path, save-current-open-next, viewer constraints, low-confidence manual grouping, deferred/resume, idempotency, and atomic-failure recovery.
   - Status: Pending

23. [Performance validation] Validate and document performance for:
- large batches (50+ invoices)
- multi-page PDFs
- review list loading time
- invoice navigation speed
- fullscreen viewer responsiveness on mobile
- memory usage during long review sessions
   - Status: Pending

24. [Quality & Accessibility] Accessibility Audit (Israel Standard 5568 / WCAG AA)
   - Status: Done
   - Completed: 2026-07-15
   - Result: Accessibility-focused improvements were completed in committed history covering keyboard behavior, semantics, validation/error association, announcements, and focus/touch targets.
   - Verification: Confirmed by accessibility commit series fcecc2d, d31d890, 6bf5a82, 0198221, 164c2fe, 4cd222a; no standalone audit report artifact was found in the repository.
