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
   - Status: Done
   - Result:
   - Single-invoice and multi-invoice `אבדוק מאוחר יותר` flows persist into the existing pending-review queue, survive close/reopen, resume through the shared pending-review flow, and avoid duplicate pending items or duplicate expenses.
   - Verification:
   - Manually verified and approved in production. Do not revisit unless a future regression specifically requires it.

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
   - Status: Deferred (Final Regression & Acceptance Gate)
   - Execution order note: Task 22 is intentionally deferred until after Tasks 25–34 are completed. Continue normal per-task runtime verification during implementation, then execute this full checklist as the final comprehensive regression/acceptance pass.
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
   - Gate: Complete and pass critical Task 22 runtime verification as the final regression/acceptance gate before current-phase sign-off.

23. [Performance validation] Validate and document performance for:
- large batches (50+ invoices)
- multi-page PDFs
- review list loading time
- invoice navigation speed
- fullscreen viewer responsiveness on mobile
- memory usage during long review sessions
   - Status: Pending
   - Requirement: Task 23 remains required before the current phase is formally complete.
   - Gate clarification: It is not automatically a hard blocker before every individual Tasks 25–34 feature slice unless performance testing reveals a concrete blocker.

24. [Quality & Accessibility] Accessibility Audit (Israel Standard 5568 / WCAG AA)
   - Status: Done
   - Completed: 2026-07-15
   - Result: Accessibility-focused improvements were completed in committed history covering keyboard behavior, semantics, validation/error association, announcements, and focus/touch targets.
   - Verification: Confirmed by accessibility commit series fcecc2d, d31d890, 6bf5a82, 0198221, 164c2fe, 4cd222a; no standalone audit report artifact was found in the repository.
   - Continuity rule: Future UI work must preserve the accessibility improvements completed under Task 24.
   - Reopen rule: Do not reopen or redefine Task 24 unless a new verified accessibility defect is discovered.

25. [User-visible cleanup] Finalize pending-invoice list presentation for mobile.
   - Status: Done
   - Result:
   - Added the visible title `חשבוניות בבדיקה`, kept the compact three-column layout (`מס' חשבונית`, `תאריך`, `שעה`), preserved clickable deterministic invoice labels, and tightened spacing/column widths to reduce dead horizontal space and unnecessary horizontal scrolling on mobile.
   - Verification:
   - Static HTML/CSS validation passed and the rendered diff is limited to the pending-review list presentation.

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
   - Dashboard summary uses 6 cards in a two-column RTL layout:
   - הכנסות החודש
   - הוצאות החודש
   - הכנסות השנה
   - הוצאות השנה
   - רווח / הפסד שנתי
   - מצב חשבון
   - Monetary values display exactly two decimal places.
   - Keep existing dashboard visual language (card style, spacing, hierarchy).
   - הכנסות החודש and הכנסות השנה are clickable because a real destination exists.
   - הוצאות החודש and הוצאות השנה are clickable because a real destination exists.
   - פיננסים remains clickable because a real destination exists.
   - תובנות is clickable because a real Insights destination already exists.
   - משימות remains non-clickable until a real Tasks screen exists.
   - לוח שנה / השבוע הקרוב remains non-clickable until a real Calendar screen exists.
   - Other cards without real destinations remain non-clickable and visually neutral.
   - Quick-action cards keep their own internal controls and must not be hijacked by card-level navigation.
   - Verification:
   - Test whole-card tapping on mobile.
   - Confirm title/value/empty-area taps all navigate on clickable cards.
   - Test keyboard/focus behavior where relevant.
   - Confirm placeholder cards do not visually imply clickability.

29. [Income architecture] Create a dedicated primary הכנסות screen and keep פיננסים as a higher-level access hub.
   - Status: Pending
   - Scope:
   - Income becomes a primary management screen parallel to Expenses.
   - Add direct navigation access for הכנסות.
   - Finance provides clear access to both Income and Expenses.
   - Do not duplicate full Income and Expense management interfaces inside Finance.
   - There must be exactly one Income screen implementation.
   - Dashboard הכנסות החודש, Dashboard הכנסות השנה, and Finance → Income must open the same Income screen via the same navigation path.
   - There must be exactly one Expenses screen implementation.
   - Dashboard הוצאות החודש, Dashboard הוצאות השנה, and Finance → Expenses must open the same Expenses screen.
   - Dashboard cards are entry shortcuts only; no separate monthly/yearly screens.
   - Automatic preset filters are not required at this stage.
   - Verification:
   - Direct Income navigation.
   - Dashboard הכנסות החודש → Income.
   - Dashboard הכנסות השנה → Income.
   - Finance → Income.
   - Dashboard הוצאות החודש → Expenses.
   - Dashboard הוצאות השנה → Expenses.
   - Finance → Expenses.

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
   - Status: Done
   - Completed: 2026-07-26
   - Result: Added multi-file document support for Z reports using a normalized attachment model, integrated into the Z-report entry and reopen/view flows while reusing the existing private storage and document-viewer patterns.
   - Verification: Completed and verified in production, including successful runtime testing of create, reopen, and attached-document viewing behavior.

32. [Post-release bug fixes & UX] Add global back navigation and independent screen scroll behavior.
   - Status: Pending
   - Scope:
   - Every internal screen must include a standard Back button in the page header.
   - The Dashboard is the root screen and must not display a Back button.
   - The Back button must perform true history navigation to the previous screen rather than opening a fixed destination.
   - The behavior must be consistent across the entire application.
   - Screen scroll position must not be shared between views.
   - Navigating to another screen must not inherit the previous screen's scroll position.
   - Each screen should open from the top unless future requirements explicitly specify scroll restoration.
   - Implementation:
   - Implement both fixes.
   - Validate on mobile.
   - Verify that no regressions are introduced.
   - Verification:
   - Wait for Render deployment.
   - Runtime-verify the behavior in production.
   - Completion rule:
   - Task 32 is complete only after runtime verification in production.

