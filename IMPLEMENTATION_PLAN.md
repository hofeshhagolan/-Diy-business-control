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

21A. [Current gate / follow-up] Complete “אבדוק מאוחר יותר” for single-invoice and multi-invoice workflows using the existing persisted pending-review system.
   - Status: Pending
   - Scope:
   - A single scanned invoice can be persisted for later review even when the user does not review/save it immediately.
   - Multi-invoice flows continue using the same persisted pending queue.
   - Do not introduce a parallel deferred-review system.
   - Later resume uses the same cross-batch pending-review flow created in Task 21.
   - The flow remains valid when extracted information is incomplete or unavailable.
   - Acceptance:
   - “אבדוק מאוחר יותר” works from the real single-invoice flow.
   - Existing multi-invoice deferred-review behavior remains intact.
   - No duplicate expense or duplicate pending-queue persistence.
   - Deferred items survive closing/reopening and appear in the existing pending-review flow.
   - Gate:
   - Complete and runtime-verify Task 21A before Task 22 can be signed off.
   - Do not start Tasks 25–33 until Task 21A and the critical Task 22 gate are closed.

21B. [Integration follow-up] Make expense-dialog primary states mutually exclusive and remove overlapping review UI states.
   - Status: Done
   - Result:
   - Upload, pending choice, review list, active review, manual grouping and single-invoice form states do not incorrectly stack.
   - State-aware dialog titles were added.
   - Redundant internal review headings/fullscreen-entry UI were removed while preserving document-tap fullscreen behavior.
   - Verification:
   - Runtime phone testing confirmed the original stacked-window defect was resolved sufficiently to continue the review flow.
   - Remaining small UX refinements are tracked separately in Tasks 25–27.
   - Verification commits: d20841b486ad9f5d060768e2db5a59132243d7c7, 5b2e3bdb58eb8cd6c771106c929baebe2dfa382f.

21C. [Runtime bugfix] Fix grouping-confidence normalization crash in invoice extraction.
   - Status: Done
   - Result:
   - Replaced invalid Python float `.isfinite()` usage with `math.isfinite(...)`.
   - Resolved: `'float' object has no attribute 'isfinite'`.
   - Verification:
   - Deployed runtime retest confirmed single-invoice extraction completes without this error.
   - Verification commit: 6e83442aac89c9c61d71b8fedb425c5862179366.

22. [Regression tests] Add end-to-end and targeted regression coverage: single-invoice continuity, multi-invoice happy path, save-current-open-next, viewer constraints, low-confidence manual grouping, deferred/resume, idempotency, and atomic-failure recovery.
   - Status: Pending
   - Critical runtime verification checklist:
   - Single-invoice analyze → review → save.
   - Single-invoice “אבדוק מאוחר יותר” → close → resume.
   - Multi-invoice high-confidence persistence and review list.
   - Review-row open and item-specific document/form loading.
   - Save current → remove from pending → open next → correct end-of-queue behavior.
   - Fullscreen open/close and focus return.
   - Fullscreen zoom, pan, reset and page boundaries.
   - Low-confidence grouping gate.
   - Manual grouping edits and changed-group re-extraction.
   - Failure/retry behavior and exact selected-page PDF preview.
   - Cross-batch pending resume and oldest-first ordering.
   - Pending-review versus new-scan entry choice.
   - Pending-count updates.
   - Manual-grouping discard confirmation.
   - Idempotency evidence.
   - Atomic-failure recovery evidence.
   - Gate: Complete and pass critical Task 22 runtime verification before Tasks 25–33 begin.

23. [Performance validation] Validate and document performance for:
- large batches (50+ invoices)
- multi-page PDFs
- review list loading time
- invoice navigation speed
- fullscreen viewer responsiveness on mobile
- memory usage during long review sessions
   - Status: Pending
   - Requirement: Task 23 remains required before the current phase is formally complete.
   - Gate clarification: It is not automatically a hard blocker before every individual Tasks 25–33 feature slice unless performance testing reveals a concrete blocker.

24. [Quality & Accessibility] Accessibility Audit (Israel Standard 5568 / WCAG AA)
   - Status: Done
   - Completed: 2026-07-15
   - Result: Accessibility-focused improvements were completed in committed history covering keyboard behavior, semantics, validation/error association, announcements, and focus/touch targets.
   - Verification: Confirmed by accessibility commit series fcecc2d, d31d890, 6bf5a82, 0198221, 164c2fe, 4cd222a; no standalone audit report artifact was found in the repository.
   - Continuity rule: Future UI work must preserve the accessibility improvements completed under Task 24.
   - Reopen rule: Do not reopen or redefine Task 24 unless a new verified accessibility defect is discovered.

25. [User-visible cleanup] Finalize pending-invoice list presentation for mobile.
   - Status: Pending
   - Scope:
   - Keep title: חשבוניות בבדיקה
   - Columns: מס' חשבונית, תאריך, שעה
   - Invoice entries remain clickable with deterministic unique labels such as חשבונית 1, חשבונית 2, etc.
   - Remove wording based on קליטה.
   - Reduce dead horizontal space and unnecessary horizontal scrolling.

26. [User-visible cleanup] Finalize active-invoice review navigation and document-first layout.
   - Status: Pending
   - Scope:
   - Keep document at the top.
   - Keep extracted expense form visible below it.
   - Tapping document opens the existing fullscreen viewer.
   - Always show two compact arrows around חשבונית X מתוך Y.
   - If previous/next is unavailable, keep that arrow visible but light/disabled.
   - Never hide unavailable arrows.
   - Avoid large previous/next button containers and duplicate review headings.

