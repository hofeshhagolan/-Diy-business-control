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
   - Status: Done
   - Result: Added bottom navigation to the single-invoice review screen using the already loaded ordered review rows as the single in-memory source for current position and adjacent-item navigation; previous/next open only the adjacent review-row item with first/last boundary disabling, back-to-list returns to the existing Task 9 review list without refetch, and the position indicator displays `חשבונית X מתוך Y`.
   - Verification: Static checks passed; runtime end-to-end UI verification deferred to the next appropriate deployed/integration test point.

13. [User-visible] Implement save-current-invoice action that creates exactly one expense and marks the current item as saved.
   - Status: Done
   - Result: Added an atomic current-invoice save flow that creates exactly one expense for the active review item, links that exact scan item to the saved expense, blocks duplicate saves, and preserves the existing non-review single-invoice save path unchanged.
   - Verification: Migration applied successfully in Supabase; static checks passed; runtime end-to-end save verification deferred to the next real multi-invoice workflow test because it requires creating a real expense.

14. [User-visible] Implement remove-from-pending and immediate open-next behavior after successful save, with proper end-of-queue handling.
   - Status: Done
   - Result: Added local post-save removal of the saved review item, immediate open-next-by-former-index behavior when a row exists at that position, fallback to the existing pending review list when no next row exists, and clean empty-queue handling when no pending rows remain.
   - Verification: Static checks passed; runtime end-to-end verification deferred to the next real multi-invoice workflow test.

15. [User-visible] Review state synchronization after each successful save:
- refresh pending review queue
- update counters immediately
- keep navigation indices consistent
- block reopening already-saved invoices
   - Status: Done
   - Result: Added persisted pending-queue reconciliation after every successful review-item save while keeping Task 14 responsible for the immediate local remove/open-next transition. The existing ordered `expenseReviewRows` remains the single in-memory source; reconciliation refreshes it from persisted unsaved items, keeps the active context and `חשבונית X מתוך Y` navigation position synchronized, and prevents already-saved invoices from being reopened.
   - Verification: Static checks passed; runtime end-to-end multi-invoice workflow verification deferred to the next appropriate real workflow test.

16. [User-visible] Add fullscreen viewer entry from the large review image/document.
   - Status: Done
   - Result: Added a fullscreen entry from the current large review document panel that is shown only when a valid document is displayed; fullscreen reuses the same current signed URL for both image (`img`) and PDF/document (`iframe`) rendering, includes an explicit close control, supports Escape-to-close, and manages focus by moving focus into the fullscreen viewer on open and returning it to the fullscreen-entry control on close.
   - Verification: Static checks passed; runtime fullscreen behavior and Escape/focus behavior deferred to the next appropriate deployed/integration test point.

17. [User-visible] Implement fullscreen zoom/pan interactions.
   - Status: Done
   - Result: Added image-only fullscreen zoom/pan interactions with wheel zoom, mouse and touch drag pan, pinch zoom, 1x–4x clamped zoom bounds, overflow-clamped pan so the image cannot be lost off-screen, and Reset back to 1x and centered while leaving PDF/document iframe behavior unchanged.
   - Verification: Static checks passed; browser-level runtime verification for wheel, drag, pinch, pan clamping, and reset behavior deferred to the next appropriate deployed/integration test point.

18. [User-visible] Implement fullscreen page navigation constrained to pages of the current invoice item only.
   - Status: Done
   - Result: Added fullscreen page navigation constrained to the current active invoice item, using the deterministically ordered `global_page_index` page list already loaded for that item, with an `עמוד X מתוך Y` indicator, boundary disabling at first/last/single-page states, zoom/pan reset on every page change, and correct image/PDF switching behavior.
   - Verification: Static checks passed; browser-level runtime verification for fullscreen page navigation, boundary states, zoom reset, and image/PDF switching deferred to the next appropriate deployed/integration test point.

19. [Exception flow] Add low-confidence grouping gate so auto-grouping is blocked below threshold and no invoice items are auto-created.
   - Status: Done
   - Result: Added a normalized numeric `grouping_confidence` contract with valid range `0.0..1.0`, a single frontend threshold of `0.8`, unchanged high-confidence multi-invoice auto-persistence into the existing review-list flow, and a low-confidence blocking gate that prevents persistence and review-list entry while retaining one raw in-memory analysis result for Task 20.
   - Verification: Static checks passed; runtime browser verification for the high-confidence direct flow and low-confidence blocking behavior deferred to the next appropriate deployed/integration test point.

20. [Exception flow] Implement manual grouping UI and confirmation flow, then persist confirmed grouping and continue into the normal review list flow.
   - Status: Done
   - Result: Added a low-confidence exception flow for manual page grouping without drag-and-drop, allowing pages to be assigned to existing or new invoice groups while removing empty groups automatically, validating the final grouping, reusing extracted data only for exact unchanged groups, re-extracting every changed/split/merged/new group before persistence, preserving the full draft on extraction failure, and then reusing the existing persistence and Task 9 review-list flow after successful confirmation. Manual PDF preview now renders the exact selected page through a backend-generated single-page PDF subset.
   - Verification: Static checks passed; runtime end-to-end verification of manual grouping, changed-group re-extraction, retry behavior, exact PDF-page preview, persistence, and transition into the review list is deferred to the next appropriate deployed/integration test point.

21. [User-visible, final] Implement deferred review at end: שמרי חשבוניות לבדיקה מאוחר יותר plus resume later from persisted queue.
   - Status: Done
   - Result: Implemented deferred review only for already-persisted pending invoices by reusing the existing scan batch/item/page model and `saved_expense_id` pending/saved state, without introducing a parallel system. Pending invoices now resume across all persisted batches and are ordered oldest-first by the existing persisted queue-entry timestamp (`invoice_scan_batches.completed_at`). When pending invoices exist at expense entry, the user is presented with an explicit choice between continuing pending review (`המשיכי חשבוניות ממתינות`) and scanning/adding new invoices. The action `אמשיך לבדוק מאוחר יותר` now exits an already-persisted review flow without any additional persistence. A lightweight pending-invoice count indicator is shown at expense entry points. Unfinished low-confidence/manual-grouping work remains non-persistent and now requires explicit discard confirmation before it can be lost. No persistent manual drafts, backend changes, or database/schema changes were added.
   - Verification: Static checks passed; browser-level runtime verification for cross-batch oldest-first resume ordering, entry choice behavior, continue-later exit behavior, pending-count indicator updates, and manual-grouping discard confirmation is deferred to the next appropriate deployed/integration test point.

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