33. [Income] Add non-Z income with project-based activity classification and multi-file documents.
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

34. [Finance aggregation] Include all approved income sources in financial and dashboard totals.
   - Status: Pending
   - Scope:
   - Income totals include both Z-report income and non-Z income where appropriate.
   - Dashboard yearly income uses the complete approved income source set.
   - Profit calculations use the complete approved income source set.
   - Preserve year filtering/current-year behavior consistently.
   - Verification:
   - Test with at least one Z income record and one non-Z income record.
   - Confirm Income list, yearly Income total and Profit calculation reconcile.

37. [Company Documents UX] Complete the company-documents module with search, ordering, restore, and information actions.
   - Status: Pending
   - Goal:
   - Build on the completed Task 36 company-document persistence and deletion-policy work.
   - Complete the user-facing Company Documents experience without replacing or duplicating the existing storage, database, viewer, rename, file-replacement, or deletion implementation.
   - Scope:
   - Company Documents screen:
   - Keep the Company Documents module active from the Finance hub.
   - Display one vertically scrollable list of document cards, mobile-first.
   - Support both default document cards and user-created custom document cards in the same list.
   - Default document cards: תעודת התאגדות, אישור ניכוי מס במקור, אישור תיק ניכויים, אישור ניהול חשבון, פרוטוקול בעלי מניות, פרוטוקול דירקטוריון.
   - Each card continues to hold at most one file.
   - A card without a file remains visible and displays `לא הועלה מסמך`.
   - Tapping a card without a file must not open an empty viewer; show `לא נמצא קובץ`.
   - Tapping a card with a file opens the existing shared document viewer.
   - Keep original filename display when a file exists.
   - Search:
   - Add local search to the Company Documents screen.
   - Search is the only list-discovery control required for this module at this stage.
   - Do not add sorting or filtering controls.
   - Personal card order:
   - Allow the user to drag document cards and change their order.
   - Persist the personal order per user.
   - Default and custom cards participate in the same ordered list.
   - A newly added or restored card may be appended to the end of the list.
   - Restore deleted default cards:
   - Add a simple restore action inside Manage Documents.
   - Show only default document types that are currently missing.
   - Let the user choose which missing default cards to restore.
   - Do not recreate deleted defaults automatically on refresh or login.
   - If a default card is restored together with its previous file, keep the user-edited card name.
   - If a default card is restored without a file, restore the default Hebrew name.
   - Editing:
   - Keep rename and optional file replacement in the same editor.
   - Name and file changes remain independent.
   - Renaming must not remove or replace the existing file.
   - Replacing a file must not change the card name unless the user edits it.
   - File replacement must be loss-safe: upload and save the new file successfully before deleting the previous stored file; if upload or save fails, keep the previous file and metadata unchanged.
   - Deletion:
   - Delete remains available only from the document editor, not from list cards.
   - Require confirmation before deletion.
   - Deleting a card removes the database row and its stored file when one exists.
   - This applies to both default and custom document cards.
   - A deleted default card stays deleted until the user explicitly restores it.
   - Information actions:
   - When a file exists, provide Share, Export, and Print according to the shared information-action rules.
   - Export saves the original stored file and preserves the original filename.
   - Print is a separate action from Export.
   - Share uses the device share flow and does not expose a permanent public URL.
   - The viewer may expose Share, Export, and Print in a compact layout that does not reduce the document viewing area unnecessarily.
   - When no file exists, Share, Export, and Print must be hidden or disabled.
   - Constraints:
   - Reuse the existing private storage, signed/private viewer, ownership rules, and Task 36 data model.
   - Do not create a second company-document table or parallel document framework.
   - Do not add version history, expiry dates, renewal reminders, folders, tags, OCR, signatures, or team permission complexity.
   - Preserve accessibility improvements completed under Task 24.
   - Verification:
   - Search finds matching default and custom document cards.
   - No sort or filter controls are introduced.
   - Dragging cards changes the order and the order survives refresh and re-login.
   - A new custom card appears in the list and can be repositioned.
   - A deleted default card is not recreated automatically.
   - Manage Documents shows only missing default cards for restore.
   - Restore without a file uses the default Hebrew name.
   - Restore with the previous file keeps the user-edited name.
   - Clicking an empty card shows `לא נמצא קובץ`.
   - Clicking a card with a file opens the existing viewer.
   - Rename-only preserves the existing file.
   - Replace-only preserves the existing card name.
   - Failed replacement preserves the old file.
   - Successful replacement deletes the old stored file only after the new file is saved.
   - Delete is absent from list cards and available inside the editor.
   - Deleting a card removes its row and stored file.
   - Share, Export, and Print work for image and PDF documents.
   - Cross-user access remains blocked.
   - Completion rule:
   - Task 37 is complete only after the required migration or data changes (if any), deployment, and production runtime verification are successful.

38. [Finance Hub] Complete Finance as the central navigation hub for financial modules.
   - Status: Pending
   - Goal:
   - Complete the Finance screen as a lightweight navigation hub that provides access to all financial modules without duplicating their management interfaces.
   - Scope:
   - Finance is a navigation hub only.
   - Do not recreate Income, Expenses or other management screens inside Finance.
   - Finance provides direct access to: הכנסות, הוצאות, בנקים, מע"מ, מסמכי חברה, הלוואות בעלים.
   - Each destination opens the single implementation of that module.
   - Finance must never become a second dashboard.
   - Reuse existing navigation architecture.
   - Maintain a clean mobile-first layout.
   - Cards with implemented destinations are fully clickable.
   - Cards for future modules may display a disabled state until implemented.
   - Constraints:
   - No duplicated business logic.
   - No duplicated CRUD screens.
   - Preserve existing dashboard navigation.
   - Preserve accessibility improvements from Task 24.
   - Verification:
   - Every Finance card opens the correct destination.
   - No duplicate Income or Expense screens exist.
   - Navigation is consistent from Dashboard and Finance.
   - Disabled future modules cannot be opened.
   - Completion rule:
   - Complete after production runtime verification of all Finance navigation paths.