27. [Mobile UX] Refine invoice source-picker behavior.
   - Status: Pending
   - Scope:
   - צילום חשבונית → camera-oriented flow.
   - צילום מס' מסמכים → multi-document capture flow.
   - עיון → file/gallery browsing without an application-created redundant source chooser where the platform permits.
   - Reuse existing inputs and handlers.
   - Do not add another source-selection layer.

28. [Dashboard UX] Make destination-backed dashboard cards clickable as whole cards.
   - Status: Pending
   - Rules:
   - Reuse existing navigation handlers. Do not duplicate routing logic.
   - הוצאות is clickable because a real destination exists.
   - פיננסים is clickable because a real destination exists.
   - תובנות is clickable because a real Insights destination already exists.
   - הכנסות remains non-clickable until Task 29 creates the dedicated Income screen.
   - משימות remains non-clickable until a real Tasks screen exists.
   - לוח שנה / השבוע הקרוב remains non-clickable until a real Calendar screen exists.
   - Other cards without real destinations remain non-clickable and visually neutral.
   - Quick-action cards keep their own internal controls and must not be hijacked by card-level navigation.
   - Verification:
   - Test whole-card tapping on mobile.
   - Test keyboard/focus behavior where relevant.
   - Confirm placeholder cards do not visually imply clickability.

29. [Income architecture] Create a dedicated primary הכנסות screen and keep פיננסים as a higher-level access hub.
   - Status: Pending
   - Scope:
   - Income becomes a primary management screen parallel to Expenses.
   - Add direct navigation access for הכנסות.
   - Finance provides clear access to both Income and Expenses.
   - Do not duplicate full Income and Expense management interfaces inside Finance.
   - Once the dedicated Income screen exists, make the dashboard הכנסות card clickable and route it there.
   - Verification:
   - Direct Income navigation.
   - Finance → Income.
   - Finance → Expenses.
   - Dashboard Income-card navigation after the screen is live.

30. [Income UI] Make the Income list compact and mobile-first, including document-view status.
   - Status: Pending
   - Scope:
   - Reduce unnecessary column width.
   - Remove dead horizontal space.
   - Reduce unnecessary horizontal scrolling.
   - Preserve key business information needed for daily use.
   - Add a fixed eye/view column for Z-report documents.
   - Eye remains visible but light/disabled when no document exists.
   - Eye becomes active when one or more documents exist.
   - Dependency: Task 31 provides persisted Z-report multi-document attachments.

31. [Income documents] Add multi-file document support for Z reports.
   - Status: Pending
   - Scope:
   - Add צלם דו"ח Z to the Z-report entry flow.
   - Support multiple files/documents for one Z report.
   - Reuse existing private file-storage and document-viewer patterns where practical.
   - Use a normalized one-to-many attachment structure rather than one attachment field on the Z record.
   - Store file information and ordering needed to reopen and view all documents reliably.
   - Data impact:
   - Requires a database migration.
   - Requires appropriate ownership/security policies.
   - Verification:
   - Create a Z report with multiple documents.
   - Reopen it.
   - View all attached documents.
   - Confirm eye active/disabled behavior.
   - Confirm one user cannot access another user's documents.

32. [Income] Add non-Z income with project-based activity classification and multi-file documents.
   - Status: Pending
   - Scope:
   - `הכנסה חדשה` offers:
   - דו"ח Z
   - הכנסה אחרת
   - Minimum fields for הכנסה אחרת:
   - Date
   - Amount
   - Customer/payer
   - Income type
   - Project
   - Payment method
   - Reference number
   - Notes
   - Also:
   - Support multiple optional documents.
   - Use a normalized one-to-many attachment structure.
   - Reuse the existing Project concept to distinguish restaurant, food cart, lodging and other company activities.
   - Do not create separate business modules for each activity.
   - Data impact:
   - Requires a non-Z income data model.
   - Requires attachment child records.
   - Requires ownership/security policies.
   - Requires related frontend UI.
   - Verification:
   - Test at least two different projects/activities.
   - Create and reopen records.
   - Verify saved data.
   - Verify attached-document viewing.

33. [Finance aggregation] Include all approved income sources in financial and dashboard totals.
   - Status: Pending
   - Scope:
   - Income totals include both Z-report income and non-Z income where appropriate.
   - Dashboard yearly income uses the complete approved income source set.
   - Profit calculations use the complete approved income source set.
   - Preserve year filtering/current-year behavior consistently.
   - Verification:
   - Test with at least one Z income record and one non-Z income record.
   - Confirm Income list, yearly Income total and Profit calculation reconcile.

# Current-phase completion rule

- Task 21A and critical Task 22 runtime verification are hard gates before Tasks 25–33.
- Task 23 remains required current-phase validation and must be completed before the current phase is formally closed.
- Task 24 remains Done; all new UI work must preserve its accessibility improvements.
- Calendar, Supplier Card, and Asset Card are intentionally NOT current implementation tasks.
- After all currently defined and approved work is completed, the next planned product areas are:
  1. Calendar
  2. Supplier Card
  3. Asset Card

These future areas belong to the separate Product Master Context and should not be expanded into implementation tasks yet.