39. [Expense Details Dialog] Build the complete expense details experience using the existing expense architecture.
   - Status: Pending
   - Goal:
   - Add a dedicated read-first Expense Details dialog that centralizes all information related to a saved expense without replacing the existing create/edit workflow.
   - Scope:
   - Open from the Expenses list.
   - Present business information before edit actions.
   - Display: Supplier, Invoice number, Date and time, Net / VAT / Gross, Accounting category, Charge / Credit, Funding source, Payment method, Project, Notes, Linked documents.
   - Documents:
   - Reuse the existing shared document viewer.
   - Support image and PDF documents.
   - Support multiple attached documents.
   - Selecting a document opens the shared viewer.
   - When no document exists, present an appropriate empty state.
   - Information actions:
   - Share, Export, Print using the shared cross-system implementation.
   - Export preserves original filenames where relevant.
   - Print remains separate from Export.
   - Actions: Edit, Delete, Close.
   - Constraints:
   - Reuse existing expense entities and document infrastructure.
   - Do not duplicate expense-edit screens.
   - Preserve accessibility improvements from Task 24.
   - Verification:
   - Every expense opens correctly from the Expenses list.
   - All stored fields are displayed correctly.
   - Multiple documents open in the shared viewer.
   - Share, Export and Print function correctly.
   - Edit returns to the existing edit flow.
   - Delete follows existing integrity rules.
   - Completion rule:
   - Complete after production runtime verification.

40. [Income Details Dialog] Build the complete income details experience using the unified Income architecture.
   - Status: Pending
   - Goal:
   - Create a dedicated read-first Income Details dialog for both Z-report income and non-Z income while reusing the existing unified Income screen and document infrastructure.
   - Scope:
   - Open from the Income list.
   - Support both Z income and other income types in the same details dialog.
   - Display: Income type, Date and time, Amount, Project, Payment method, Reference number (when applicable), Notes, Linked documents.
   - Documents:
   - Reuse the existing shared viewer.
   - Support multiple image/PDF attachments.
   - Selecting a document opens the shared viewer.
   - Show an appropriate empty state when no documents exist.
   - Information actions:
   - Share, Export, Print using the shared cross-system implementation.
   - Export preserves original filenames where applicable.
   - Print remains separate from Export.
   - Actions: Edit, Delete, Close.
   - Constraints:
   - Reuse the existing unified Income architecture.
   - Do not create separate details implementations for Z and non-Z income.
   - Reuse the shared document infrastructure and information-action components.
   - Preserve accessibility improvements from Task 24.
   - Verification:
   - Z-report income opens correctly.
   - Non-Z income opens correctly.
   - All stored fields are displayed accurately.
   - Multiple documents open in the shared viewer.
   - Share, Export and Print work correctly.
   - Edit returns to the existing edit flow.
   - Delete follows existing integrity rules.
   - Completion rule:
   - Complete after production runtime verification.

41. [Shared Information Actions] Implement reusable Viewer / Share / Export / Print infrastructure for information screens.
   - Status: Pending
   - Goal:
   - Create one shared implementation for viewing, sharing, exporting, and printing information across the application.
   - Reuse this infrastructure in Company Documents, Expense Details, Income Details, and future information screens instead of building separate behavior in each module.
   - Scope:
   - Information-screen rule: apply Share, Export, and Print to information screens including list screens; do not add these actions to create, edit, or data-entry screens.
   - Viewer:
   - Reuse one shared viewer for supported images and PDFs.
   - The viewer displays only the selected document.
   - Do not add previous/next document navigation inside the viewer; to open another document, the user returns to the originating document list.
   - When no file exists, do not open an empty viewer; show `לא נמצא קובץ`.
   - Viewer actions: allow Share, Export, and Print from the viewer; keep action controls compact.
   - Share:
   - Open the device or operating-system share flow.
   - If an existing PDF is already available, share it; otherwise generate the required temporary PDF.
   - Do not expose permanent public document URLs.
   - For tabular reports, Share uses a PDF representation. Excel and CSV remain Export formats only.
   - Export:
   - Use one `ייצא` button offering only formats relevant to the current information screen.
   - Export means saving a file to the computer or device.
   - When exporting an existing stored document, preserve the original filename.
   - Print:
   - Print is a separate action from Export.
   - Print uses the operating-system or browser print flow.
   - When appropriate, reuse the same PDF output used for sharing and PDF export.
   - Report PDF standard: business logo, business name, report name, generation date and time, name of the user who generated the report, all active filters, page numbering. The generated report must reflect the current visible report state.
   - File-replacement safety: when replacing a stored file, do not delete the previous file before the replacement file has been uploaded and saved successfully; if upload or save fails, keep the previous file and metadata unchanged.
   - Interaction and feedback: show loading state during processing; prevent duplicate clicks; show clear success and failure messages.
   - Initial integrations: Company Documents, Expense Details, Income Details, Reports, Supplier Card when implemented, Asset Card when implemented.
   - Constraints:
   - Reuse existing private storage and signed/private file-access patterns.
   - Do not create parallel Viewer, Share, Export, or Print implementations per module.
   - Do not introduce unrelated formats or actions that were not approved.
   - Preserve accessibility improvements completed under Task 24.
   - Verification:
   - Viewer opens supported image and PDF files from each initial integrated module.
   - Empty-file actions show `לא נמצא קובץ` and do not open an empty viewer.
   - Viewer controls remain compact on mobile.
   - Share opens the native share flow where supported.
   - Shared links or files do not expose permanent public URLs.
   - Export presents one button with only relevant formats.
   - Exported existing documents keep their original filenames.
   - Print is separate from Export.
   - A tabular report shares as PDF. Excel and CSV remain export-only formats.
   - Report PDF contains all approved identifying and filter information.
   - Generated report output matches the current visible data and filters.
   - Duplicate clicks are blocked during processing.
   - A failed file replacement leaves the previous file intact.
   - Cross-user document access remains blocked.
   - Completion rule:
   - Task 41 is complete only after integration into the approved initial modules, deployment, and production runtime verification.

42. [Projects] Implement the Projects module as the business activity backbone of the system.
   - Status: Pending
   - Goal:
   - Introduce Projects as a shared business entity that organizes income, expenses, assets and future modules without creating separate systems for each business activity.
   - Scope:
   - Create a dedicated Projects management screen.
   - Include the built-in project `כללי`.
   - Every income and expense must belong to exactly one project; if no specific project applies, automatically use `כללי`.
   - Allow creating new projects and editing project details.
   - Support Active / Inactive status; inactive projects remain available historically but are not offered by default for new records.
   - Deleting a project: a project containing linked entities cannot be deleted until all linked entities are reassigned; require selecting a replacement project before deletion completes.
   - Relationships: Expenses belong to one project; Income belongs to one project; future assets, suppliers, reports and analytics reuse the same project entity.
   - Filtering: support filtering Income and Expenses by project; future modules reuse the same filtering model.
   - Constraints:
   - Do not build separate project types for restaurant, food truck, lodging or other activities.
   - Reuse one shared Projects entity across the application.
   - Preserve accessibility improvements from Task 24.
   - Verification:
   - Built-in project `כללי` exists.
   - New income and expense records always have exactly one project.
   - Inactive projects are hidden by default from new-entry selectors.
   - Project deletion requires reassignment when linked records exist.
   - Filters return only matching project data.
   - Completion rule:
   - Complete after deployment and production runtime verification.

43. [Supplier Card] Implement the Supplier Card as the central business view for each supplier.
   - Status: Pending
   - Goal:
   - Transform suppliers from a simple selection field into a reusable business entity while keeping the module lightweight and focused on real operational needs.
   - Scope:
   - Create a dedicated Supplier Card screen.
   - Display: Supplier name, Business name (when different), Tax ID, Contact information when available, Active / Inactive status.
   - Financial information: Related expenses, Related invoices and documents, Total amounts paid, Purchase history.
   - Relationships: Linked projects, Linked assets purchased from the supplier, Future integration with supplier orders, deliveries and delivery-time analysis.
   - Documents: Reuse the shared document infrastructure; support viewing, sharing, exporting and printing supplier documents.
   - Ordering workflow: prepare the Supplier Card for future ordering integration without implementing full purchasing management; support storing preferred ordering method and related contact details.
   - Business rules:
   - New suppliers can still be created directly during expense entry.
   - Newly created suppliers are automatically selected for the current expense.
   - Suppliers with linked expenses cannot be deleted.
   - Suppliers without linked expenses may be deleted.
   - Inactive suppliers remain available historically but are hidden by default when selecting a supplier for a new expense.
   - Constraints:
   - Do not build a full CRM.
   - Do not implement purchasing, deliveries or payment tracking in this task.
   - Reuse existing supplier data wherever possible.
   - Preserve accessibility improvements from Task 24.
   - Verification:
   - Supplier opens from linked expenses.
   - Related expenses and documents are displayed correctly.
   - Documents open in the shared viewer.
   - Active / Inactive behavior matches approved rules.
   - Delete rules prevent removing suppliers with linked expenses.
   - Completion rule:
   - Complete after deployment and successful production runtime verification.

44. [Asset Card] Implement the Asset module and connect assets to the complete purchasing lifecycle.
   - Status: Pending
   - Goal:
   - Build a dedicated Asset Card that represents business assets created from purchases while preventing duplicate data entry by reusing existing expense and document information.
   - Scope:
   - Create a dedicated Assets management screen.
   - Allow creating an asset directly from an existing expense.
   - Reuse existing information from the expense, invoice and source document whenever possible.
   - Asset card includes: Name / Description, Category / Type, Purchase date, Supplier, Purchase cost, Source document, Originating expense, Assigned project, Relevant accounting information.
   - Relationships: Asset ↔ Expense, Asset ↔ Supplier, Asset ↔ Project, Asset ↔ Source document.
   - Navigation: open the Asset Card from linked expenses; open the originating expense from the Asset Card.
   - Documents: Reuse the shared document viewer; support Share / Export / Print through the shared infrastructure.
   - Business rules:
   - Avoid duplicate data entry.
   - The asset must never become an isolated record.
   - Future lifecycle, maintenance, depreciation, warranties and operational management remain out of scope for this task.
   - Constraints:
   - Do not build inventory management.
   - Reuse existing entities and document infrastructure.
   - Preserve accessibility improvements from Task 24.
   - Verification:
   - Asset creation from an expense reuses existing business data.
   - Supplier, project, expense and source document remain linked.
   - Asset and originating expense open each other correctly.
   - Documents open in the shared viewer.
   - No duplicate business data is created.
   - Completion rule:
   - Complete after deployment and successful production runtime verification.

45. [Accounting Categories] Implement accounting-category management and safe reassignment rules.
   - Status: Pending
   - Goal:
   - Provide a dedicated accounting-category module that supports day-to-day business management while remaining compatible with accountant workflows.
   - Scope:
   - Create a dedicated Accounting Categories management screen.
   - Support the approved default categories: רכוש קבוע, הוצאות הקמה, מלאי, עובדים, הוצאה שוטפת, תשלום מראש, ציוד מתכלה.
   - Allow adding additional categories when business needs require them.
   - Allow editing category names and status.
   - Deletion: a category with linked expenses cannot simply be deleted; require selecting a replacement category; reassign all linked expenses before completing deletion.
   - Expense behavior: every expense has one primary accounting category; do not split a single expense into multiple accounting categories.
   - Relationships: reuse existing expense architecture; reports and filters automatically use the updated category assignments.
   - Constraints:
   - This is a business-management classification and does not replace the accountant's final accounting treatment.
   - Do not introduce multi-category allocation or percentage splitting.
   - Preserve accessibility improvements from Task 24.
   - Verification:
   - Default categories exist.
   - New categories can be created.
   - Category deletion requires reassignment when linked expenses exist.
   - Linked expenses move correctly to the replacement category.
   - Reports and filters reflect the reassigned category.
   - Completion rule:
   - Complete after deployment and successful production runtime verification.

46. [Global Search] Implement unified global and local search across the application.
   - Status: Pending
   - Goal:
   - Allow users to quickly locate business information anywhere in the system while preserving simple, module-focused local searches.
   - Scope:
   - Global Search: add one application-wide search entry point; search by keyword across Expenses, Income, Suppliers, Projects, Company Documents, Assets (after Task 44); present grouped results by entity type; selecting a result opens the relevant screen or details dialog.
   - Local Search: every major module continues to provide its own local search where approved; local search searches only within the current module.
   - Search behavior: match meaningful business fields; ignore inactive modules that have not yet been implemented; keep mobile-first performance and simple interaction.
   - Constraints:
   - Do not replace module-specific filters.
   - Do not implement advanced search syntax or saved searches.
   - Do not introduce full-text indexing beyond current business needs.
   - Preserve accessibility improvements from Task 24.
   - Verification:
   - Global search finds supported entities.
   - Results open the correct destination.
   - Local searches remain independent.
   - Searches remain responsive on mobile.
   - Completion rule:
   - Complete after deployment and successful production runtime verification.

47. [Calendar] Implement the business calendar as the central scheduling view.
   - Status: Pending
   - Goal:
   - Provide a simple business calendar for planning and viewing business activities without becoming a full project-management system.
   - Scope:
   - Create a dedicated Calendar screen.
   - Support Month, Week and Day views optimized for mobile.
   - Allow creating, editing and deleting calendar events.
   - Each event includes: Title, Date, Start and end time, Optional notes, Optional linked project.
   - Navigation: open from the Dashboard when the Calendar card becomes active; open directly from the main navigation.
   - Future integration: prepare links to Tasks, Supplier Orders, Deliveries and Projects without implementing those modules in this task.
   - Business rules: calendar events remain independent of expenses and income unless explicitly linked; preserve one shared calendar for the business.
   - Constraints:
   - Do not implement recurring events, reminders, external calendar synchronization or team scheduling.
   - Do not introduce resource planning or Gantt functionality.
   - Preserve accessibility improvements from Task 24.
   - Verification:
   - Events can be created, edited and deleted.
   - Month, Week and Day views display correctly.
   - Linked projects open correctly when present.
   - Calendar performs well on mobile devices.
   - Completion rule:
   - Complete after deployment and successful production runtime verification.

48. [Tasks] Implement the business task management module.
   - Status: Pending
   - Goal:
   - Provide a lightweight task-management module focused on real business work, integrated with the Calendar and Projects modules without becoming a full project-management platform.
   - Scope:
   - Create a dedicated Tasks screen.
   - Allow creating, editing, completing and deleting tasks.
   - Each task includes: Title, Description (optional), Status (Open / Completed), Due date (optional), Optional linked project, Notes.
   - Dashboard integration: the Dashboard task card becomes active after this module is implemented; show open task count.
   - Calendar integration: tasks with a due date may appear in the Calendar.
   - Business rules: tasks remain separate from expenses, income and documents unless explicitly linked in future work; completed tasks remain available in history.
   - Constraints:
   - Do not implement subtasks, recurring tasks, Kanban boards, dependencies, assignments, notifications or collaboration features.
   - Preserve accessibility improvements from Task 24.
   - Verification:
   - Tasks can be created, edited, completed and deleted.
   - Open/completed status behaves correctly.
   - Dashboard reflects open task count.
   - Due-date tasks appear correctly in Calendar integration.
   - Completion rule:
   - Complete after deployment and successful production runtime verification.

49. [Supplier Orders] Implement supplier order management as the first stage of the purchasing workflow.
   - Status: Pending
   - Goal:
   - Add a lightweight purchasing workflow that allows the business to manage supplier orders without introducing a full procurement system.
   - Scope:
   - Create a dedicated Supplier Orders screen.
   - Each order includes: Supplier, Project, Order date, Expected delivery date (optional), Status (Open / Partially Received / Completed / Cancelled), Notes, Linked documents.
   - Relationships: Supplier → Order → Delivery → Invoice/Document → Expense; link orders to existing Supplier Cards and future Deliveries.
   - Documents: reuse the shared Viewer, Share, Export and Print infrastructure.
   - Business rules: orders may exist before an invoice is received; an order can later be linked to expenses and supplier documents.
   - Constraints:
   - Do not implement inventory reservation, approvals, quotations, multi-step procurement or payment management.
   - Preserve accessibility improvements from Task 24.
   - Verification:
   - Orders can be created, edited and completed.
   - Orders link correctly to suppliers and projects.
   - Documents open in the shared viewer.
   - Status changes behave correctly.
   - Completion rule:
   - Complete after deployment and successful production runtime verification.

50. [Deliveries] Implement supplier deliveries as the receiving stage of the purchasing workflow.
   - Status: Pending
   - Goal:
   - Record and manage supplier deliveries while connecting them to supplier orders, invoices, expenses and future delivery analytics.
   - Scope:
   - Create a dedicated Deliveries screen.
   - Each delivery includes: Supplier, Related supplier order (optional), Project, Expected delivery date, Actual delivery date, Status (Pending / Partially Received / Received / Cancelled), Notes, Linked documents.
   - Relationships: Supplier → Order → Delivery → Invoice/Document → Expense; allow deliveries with or without an originating supplier order; support linking one delivery to one or more future expenses when applicable.
   - Documents: reuse the shared Viewer, Share, Export and Print infrastructure.
   - Business rules: partial deliveries are supported; a delivery may be completed before the supplier invoice is received; receiving a delivery does not automatically create an expense.
   - Future preparation: preserve delivery dates for future delivery-time statistics.
   - Constraints:
   - Do not implement inventory receiving, barcode scanning, warehouse locations or stock adjustments.
   - Preserve accessibility improvements from Task 24.
   - Verification:
   - Deliveries can be created, edited and completed.
   - Partial deliveries behave correctly.
   - Supplier, order and project links remain valid.
   - Documents open correctly in the shared viewer.
   - Delivery completion does not automatically create an expense.
   - Completion rule:
   - Complete after deployment and successful production runtime verification.

51. [Delivery Time Analytics] Implement supplier delivery-time tracking and performance metrics.
   - Status: Pending
   - Goal:
   - Measure supplier delivery performance using real delivery history to support future purchasing decisions.
   - Scope:
   - Reuse data collected by Supplier Orders and Deliveries.
   - Calculate delivery duration using: order date, expected delivery date, actual delivery date.
   - Display per supplier: average delivery time, on-time deliveries, late deliveries, early deliveries, number of completed deliveries.
   - Display basic delivery history inside the Supplier Card.
   - Allow filtering statistics by project and date range.
   - Business rules: only completed deliveries participate in statistics; cancelled deliveries are excluded; partial deliveries contribute only after completion.
   - Future preparation: reuse these metrics when suggesting realistic expected delivery dates for new supplier orders.
   - Constraints:
   - Do not introduce predictive AI, supplier scoring, procurement optimization or external logistics integrations.
   - Reuse existing Supplier, Orders and Deliveries entities.
   - Preserve accessibility improvements from Task 24.
   - Verification:
   - Delivery durations are calculated correctly.
   - Cancelled deliveries are excluded.
   - Supplier statistics match delivery history.
   - Project and date filters work correctly.
   - Completion rule:
   - Complete after deployment and successful production runtime verification.

52. [Asset Lifecycle] Extend the Asset module with lifecycle management.
   - Status: Pending
   - Goal:
   - Extend the Asset module beyond the initial Asset Card by managing the complete business lifecycle of an asset while keeping the implementation focused on real operational needs.
   - Scope:
   - Extend the existing Asset Card.
   - Maintain one complete history for every asset.
   - Add lifecycle information: Acquisition, Operational status, Maintenance history, Asset-related expenses, Additional documents, Disposal / Retirement.
   - Support attaching additional documents throughout the asset's lifetime.
   - Allow linking future expenses directly to the asset.
   - Display the complete chronological asset history.
   - Reuse Supplier, Expense, Project, Shared Documents and the shared Viewer / Share / Export / Print infrastructure.
   - Business rules: assets are business entities and are not inventory; every asset keeps a connection to its originating purchase whenever one exists; asset-related expenses supplement the asset history and do not replace the original purchase expense.
   - Future preparation: preserve the ability to support depreciation, warranty tracking and additional operational information later without redesigning the data model.
   - Constraints:
   - Do not implement depreciation calculations.
   - Do not implement maintenance scheduling.
   - Do not implement inventory management.
   - Preserve accessibility improvements completed under Task 24.
   - Verification:
   - Additional expenses can be linked to an asset.
   - Additional documents appear in the asset history.
   - Asset history is chronological.
   - Supplier, Project, Expense and Asset relationships remain consistent.
   - Completion rule:
   - Complete after deployment and successful production runtime verification.

53. [Banks] Implement the Banks module as the central management area for business bank accounts.
   - Status: Pending
   - Goal:
   - Provide a dedicated Banks module within Finance that centralizes business bank accounts and prepares the system for future financial capabilities without introducing unnecessary banking complexity.
   - Scope:
   - Create a dedicated Banks management screen.
   - Manage business bank accounts.
   - Display: Bank name, Account nickname, Account number (masked where appropriate), Active / Inactive status, Notes.
   - Allow creating, editing and deactivating bank accounts.
   - Reuse existing Funding Sources and Payment Methods where applicable.
   - Prepare future integration with VAT, Owner Loans, Cash Flow and Government Payments.
   - Business rules: banks are financial entities only; expenses and income continue to store Funding Source and Payment Method independently; inactive bank accounts remain available historically but cannot be selected for new records.
   - Constraints:
   - Do not implement automatic bank synchronization.
   - Do not import bank statements.
   - Do not implement reconciliation or open banking APIs.
   - Preserve accessibility improvements completed under Task 24.
   - Verification:
   - Bank accounts can be created, edited and deactivated.
   - Inactive accounts cannot be selected for new records.
   - Existing linked records remain valid.
   - Navigation from Finance works correctly.
   - Completion rule:
   - Complete after deployment and successful production runtime verification.

54. [VAT] Implement the VAT management module.
   - Status: Pending
   - Goal:
   - Provide a dedicated VAT module that gives the business visibility into VAT information derived from existing business records while keeping tax-management complexity out of the current phase.
   - Scope:
   - Create a dedicated VAT screen accessible from Finance.
   - Display VAT information calculated from existing Expenses and Income.
   - Provide period-based VAT summaries.
   - Allow filtering by reporting period and project.
   - Allow exporting VAT reports using the shared Export infrastructure.
   - Support Share and Print using the shared information-actions infrastructure.
   - Business rules: VAT information is calculated from existing transactions; the module is informational and supports business control; it does not replace the accountant or official tax reporting.
   - Future preparation: prepare integration with future Government Payments and advanced financial reporting.
   - Constraints:
   - Do not implement tax filing.
   - Do not submit reports to authorities.
   - Do not calculate penalties or interest.
   - Preserve accessibility improvements completed under Task 24.
   - Verification:
   - VAT summaries match underlying expenses and income.
   - Filters return correct reporting periods.
   - Export, Share and Print work correctly.
   - Navigation from Finance works correctly.
   - Completion rule:
   - Complete after deployment and successful production runtime verification.

55. [Owner Loans] Implement the Owner Loans module.
   - Status: Pending
   - Goal:
   - Provide a dedicated module for managing owner loans separately from funding sources while maintaining a clear picture of amounts invested in or withdrawn from the business by each owner.
   - Scope:
   - Create a dedicated Owner Loans screen accessible from Finance.
   - Support multiple owners.
   - Display: Owner, Transaction date, Amount, Direction (Loan to Business / Repayment), Notes, Linked supporting documents (optional).
   - Automatically calculate the running balance for each owner.
   - Allow creating, editing and deleting owner-loan transactions.
   - Reuse the shared document infrastructure; support Viewer, Share, Export and Print.
   - Business rules: Owner Loans remain separate from Payment Methods and Funding Sources; each transaction belongs to exactly one owner; historical transactions remain unchanged even if an owner becomes inactive.
   - Future preparation: prepare integration with Banks, Cash Flow and advanced financial reporting.
   - Constraints:
   - Do not implement interest calculations.
   - Do not implement repayment schedules.
   - Do not implement accounting journal entries.
   - Preserve accessibility improvements completed under Task 24.
   - Verification:
   - Transactions can be created, edited and deleted.
   - Running balances are calculated correctly.
   - Supporting documents open correctly in the shared viewer.
   - Navigation from Finance works correctly.
   - Share, Export and Print function correctly.
   - Completion rule:
   - Complete after deployment and successful production runtime verification.

56. [VAT Reporting Periods] Prevent accidental changes to already-reported VAT periods.
   - Status: Pending
   - Goal:
   - Protect the integrity of accounting records by warning the user before creating or modifying financial records that belong to a VAT reporting period already reported to the accountant.
   - Scope:
   - Introduce one shared "Reported VAT Period" concept used by both Income and Expenses.
   - Support marking a VAT reporting period as Reported or Not Reported.
   - Before saving or editing an Income or Expense: determine the VAT reporting period from the document date; if that period is already marked as Reported, show a warning dialog and allow the user to continue anyway without blocking the save.
   - Warning text: explain that the record belongs to a period already reported to the accountant; explain that a correcting VAT report or accountant action may be required.
   - The dialog appears only once per save attempt.
   - Do not automatically change document date, entry date, or VAT period.
   - Reuse one shared warning flow for both Income and Expenses.
   - Constraints:
   - Do not lock reported periods.
   - Do not prevent editing.
   - Do not implement accountant approval workflows.
   - Do not calculate corrective VAT automatically.
   - Preserve accessibility improvements completed under Task 24.
   - Verification:
   - Saving inside an unreported period proceeds normally.
   - Saving inside a reported period shows the warning exactly once.
   - Choosing Continue saves successfully.
   - Choosing Cancel aborts the save.
   - Income and Expense use the same warning behavior.
   - Completion rule:
   - Complete after deployment and successful production runtime verification.

57. [Budgets] Implement the Budgets module for business planning and control.
   - Status: Pending
   - Goal:
   - Provide a practical budgeting module that helps compare planned spending against actual business activity without adding unnecessary financial complexity.
   - Scope:
   - Create a dedicated Budgets screen accessible from Finance.
   - Allow creating annual and monthly budgets.
   - Budgets may be defined by: Project, Accounting category, Overall business.
   - Display: Planned amount, Actual amount, Remaining budget, Budget utilization (%), Over-budget indication.
   - Automatically calculate actual values from existing expenses.
   - Support filtering by period and project.
   - Reuse the shared Export, Share and Print infrastructure.
   - Business rules: budgets are management tools and do not modify accounting records; actual values are calculated from approved business data; budget overruns generate clear visual warnings but do not block business operations.
   - Future preparation: prepare integration with Cash Flow, AI Business Insights and advanced financial reports.
   - Constraints:
   - Do not implement approval workflows.
   - Do not implement budget versioning or forecasting.
   - Do not modify expense records.
   - Preserve accessibility improvements completed under Task 24.
   - Verification:
   - Budgets can be created, edited and deleted.
   - Planned and actual values are calculated correctly.
   - Over-budget indicators appear correctly.
   - Filters and exports work correctly.
   - Completion rule:
   - Complete after deployment and successful production runtime verification.

58. [Cash Flow] Implement the Cash Flow module for business liquidity monitoring.
   - Status: Pending
   - Goal:
   - Provide a practical cash-flow view that helps the business understand incoming and outgoing money using existing business data, without replacing accounting software.
   - Scope:
   - Create a dedicated Cash Flow screen accessible from Finance.
   - Display cash-flow summaries by: Month, Year, Project.
   - Show: Total inflows, Total outflows, Net cash flow, Opening balance (manual if required), Closing balance.
   - Calculate values from existing Income, Expenses and Owner Loans.
   - Prepare integration with Banks and Budgets.
   - Support filtering, Share, Export and Print using the shared infrastructure.
   - Business rules: Cash Flow is a management tool only; calculations are based on recorded business transactions; the module never modifies source records.
   - Future preparation: prepare support for future forecasting and scenario analysis.
   - Constraints:
   - Do not implement bank reconciliation.
   - Do not predict future cash flow automatically.
   - Do not replace accountant reports.
   - Preserve accessibility improvements completed under Task 24.
   - Verification:
   - Cash-flow calculations match underlying business data.
   - Filters produce correct results.
   - Share, Export and Print operate correctly.
   - Navigation from Finance works correctly.
   - Completion rule:
   - Complete after deployment and successful production runtime verification.

59. [Government Payments] Implement the Government Payments module.
   - Status: Pending
   - Goal:
   - Provide a dedicated module for managing payments to government authorities while keeping them separate from supplier expenses and routine business transactions.
   - Scope:
   - Create a dedicated Government Payments screen within Finance.
   - Support payment records for: VAT, Income Tax, National Insurance, Additional authorities when required.
   - Each payment includes: Authority, Reporting period, Due date, Payment date, Amount, Status, Notes, Supporting documents.
   - Reuse the shared document infrastructure; support Viewer, Share, Export and Print.
   - Prepare future integration with VAT, Banks and Cash Flow.
   - Business rules: government payments are independent financial records; they are not supplier expenses; completed historical records remain immutable.
   - Constraints:
   - Do not implement electronic filing.
   - Do not connect to government systems.
   - Do not calculate taxes automatically.
   - Preserve accessibility improvements completed under Task 24.
   - Verification:
   - Payments can be created, edited and completed.
   - Documents open correctly in the shared viewer.
   - Navigation from Finance works correctly.
   - Share, Export and Print function correctly.
   - Completion rule:
   - Complete after deployment and successful production runtime verification.

60. [AI Business Insights] Implement AI-powered business insights.
   - Status: Pending
   - Goal:
   - Provide practical AI-generated business insights that help the owner understand business performance using existing business data, without replacing professional accounting or business judgment.
   - Scope:
   - Create a dedicated AI Business Insights screen accessible from Finance.
   - Generate insights from existing business information including: Income, Expenses, Projects, Budgets, Cash Flow, Supplier activity.
   - Examples of supported insights: spending trends, income trends, budget overruns, project profitability indicators, supplier purchasing patterns, cash-flow observations.
   - Display insights in plain language.
   - Allow refreshing insights on demand.
   - Support Share, Export and Print using the shared infrastructure.
   - Business rules: AI insights are advisory only; business records remain the source of truth; insights never modify business data automatically.
   - Future preparation: prepare support for future predictive analysis, recommendations and advanced decision-support capabilities.
   - Constraints:
   - Do not automatically change business records.
   - Do not generate accounting entries.
   - Do not replace accountant advice.
   - Preserve accessibility improvements completed under Task 24.
   - Verification:
   - Insights are generated from current business data.
   - Refresh produces updated insights.
   - Share, Export and Print function correctly.
   - Navigation from Finance works correctly.
   - Completion rule:
   - Complete after deployment and successful production runtime verification.

61. [Reported Periods] Implement reported-period management and late-entry warnings.
   - Status: Pending
   - Goal:
   - Allow the business to manage periods that have already been reported to the accountant and warn before adding new transactions into those periods.
   - Dependency:
   - Implement only after Task 60 – Financial Reports.
   - Do not start this task before the reporting workflow exists.
   - Scope:
   - Allow the user to mark a reporting period as reported to the accountant.
   - Allow reversing that status.
   - Use the document date to determine whether a new income or expense belongs to a reported period.
   - Before saving into a reported period, show a non-blocking warning.
   - Apply to both Income and Expenses.
   - Integrate the period status with Financial Reports and future VAT reporting.
   - Warning behavior:
   - Do not block saving.
   - Do not change the document date automatically.
   - Do not change the entry date automatically.
   - Show the warning once per save attempt.
   - Allow:
   - `המשך ושמור`
   - `ביטול`
   - Constraints:
   - Do not implement this task before Task 60.
   - Do not add a standalone reported-period table without a user-facing management flow.
   - Do not change existing accounting, VAT, export, or period calculations.
   - Preserve accessibility improvements completed under Task 24.
   - Verification:
   - A period can be marked as reported and reopened.
   - New income and expenses in a reported period trigger the warning.
   - Saving can continue after confirmation.
   - Cancelling leaves the form unchanged.
   - Document date and entry date remain unchanged.
   - Reports and VAT calculations continue using the document date.
   - Completion rule:
   - Complete after deployment and successful production runtime verification.

62. [Future Enhancements & Backlog] Reserved for future features after completion of the core business-management platform.
   - Status: Deferred
   - Goal:
   - Keep a dedicated backlog for ideas and future capabilities without allowing them to expand the current implementation scope.
   - Scope:
   - This section intentionally contains no implementation work during the current project phase.
   - New ideas should be added here only after evaluating whether they are truly necessary.
   - Items may include future enhancements such as: Advanced automation, External integrations, AI improvements, Advanced analytics, Industry-specific features, Other post-release ideas.
   - Business rules:
   - Nothing in this task may be implemented before all planned production tasks are completed and accepted.
   - Constraints:
   - Do not move backlog items into active development without explicit approval.
   - Preserve the project's philosophy of minimal complexity and practical business value.
   - Verification:
   - Not applicable during the current implementation phase.
   - Completion rule:
   - Remains deferred until after the planned platform is fully completed and production-approved.

# Current-phase completion rule

- Task 22 is intentionally deferred and serves as the final comprehensive regression and acceptance gate after the currently planned implementation work (Tasks 25–34) has been completed.
- Task 23 remains required current-phase validation and must be completed before the current phase is formally closed.
- Task 24 remains Done; all new UI work must preserve its accessibility improvements.
- Calendar, Supplier Card, and Asset Card are intentionally NOT current implementation tasks.
- After all currently defined and approved work is completed, the next planned product areas are:
  1. Calendar
  2. Supplier Card
  3. Asset Card

These future areas belong to the separate Product Master Context and should not be expanded into implementation tasks yet.
