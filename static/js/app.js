const $ = id => document.getElementById(id);
let sb, session, userId, business = {}, selectedFiles = [];
let isExpenseSaving = false;
let initialSessionChecked = false;
let currentScanOperationId = null;
let currentScanSelectionSignature = "";
let pendingGroupingAnalysisResult = null;
let pendingManualGroupingDraft = null;
let isManualGroupingConfirming = false;
let activeExpenseReviewContext = null;
let expenseReviewLoadToken = 0;
let expenseReviewRows = [];
let pendingExpenseEntryRows = [];
let currentExpenseReviewDocument = null;
let expenseReviewFullscreenOpener = null;
let currentFullscreenImageState = null;
let currentExpenseReviewPages = [];
let currentExpenseReviewPageIndex = 0;
let currentManualGroupingPreviewUrl = null;
let manualGroupingPreviewToken = 0;
let isCheckpointResumeRunning = false;
let isDeferredAnalyzeInFlight = false;
let currentAnalyzeRunToken = 0;
let expenseExtractedPreviewLoadToken = 0;
let selectedZFiles = [];
let isZSaving = false;
let pendingZReportId = "";
let shouldResetZFormAfterClose = false;
let pendingZSuccessToastMessage = "";
let currentZReportEditId = "";
let currentZIncomeSource = "z_report";
let currentZDocuments = [];
let currentZDocumentIndex = -1;
let currentZViewerDocument = null;
let zDocumentsFullscreenOpener = null;
let zDocumentsLoadToken = 0;
let toastHideTimer = null;
const fileSha256Cache = new WeakMap();
const localFileObjectUrls = new Map();
const extractedPreviewSignedUrlCache = new Map();
const zDocumentsSignedUrlCache = new Map();
const incomeTypeSuggestions = new Map();
const GROUPING_CONFIDENCE_THRESHOLD = 0.8;
const Z_INCOME_TYPE_DEFAULT = 'דו"ח Z';
const NON_Z_INCOME_SOURCE = "non_z";
const Z_REPORT_INCOME_SOURCE = "z_report";
const ACTIVE_VIEW_KEY = "activeView";
const VIEW_HISTORY_STATE_KEY = "appView";
const ROOT_VIEW_ID = "homeView";
const AVAILABLE_VIEWS = ["homeView","expensesView","incomeView","financeView","teamView","alView"];
const EXPENSE_STORAGE_CLEANUP_QUEUE_KEY = "expenseStorageCleanupQueue";
const EXPENSE_DIALOG_PRIMARY_STATES = Object.freeze({
  UPLOAD: "upload",
  PENDING_CHOICE: "pendingChoice",
  PENDING_REVIEW_LIST: "pendingReviewList",
  REVIEW_CONTEXT: "reviewContext",
  MANUAL_GROUPING: "manualGrouping",
  EXTRACTED_FORM: "extractedForm"
});
let currentExpenseDialogPrimaryState = EXPENSE_DIALOG_PRIMARY_STATES.UPLOAD;
let canDeferSingleExtractedInvoice = false;
const EXPENSE_DIALOG_MODES = Object.freeze({
  NEW: "new",
  DETAILS_READONLY: "detailsReadonly",
  DETAILS_EDIT: "detailsEdit"
});
let currentExpenseDialogMode = EXPENSE_DIALOG_MODES.NEW;
let currentExpenseDetailsRecord = null;
let currentExpenseEditId = "";
let currentExpensePermissions = {canEdit:true, canDelete:true};

const showLoading = () => {
  $("loadingScreen")?.classList.remove("hidden");
  $("authScreen")?.classList.add("hidden");
  $("appShell")?.classList.add("hidden");
};

const hideLoading = () => $("loadingScreen")?.classList.add("hidden");

const getSavedViewId = () => {
  try {
    const viewId = sessionStorage.getItem(ACTIVE_VIEW_KEY);
    return AVAILABLE_VIEWS.includes(viewId) ? viewId : null;
  } catch {
    return null;
  }
};

const saveActiveViewId = viewId => {
  if(!AVAILABLE_VIEWS.includes(viewId)) return;
  try { sessionStorage.setItem(ACTIVE_VIEW_KEY, viewId); } catch {}
};

const clearSavedViewId = () => {
  try { sessionStorage.removeItem(ACTIVE_VIEW_KEY); } catch {}
};

const getActiveViewId = () => document.querySelector(".view.active")?.id || ROOT_VIEW_ID;

const getHistoryViewId = state => {
  const viewId = state && typeof state === "object" ? state[VIEW_HISTORY_STATE_KEY] : null;
  return AVAILABLE_VIEWS.includes(viewId) ? viewId : null;
};

const setViewHistoryState = (viewId, mode) => {
  if(!window.history) return;

  const state = {[VIEW_HISTORY_STATE_KEY]: viewId};
  if(mode === "replace"){
    window.history.replaceState(state, "");
    return;
  }

  if(mode === "push"){
    window.history.pushState(state, "");
  }
};

const syncBackButton = viewId => {
  const backButton = $("viewBackButton");
  if(!backButton) return;

  const isRootView = viewId === ROOT_VIEW_ID;
  backButton.classList.toggle("hidden", isRootView);
  backButton.disabled = isRootView;
};

const resetViewScrollPosition = () => {
  const applyScrollReset = () => {
    document.querySelector("main")?.scrollTo?.(0, 0);
    document.scrollingElement?.scrollTo?.(0, 0);
    window.scrollTo(0, 0);
  };

  applyScrollReset();
  window.requestAnimationFrame(applyScrollReset);
};

const activateView = (viewId, options = {}) => {
  const {historyMode = "push", resetScroll = true} = options;
  const target = AVAILABLE_VIEWS.includes(viewId) ? viewId : ROOT_VIEW_ID;
  const currentViewId = getActiveViewId();

  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === target));
  document.querySelectorAll(".bottom-nav button").forEach(button => {
    button.classList.toggle("active", button.dataset.view === target);
  });

  syncBackButton(target);
  saveActiveViewId(target);

  if(historyMode === "replace"){
    setViewHistoryState(target, "replace");
  } else if(historyMode === "push" && currentViewId !== target){
    setViewHistoryState(target, "push");
  }

  if(resetScroll && currentViewId !== target){
    resetViewScrollPosition();
  }
};

if("scrollRestoration" in window.history){
  window.history.scrollRestoration = "manual";
}

window.addEventListener("popstate", event => {
  const targetViewId = getHistoryViewId(event.state) || ROOT_VIEW_ID;
  activateView(targetViewId, {historyMode: "none"});
});

const money = n => new Intl.NumberFormat("he-IL", {
  style:"currency", currency:"ILS", minimumFractionDigits:2, maximumFractionDigits:2
}).format(Number(n || 0));

const today = () => new Date().toISOString().slice(0,10);
const currentTime = () => {
  const now = new Date();
  return `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
};

function normalizeIncomeType(rawValue){
  const value = String(rawValue || "").trim();
  return value || Z_INCOME_TYPE_DEFAULT;
}

function addIncomeTypeSuggestion(rawValue){
  const value = normalizeIncomeType(rawValue);
  if(!value) return false;
  const beforeSize = incomeTypeSuggestions.size;
  incomeTypeSuggestions.set(value.toLowerCase(), value);
  return incomeTypeSuggestions.size !== beforeSize;
}

function getIncomeTypeSuggestions(){
  return Array.from(incomeTypeSuggestions.values())
    .sort((a, b) => a.localeCompare(b, "he"));
}

function renderIncomeTypeSuggestionsPanel(filterText = ""){
  const panel = $("zIncomeTypeSuggestions");
  const datalist = $("incomeTypeSuggestionsList");
  if(!panel) return;

  const normalizedFilter = String(filterText || "").trim().toLowerCase();
  const suggestions = getIncomeTypeSuggestions().filter(value => {
    if(!normalizedFilter) return true;
    return value.toLowerCase().includes(normalizedFilter);
  });

  if(datalist){
    datalist.innerHTML = suggestions.map(value => `<option value="${value.replace(/"/g, "&quot;")}"></option>`).join("");
  }

  if(!suggestions.length){
    panel.innerHTML = '';
    panel.classList.add("hidden");
    return;
  }

  panel.innerHTML = suggestions.map(value => `
    <button type="button" class="income-type-suggestion" role="option" data-income-type-suggestion="${value.replace(/"/g, "&quot;")}">${value}</button>
  `).join("");
  panel.classList.remove("hidden");
}

function openIncomeTypeSuggestions(){
  renderIncomeTypeSuggestionsPanel($("zIncomeType")?.value || "");
}

function closeIncomeTypeSuggestions(){
  const panel = $("zIncomeTypeSuggestions");
  if(!panel) return;
  panel.classList.add("hidden");
}

function bindIncomeTypeSuggestionInteractions(){
  const input = $("zIncomeType");
  const panel = $("zIncomeTypeSuggestions");
  if(!input || !panel) return;

  input.addEventListener("focus", openIncomeTypeSuggestions);
  input.addEventListener("click", openIncomeTypeSuggestions);
  input.addEventListener("input", () => renderIncomeTypeSuggestionsPanel(input.value));
  input.addEventListener("keydown", event => {
    if(event.key === "Escape"){
      closeIncomeTypeSuggestions();
    }
  });

  panel.addEventListener("mousedown", event => event.preventDefault());
  panel.addEventListener("click", event => {
    const button = event.target.closest("[data-income-type-suggestion]");
    if(!button) return;
    input.value = button.dataset.incomeTypeSuggestion || Z_INCOME_TYPE_DEFAULT;
    closeIncomeTypeSuggestions();
    input.focus();
  });

  document.addEventListener("click", event => {
    if(event.target === input || panel.contains(event.target)) return;
    closeIncomeTypeSuggestions();
  });
}

function normalizeIncomeSource(rawValue){
  return rawValue === NON_Z_INCOME_SOURCE ? NON_Z_INCOME_SOURCE : Z_REPORT_INCOME_SOURCE;
}

function isZReportIncomeSource(rawValue){
  return normalizeIncomeSource(rawValue) === Z_REPORT_INCOME_SOURCE;
}

const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`;
};
const monthEnd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(new Date(d.getFullYear(), d.getMonth()+1, 0).getDate()).padStart(2,"0")}`;
};

const currentYear = () => new Date().getFullYear();
const getSelectedYear = () => {
  const yearInput = $("selectedYear") || $("yearSelect");
  const year = yearInput && yearInput.value ? Number(yearInput.value) : NaN;
  return Number.isInteger(year) ? year : currentYear();
};

const yearStart = year => `${year}-01-01`;
const yearEnd = year => `${year}-12-31`;

async function fetchIncomeTotalInDateRange(fromDate, toDate){
  const {data, error} = await sb.from("daily_z_reports")
    .select("total_income_ils")
    .eq("user_id", userId)
    .gte("report_date", fromDate)
    .lte("report_date", toDate);

  if(error){
    throw error;
  }

  return (data || []).reduce((sum, row) => sum + Number(row.total_income_ils || 0), 0);
}

const FIELD_ERROR_CLASS = "field-error-message";
const AUDITED_VALIDATION_FORM_IDS = ["loginForm","signupForm","expenseForm","zForm","businessForm"];

function setStatus(el,msg,type=""){
  if(!el) return;

  const statusType = type === "error" ? "error" : type === "ok" ? "ok" : "";
  el.className = `status ${statusType}`.trim();

  if(statusType === "error"){
    el.setAttribute("role","alert");
    el.setAttribute("aria-live","assertive");
  } else {
    el.setAttribute("role","status");
    el.setAttribute("aria-live","polite");
  }

  el.setAttribute("aria-atomic","true");
  el.textContent = msg || "";
}

function showToast(message, type = "ok", durationMs = 2600){
  const toast = $("appToast");
  if(!toast || !message) return;

  toast.className = `app-toast ${type === "error" ? "error" : "ok"}`;
  toast.textContent = message;

  if(toastHideTimer){
    clearTimeout(toastHideTimer);
  }

  toastHideTimer = setTimeout(() => {
    toast.classList.add("hidden");
    toast.textContent = "";
    toastHideTimer = null;
  }, durationMs);
}

function hasUnfinishedManualGroupingWork(){
  return Boolean(pendingGroupingAnalysisResult && !isManualGroupingConfirming);
}

function confirmManualGroupingDiscard(){
  if(!hasUnfinishedManualGroupingWork()) return true;
  return window.confirm("הקיבוץ הידני לא נשמר עדיין. יציאה עכשיו תבטל את העבודה שלא הושלמה. להמשיך ולצאת?");
}

function updateExpensePendingCountIndicator(count){
  const safeCount = Number.isInteger(count) && count > 0 ? count : 0;
  document.querySelectorAll('[data-action="expense"]').forEach(button => {
    let badge = button.querySelector('.pending-count-badge');
    if(!badge){
      badge = document.createElement("span");
      badge.className = "pending-count-badge hidden";
      button.appendChild(badge);
    }

    if(!safeCount){
      badge.classList.add("hidden");
      badge.textContent = "";
      return;
    }

    badge.textContent = String(safeCount);
    badge.classList.remove("hidden");
  });
}

async function loadPendingInvoiceCount(){
  if(!sb || !userId) return 0;

  const {count, error} = await sb.from("invoice_scan_items")
    .select("id", {count:"exact", head:true})
    .eq("user_id", userId)
    .is("saved_expense_id", null);

  if(error){
    throw new Error(error.message || "שגיאה בטעינת מונה חשבוניות ממתינות");
  }

  return Number(count || 0);
}

async function refreshPendingInvoiceCountIndicator(){
  try {
    const count = await loadPendingInvoiceCount();
    updateExpensePendingCountIndicator(count);
    return count;
  } catch(error){
    console.error(error);
    return 0;
  }
}

function hideExpensePendingChoice(){
  const section = $("expensePendingChoice");
  const summary = $("expensePendingChoiceSummary");
  if(!section || !summary) return;

  section.classList.add("hidden");
  summary.textContent = "";
}

function setExpenseDialogPrimaryState(state){
  const dialog = $("expenseDialog");
  if(!dialog) return;

  currentExpenseDialogPrimaryState = state;
  if(state !== EXPENSE_DIALOG_PRIMARY_STATES.EXTRACTED_FORM){
    expenseExtractedPreviewLoadToken += 1;
  }

  const title = $("expenseDialogTitle");

  const fileActions = dialog.querySelector(".file-actions");
  const filePreview = $("expenseFilePreview");
  const expenseActions = dialog.querySelector(".expense-actions");
  const extractedPreview = $("expenseExtractedPreview");
  const analyzeButton = $("analyzeButton");
  const queueButton = $("queueButton");
  const expenseForm = $("expenseForm");
  const pendingChoice = $("expensePendingChoice");
  const groupingGate = $("expenseGroupingGate");
  const manualWorkspace = $("expenseManualGroupingWorkspace");
  const reviewList = $("expenseReviewList");
  const reviewContext = $("expenseReviewContext");
  const reviewNav = $("expenseReviewPosition")?.closest(".review-item-nav");

  [
    fileActions,
    filePreview,
    expenseActions,
    extractedPreview,
    expenseForm,
    pendingChoice,
    groupingGate,
    manualWorkspace,
    reviewList,
    reviewContext,
    reviewNav
  ].forEach(section => section?.classList.add("hidden"));

  setStatus($("expenseStatus"), "", "");

  if(analyzeButton){
    analyzeButton.classList.remove("hidden");
    analyzeButton.disabled = false;
  }

  if(queueButton){
    queueButton.classList.remove("hidden");
  }

  if(title){
    const titleByState = {
      [EXPENSE_DIALOG_PRIMARY_STATES.UPLOAD]: "הוצאה חדשה",
      [EXPENSE_DIALOG_PRIMARY_STATES.PENDING_CHOICE]: "הוצאה חדשה",
      [EXPENSE_DIALOG_PRIMARY_STATES.PENDING_REVIEW_LIST]: "חשבוניות בבדיקה",
      [EXPENSE_DIALOG_PRIMARY_STATES.REVIEW_CONTEXT]: "בדיקת חשבונית",
      [EXPENSE_DIALOG_PRIMARY_STATES.MANUAL_GROUPING]: "הוצאה חדשה",
      [EXPENSE_DIALOG_PRIMARY_STATES.EXTRACTED_FORM]: "הוצאה חדשה"
    };

    title.textContent = titleByState[state] || "הוצאה חדשה";
  }

  switch(state){
    case EXPENSE_DIALOG_PRIMARY_STATES.UPLOAD:
      fileActions?.classList.remove("hidden");
      filePreview?.classList.remove("hidden");
      expenseActions?.classList.remove("hidden");
      break;
    case EXPENSE_DIALOG_PRIMARY_STATES.PENDING_CHOICE:
      pendingChoice?.classList.remove("hidden");
      break;
    case EXPENSE_DIALOG_PRIMARY_STATES.PENDING_REVIEW_LIST:
      reviewList?.classList.remove("hidden");
      break;
    case EXPENSE_DIALOG_PRIMARY_STATES.REVIEW_CONTEXT:
      reviewContext?.classList.remove("hidden");
      expenseForm?.classList.remove("hidden");
      reviewNav?.classList.remove("hidden");
      break;
    case EXPENSE_DIALOG_PRIMARY_STATES.MANUAL_GROUPING:
      groupingGate?.classList.remove("hidden");
      manualWorkspace?.classList.remove("hidden");
      break;
    case EXPENSE_DIALOG_PRIMARY_STATES.EXTRACTED_FORM:
      if(analyzeButton){
        analyzeButton.classList.add("hidden");
        analyzeButton.disabled = true;
      }
      extractedPreview?.classList.remove("hidden");
      expenseForm?.classList.remove("hidden");
      break;
    default:
      break;
  }

  updateExpenseContinueLaterButtonState();
}

function showExpensePendingChoice(pendingCount){
  const section = $("expensePendingChoice");
  const summary = $("expensePendingChoiceSummary");
  if(!section || !summary) return;

  summary.textContent = pendingCount === 1
    ? "יש חשבונית ממתינה אחת לבדיקה."
    : `יש ${pendingCount} חשבוניות ממתינות לבדיקה.`;

  section.classList.remove("hidden");
}

function getFieldErrorId(field){
  const base = field.id || field.name;
  if(!base) return "";
  const formId = field.form?.id || "form";
  return `${formId}-${base}-error`;
}

function isValidatableControl(field){
  return (
    (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)
    && field.willValidate
  );
}

function getValidatableFields(form){
  if(!form) return [];
  return Array.from(form.elements || []).filter(isValidatableControl);
}

function linkFieldDescription(field, descriptionId){
  if(!descriptionId) return;
  const tokens = new Set((field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
  tokens.add(descriptionId);
  field.setAttribute("aria-describedby", Array.from(tokens).join(" "));
}

function unlinkFieldDescription(field, descriptionId){
  if(!descriptionId) return;
  const tokens = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
  const next = tokens.filter(token => token !== descriptionId);
  if(next.length){
    field.setAttribute("aria-describedby", next.join(" "));
  } else {
    field.removeAttribute("aria-describedby");
  }
}

function ensureFieldErrorElement(field){
  const errorId = getFieldErrorId(field);
  if(!errorId) return null;

  let errorEl = $(errorId);
  if(!errorEl){
    errorEl = document.createElement("div");
    errorEl.id = errorId;
    errorEl.className = "status error " + FIELD_ERROR_CLASS;

    const host = field.closest("label") || field;
    host.insertAdjacentElement("afterend", errorEl);
  }

  return errorEl;
}

function setFieldInvalid(field, message){
  if(!field) return;

  const errorEl = ensureFieldErrorElement(field);
  const text = String(message || field.validationMessage || "ערך לא תקין").trim();

  field.setAttribute("aria-invalid", "true");

  if(errorEl){
    errorEl.textContent = text;
    linkFieldDescription(field, errorEl.id);
  }
}

function clearFieldInvalid(field){
  if(!field) return;

  field.removeAttribute("aria-invalid");

  const errorId = getFieldErrorId(field);
  if(!errorId) return;

  unlinkFieldDescription(field, errorId);
  const errorEl = $(errorId);
  if(errorEl){
    errorEl.remove();
  }
}

function clearFormFieldValidation(form){
  if(!form) return;
  getValidatableFields(form).forEach(clearFieldInvalid);
}

function setupFieldValidationAccessibility(){
  AUDITED_VALIDATION_FORM_IDS.forEach(formId => {
    const form = $(formId);
    if(!form) return;
    if(form.dataset.fieldValidationBound === "true") return;
    form.dataset.fieldValidationBound = "true";

    form.addEventListener("invalid", event => {
      const field = event.target;
      if(!isValidatableControl(field)) return;

      setFieldInvalid(field, field.validationMessage);

      if(form.dataset.invalidFocusHandled !== "true"){
        form.dataset.invalidFocusHandled = "true";
        requestAnimationFrame(() => field.focus());
        setTimeout(() => {
          form.dataset.invalidFocusHandled = "false";
        }, 0);
      }
    }, true);

    const clearOnValid = event => {
      const field = event.target;
      if(!isValidatableControl(field)) return;
      if(field.validity.valid){
        clearFieldInvalid(field);
      }
    };

    form.addEventListener("input", clearOnValid, true);
    form.addEventListener("change", clearOnValid, true);
  });
}

function getFileKey(file){ return `${file.name}-${file.size}-${file.lastModified}`; }

function getScanOperationId(){
  if(window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `scan-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getOrCreateScanOperationId(selectionSignature){
  if(!selectionSignature){
    throw new Error("חסר מזהה תוכן לקבצי הסריקה");
  }

  if(!currentScanOperationId || currentScanSelectionSignature !== selectionSignature){
    currentScanOperationId = getScanOperationId();
    currentScanSelectionSignature = selectionSignature;
  }

  return currentScanOperationId;
}

function resetScanOperationId(){
  currentScanOperationId = null;
  currentScanSelectionSignature = "";
}

function sanitizeStorageFilename(originalFilename){
  const rawName = String(originalFilename || "").trim();
  const stripped = rawName.replace(/[\\/]+/g, " ").normalize("NFKC");
  const lastDot = stripped.lastIndexOf(".");

  let baseName = lastDot > 0 ? stripped.slice(0, lastDot) : stripped;
  let extension = lastDot > 0 ? stripped.slice(lastDot) : "";

  const sanitizePart = value => value
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "");

  baseName = sanitizePart(baseName);
  extension = sanitizePart(extension);
  if(extension && !extension.startsWith(".")) extension = `.${extension}`;

  const safeName = `${baseName || "file"}${extension}`;
  return safeName || "file";
}

function buildScanStoragePath(operationId, uploadIndex, sha256, originalFilename){
  if(!sha256){
    throw new Error("לא ניתן לחשב מזהה תוכן לקובץ הסריקה");
  }

  const orderPrefix = String(uploadIndex + 1).padStart(3, "0");
  const safeFilename = sanitizeStorageFilename(originalFilename);
  return {
    safeFilename,
    storagePath: `${userId}/scans/${operationId}/${orderPrefix}-${sha256}`
  };
}

function isStorageObjectAlreadyExistsError(error){
  const statusCode = String(error?.statusCode || error?.status || "").trim();
  const message = String(error?.message || "").trim().toLowerCase();

  return statusCode === "409"
    || message.includes("already exists")
    || message.includes("duplicate");
}

async function cleanupUploadedScanFiles(paths){
  if(!paths.length) return;

  const {error} = await sb.storage
    .from("invoice-documents")
    .remove(paths);

  if(error){
    console.warn("Failed to clean up incomplete scan uploads", error);
  }
}

function getPendingExpenseStorageCleanupPaths(){
  try {
    const raw = localStorage.getItem(EXPENSE_STORAGE_CLEANUP_QUEUE_KEY);
    if(!raw) return [];

    const parsed = JSON.parse(raw);
    if(!Array.isArray(parsed)) return [];

    return parsed
      .map(path => String(path || "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function setPendingExpenseStorageCleanupPaths(paths){
  const normalized = Array.from(new Set((Array.isArray(paths) ? paths : [])
    .map(path => String(path || "").trim())
    .filter(Boolean)));

  try {
    if(!normalized.length){
      localStorage.removeItem(EXPENSE_STORAGE_CLEANUP_QUEUE_KEY);
      return;
    }

    localStorage.setItem(EXPENSE_STORAGE_CLEANUP_QUEUE_KEY, JSON.stringify(normalized));
  } catch {}
}

function enqueuePendingExpenseStorageCleanup(paths){
  const currentPaths = getPendingExpenseStorageCleanupPaths();
  setPendingExpenseStorageCleanupPaths(currentPaths.concat(paths || []));
}

async function cleanupUploadedExpenseFiles(paths){
  if(!Array.isArray(paths) || !paths.length) return null;
  const {error} = await sb.storage.from("invoice-documents").remove(paths);
  return error || null;
}

async function flushPendingExpenseStorageCleanup(){
  if(!sb || !userId) return;

  const pendingPaths = getPendingExpenseStorageCleanupPaths();
  if(!pendingPaths.length) return;

  const cleanupError = await cleanupUploadedExpenseFiles(pendingPaths);
  if(cleanupError){
    console.warn("Failed to flush pending expense storage cleanup", cleanupError);
    return;
  }

  setPendingExpenseStorageCleanupPaths([]);
}

async function computeFileSha256(file){
  if(!window.crypto?.subtle){
    return null;
  }

  try {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(byte => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

async function getCachedFileSha256(file){
  if(!fileSha256Cache.has(file)){
    fileSha256Cache.set(file, computeFileSha256(file));
  }

  const sha256 = await fileSha256Cache.get(file);
  if(!sha256){
    fileSha256Cache.delete(file);
  }

  return sha256;
}

async function buildFileSelectionSignature(files){
  const parts = [];

  for(const file of files){
    const sha256 = await getCachedFileSha256(file);
    if(!sha256){
      throw new Error("לא ניתן לחשב SHA-256 לקובץ הסריקה");
    }

    parts.push(sha256);
  }

  return parts.join("||");
}

function clearLocalFileObjectUrls(){
  for(const url of localFileObjectUrls.values()){
    if(url.startsWith("blob:")) URL.revokeObjectURL(url);
  }

  localFileObjectUrls.clear();
}

function clearLocalFileObjectUrl(file){
  if(!(file instanceof File)) return;

  const url = localFileObjectUrls.get(file);
  if(!url) return;

  if(url.startsWith("blob:")) URL.revokeObjectURL(url);
  localFileObjectUrls.delete(file);
}

function clearCurrentManualGroupingPreviewUrl(){
  if(currentManualGroupingPreviewUrl && currentManualGroupingPreviewUrl.startsWith("blob:")){
    URL.revokeObjectURL(currentManualGroupingPreviewUrl);
  }

  currentManualGroupingPreviewUrl = null;
}

function getLocalFileObjectUrl(file){
  if(!(file instanceof File)) return null;

  if(!localFileObjectUrls.has(file)){
    localFileObjectUrls.set(file, URL.createObjectURL(file));
  }

  return localFileObjectUrls.get(file) || null;
}

function clearZSignedUrlCache(){
  zDocumentsSignedUrlCache.clear();
}

function clearSelectedZFileObjectUrls(){
  selectedZFiles.forEach(file => clearLocalFileObjectUrl(file));
}

function sanitizeStoragePathSegment(raw){
  const normalized = String(raw || "").trim().replace(/[\\/]+/g, " ").normalize("NFKC");
  const safe = normalized
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "");
  return safe || "item";
}

function buildZReportStoragePath(zReportId, order, originalFilename){
  const safeReportId = sanitizeStoragePathSegment(zReportId);
  const safeFilename = sanitizeStorageFilename(originalFilename || "file");
  const orderPrefix = String(order).padStart(3, "0");
  return `${userId}/z-reports/${safeReportId}/${orderPrefix}-${safeFilename}`;
}

function renderSelectedZFiles(){
  const preview = $("zFilePreview");
  if(!preview) return;

  if(!selectedZFiles.length){
    preview.innerHTML = '<div class="file-preview-empty">לא נבחרו מסמכים.</div>';
    return;
  }

  preview.innerHTML = "";

  selectedZFiles.forEach((file, index) => {
    const fileName = file.name || "קובץ";
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(fileName);

    const item = document.createElement("div");
    item.className = "file-preview-item";
    item.dataset.zFileIndex = String(index);

    const card = document.createElement("div");
    card.className = `file-preview-card ${isPdf ? "pdf" : "image"}`;

    if(isPdf){
      const icon = document.createElement("div");
      icon.className = "file-preview-icon";
      icon.textContent = "PDF";
      card.appendChild(icon);
    } else {
      const image = document.createElement("img");
      image.src = getLocalFileObjectUrl(file) || "";
      image.alt = fileName;
      card.appendChild(image);
    }

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "file-remove";
    removeButton.dataset.zRemoveIndex = String(index);
    removeButton.setAttribute("aria-label", "הסרת מסמך");
    removeButton.textContent = "✕";
    removeButton.onclick = () => {
      const targetIndex = Number(removeButton.dataset.zRemoveIndex);
      if(!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= selectedZFiles.length) return;
      clearLocalFileObjectUrl(selectedZFiles[targetIndex]);
      selectedZFiles.splice(targetIndex, 1);
      renderSelectedZFiles();
    };

    item.appendChild(card);
    item.appendChild(removeButton);
    preview.appendChild(item);
  });
}

function resetZFileSelection(){
  clearSelectedZFileObjectUrls();
  selectedZFiles = [];
  if($("zBrowseInput")) $("zBrowseInput").value = "";
  renderSelectedZFiles();
}

function resetZDialogMode(){
  currentZReportEditId = "";
  currentZIncomeSource = Z_REPORT_INCOME_SOURCE;
  const submitButton = $("zForm")?.querySelector('button[type="submit"], button:not([type])');
  if(submitButton) submitButton.textContent = "שמרי הכנסה";
  const title = $("zDialogTitle");
  if(title) title.textContent = "הכנסה חדשה";
}

function setZDialogEditMode(report){
  currentZReportEditId = String(report?.id || "");
  currentZIncomeSource = normalizeIncomeSource(report?.income_source);
  const title = $("zDialogTitle");
  if(title) title.textContent = "עדכון הכנסה";
  const submitButton = $("zForm")?.querySelector('button[type="submit"], button:not([type])');
  if(submitButton) submitButton.textContent = "עדכני הכנסה";
}

function populateZDialogFromReport(report){
  const safeReport = report || {};
  $("zDate").value = safeReport.report_date || today();
  $("zTime").value = safeReport.report_time || currentTime();
  $("zTotal").value = safeReport.total_income_ils == null ? "" : Number(safeReport.total_income_ils || 0).toFixed(2);
  $("zIncomeType").value = normalizeIncomeType(safeReport.income_type);
  $("zProject").value = safeReport.project_id || "";
  $("zNotes").value = safeReport.notes || "";
}

function applyZDialogResetAndToast(successMessage = "הכנסה חדשה נשמרה"){
  shouldResetZFormAfterClose = false;
  pendingZSuccessToastMessage = "";
  resetZDialogMode();
  resetZFileSelection();
  $("zForm")?.reset();
  $("zDate").value = today();
  $("zTime").value = currentTime();
  $("zIncomeType").value = Z_INCOME_TYPE_DEFAULT;
  $("zNotes").value = "";
  closeIncomeTypeSuggestions();
  showToast(successMessage, "ok");
}

function queueZDialogResetAfterClose(successMessage = "הכנסה חדשה נשמרה"){
  shouldResetZFormAfterClose = true;
  pendingZSuccessToastMessage = successMessage;

  const dialog = $("zDialog");
  if(dialog?.open){
    dialog.close();
    return;
  }

  applyZDialogResetAndToast(successMessage);
}

function updateZFiles(input){
  const incoming = Array.from(input?.files || []);
  const existingKeys = new Set(selectedZFiles.map(file => getFileKey(file)));

  incoming.forEach(file => {
    const key = getFileKey(file);
    if(existingKeys.has(key)) return;
    selectedZFiles.push(file);
    existingKeys.add(key);
  });

  if(input) input.value = "";
  renderSelectedZFiles();
}

async function cleanupUploadedZReportFiles(paths){
  if(!Array.isArray(paths) || !paths.length) return null;
  const {error} = await sb.storage.from("invoice-documents").remove(paths);
  return error || null;
}

function buildPendingZReportUploadPlan(zReportId, files){
  const safeReportId = String(zReportId || "").trim();
  if(!safeReportId) return [];

  return (Array.isArray(files) ? files : []).map((file, index) => ({
    file,
    order: index + 1,
    storagePath: buildZReportStoragePath(safeReportId, index + 1, file?.name || "file")
  }));
}

async function uploadScanFilesBeforeAnalyze(files, operationId){
  const uploadedScanFiles = [];
  const createdStoragePaths = [];

  try {
    for(let uploadIndex = 0; uploadIndex < files.length; uploadIndex++){
      const file = files[uploadIndex];
      const sha256 = await getCachedFileSha256(file);
      if(!sha256){
        throw new Error("לא ניתן לחשב SHA-256 לקובץ הסריקה");
      }

      const {safeFilename, storagePath} = buildScanStoragePath(operationId, uploadIndex, sha256, file.name);
      const upload = await sb.storage
        .from("invoice-documents")
        .upload(storagePath, file, {contentType:file.type || "application/octet-stream", upsert:false});

      if(upload.error){
        if(!isStorageObjectAlreadyExistsError(upload.error)){
          console.error("defer_checkpoint_diagnostic", {
            stage: "storage_upload",
            operation_id: operationId,
            upload_index: uploadIndex,
            checkpointSecured: false,
            code: upload.error?.code || null,
            message: upload.error?.message || null,
            details: upload.error?.details || null,
            hint: upload.error?.hint || null,
            rawError: upload.error
          });

          const diagnosticError = new Error(upload.error.message || "שגיאה בהעלאת קובץ הסריקה");
          diagnosticError.diagnosticStage = "storage_upload";
          diagnosticError.diagnosticOperationId = operationId;
          diagnosticError.diagnosticCode = upload.error?.code || null;
          diagnosticError.diagnosticDetails = upload.error?.details || null;
          diagnosticError.diagnosticHint = upload.error?.hint || null;
          diagnosticError.diagnosticRawError = upload.error;
          throw diagnosticError;
        }
      } else {
        createdStoragePaths.push(storagePath);
      }

      uploadedScanFiles.push({
        upload_index: uploadIndex,
        storage_path: storagePath,
        original_filename: file.name,
        safe_filename: safeFilename,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        sha256,
        storage_metadata_version: 1
      });
    }
  } catch(error){
    await cleanupUploadedScanFiles(createdStoragePaths);
    throw error;
  }

  return uploadedScanFiles;
}

function buildCheckpointPayload({uploadedScanFiles, selectionSignature}){
  return {
    checkpoint_version: 1,
    selection_signature: selectionSignature,
    storage_metadata: {
      storage_metadata_version: 1,
      files: uploadedScanFiles
    }
  };
}

async function upsertDurableScanCheckpoint({operationId, extractionMode = "all", uploadedScanFiles, selectionSignature}){
  const checkpointPayload = buildCheckpointPayload({uploadedScanFiles, selectionSignature});

  const {error} = await sb.rpc("upsert_invoice_scan_batch_checkpoint", {
    p_operation_id: operationId,
    p_extraction_mode: extractionMode,
    p_checkpoint_payload: checkpointPayload
  });

  if(error){
    console.error("defer_checkpoint_diagnostic", {
      stage: "checkpoint_rpc",
      operation_id: operationId,
      checkpointSecured: false,
      code: error?.code || null,
      message: error?.message || null,
      details: error?.details || null,
      hint: error?.hint || null,
      rawError: error
    });

    const diagnosticError = new Error(error.message || "שגיאה בשמירת טיוטת המסמכים");
    diagnosticError.diagnosticStage = "checkpoint_rpc";
    diagnosticError.diagnosticOperationId = operationId;
    diagnosticError.diagnosticCode = error?.code || null;
    diagnosticError.diagnosticDetails = error?.details || null;
    diagnosticError.diagnosticHint = error?.hint || null;
    diagnosticError.diagnosticRawError = error;
    throw diagnosticError;
  }

  return checkpointPayload;
}

async function markCheckpointTerminalFailure(operationId, message){
  if(!operationId) return;
  const {error} = await sb.rpc("mark_invoice_scan_batch_checkpoint_failed", {
    p_operation_id: operationId,
    p_last_error: String(message || "").trim()
  });

  if(error){
    console.error(error);
  }
}

async function listRecoverableCheckpoints(limit = 5){
  const {data, error} = await sb.rpc("list_recoverable_invoice_scan_batches", {
    p_limit: limit
  });

  if(error){
    throw new Error(error.message || "שגיאה בטעינת טיוטות מסמכים");
  }

  return Array.isArray(data) ? data : [];
}

function getCheckpointStorageFiles(checkpoint){
  const files = checkpoint?.checkpoint_payload?.storage_metadata?.files;
  if(!Array.isArray(files) || !files.length) return [];
  return files
    .filter(file => file && Number.isInteger(file.upload_index) && file.storage_path)
    .sort((a,b) => a.upload_index - b.upload_index);
}

async function buildFilesFromCheckpoint(checkpoint){
  const storageFiles = getCheckpointStorageFiles(checkpoint);
  if(!storageFiles.length){
    throw new Error("טיוטת המסמכים אינה מכילה קבצים לשחזור");
  }

  const files = [];
  for(const fileMeta of storageFiles){
    const {data, error} = await sb.storage
      .from("invoice-documents")
      .download(fileMeta.storage_path);

    if(error || !data){
      throw new Error(error?.message || "שגיאה בשחזור קובץ מהטיוטה");
    }

    const fileName = String(fileMeta.original_filename || `scan-${fileMeta.upload_index + 1}`).trim() || `scan-${fileMeta.upload_index + 1}`;
    const mimeType = String(fileMeta.mime_type || "application/octet-stream");
    files.push(new File([data], fileName, {type: mimeType}));
  }

  return files;
}

function normalizeMultipleInvoicesFlag(value){
  if(value === true) return true;
  if(typeof value === "string" && value.trim().toLowerCase() === "true") return true;
  return false;
}

function normalizeGroupingConfidence(value){
  const confidence = Number(value);
  if(!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return 0;
  return confidence;
}

function isLowConfidenceGroupingResult(result){
  if(!normalizeMultipleInvoicesFlag(result?.multiple_invoices)) return false;
  return normalizeGroupingConfidence(result?.grouping_confidence) < GROUPING_CONFIDENCE_THRESHOLD;
}

function createEmptySingleInvoiceExtractedData(){
  return {
    supplier: "",
    supplier_registration_number: "",
    document_number: "",
    document_date: "",
    description: "",
    gross_original: 0,
    currency_code: "ILS",
    suggested_category: "",
    suggested_accounting_type: ""
  };
}

function buildScanBatchRpcInput(extractionResult, {singleItemExtractedData = null} = {}){
  const operation = extractionResult && extractionResult._operation;
  const pageManifest = operation && operation.page_manifest;
  const storageMetadata = operation && operation.storage_metadata;
  const operationId = String(operation && operation.id || "").trim();

  if(!operationId) return null;

  if(!pageManifest || !Array.isArray(pageManifest.pages) || !Array.isArray(pageManifest.uploads)){
    return null;
  }

  if(!storageMetadata || !Array.isArray(storageMetadata.files)){
    return null;
  }

  const uploadByIndex = new Map();
  pageManifest.uploads.forEach(upload => {
    if(upload && Number.isInteger(upload.upload_index)){
      uploadByIndex.set(upload.upload_index, upload);
    }
  });

  const storageByIndex = new Map();
  storageMetadata.files.forEach(file => {
    if(file && Number.isInteger(file.upload_index)){
      storageByIndex.set(file.upload_index, file);
    }
  });

  const pages = [];
  for(const page of pageManifest.pages){
    if(!page || !Number.isInteger(page.upload_index)) return null;

    const storageFile = storageByIndex.get(page.upload_index);
    const uploadMeta = uploadByIndex.get(page.upload_index);

    if(!storageFile || !storageFile.storage_path) return null;

    const pageId = String(page.page_id || "").trim();
    const globalPageIndex = Number(page.global_page_index);
    const pageNumber = Number(page.page_number_in_upload);
    const uploadIndex = Number(page.upload_index);

    if(!pageId || !Number.isInteger(globalPageIndex) || globalPageIndex <= 0) return null;
    if(!Number.isInteger(uploadIndex) || uploadIndex < 0) return null;
    if(!Number.isInteger(pageNumber) || pageNumber <= 0) return null;

    const sha256 = storageFile.sha256 || uploadMeta?.sha256 || null;

    pages.push({
      page_id: pageId,
      upload_index: uploadIndex,
      global_page_index: globalPageIndex,
      sha256,
      storage_path: storageFile.storage_path,
      original_filename: storageFile.original_filename || uploadMeta?.filename || "",
      mime_type: storageFile.mime_type || uploadMeta?.mime_type || "application/octet-stream",
      page_number: pageNumber
    });
  }

  pages.sort((a,b) => a.global_page_index - b.global_page_index);
  if(!pages.length) return null;

  const isGroupedMultiInvoice = normalizeMultipleInvoicesFlag(extractionResult?.multiple_invoices);

  if(isGroupedMultiInvoice){
    const groupedInvoices = extractionResult?.grouped_invoices;
    if(!Array.isArray(groupedInvoices) || !groupedInvoices.length){
      return null;
    }

    const pageByGlobalIndex = new Map();
    for(const page of pages){
      if(pageByGlobalIndex.has(page.global_page_index)) return null;
      pageByGlobalIndex.set(page.global_page_index, page);
    }

    const usedGlobalIndexes = new Set();
    const groupedItems = [];

    for(let groupIndex = 0; groupIndex < groupedInvoices.length; groupIndex++){
      const group = groupedInvoices[groupIndex];
      if(!group || typeof group !== "object") return null;

      const extractedData = sanitizeSingleInvoiceResult({
        multiple_invoices: false,
        ...group
      });
      if(!extractedData) return null;

      const rawIndexes = group.global_page_indexes;
      if(!Array.isArray(rawIndexes) || !rawIndexes.length) return null;

      const groupPages = [];
      const groupSeen = new Set();

      for(const rawIndex of rawIndexes){
        const globalIndex = Number(rawIndex);
        if(!Number.isInteger(globalIndex) || globalIndex <= 0) return null;
        if(groupSeen.has(globalIndex)) return null;
        if(usedGlobalIndexes.has(globalIndex)) return null;

        const page = pageByGlobalIndex.get(globalIndex);
        if(!page) return null;

        groupSeen.add(globalIndex);
        usedGlobalIndexes.add(globalIndex);
        groupPages.push(page);
      }

      groupPages.sort((a,b) => a.global_page_index - b.global_page_index);
      if(!groupPages.length) return null;

      groupedItems.push({
        source_group_index: groupIndex,
        min_global_page_index: groupPages[0].global_page_index,
        extracted_data: extractedData,
        pages: groupPages
      });
    }

    if(usedGlobalIndexes.size !== pages.length) return null;

    groupedItems.sort((a,b) => {
      if(a.min_global_page_index !== b.min_global_page_index){
        return a.min_global_page_index - b.min_global_page_index;
      }
      return a.source_group_index - b.source_group_index;
    });

    return {
      p_operation_id: operationId,
      p_extraction_mode: "all",
      p_items: groupedItems.map((item,index) => ({
        item_order: index + 1,
        selected_for_extraction: true,
        extracted_data: item.extracted_data,
        pages: item.pages
      }))
    };
  }

  return {
    p_operation_id: operationId,
    p_extraction_mode: "all",
    p_items: [
      {
        item_order: 1,
        selected_for_extraction: true,
        ...(singleItemExtractedData ? {extracted_data: singleItemExtractedData} : {}),
        pages
      }
    ]
  };
}

function buildFallbackSingleInvoiceExtractionResult(fallbackPersistence){
  if(!fallbackPersistence || typeof fallbackPersistence !== "object") return null;

  const operationId = String(fallbackPersistence.operation_id || "").trim();
  const storageMetadata = fallbackPersistence.storage_metadata;
  const pageManifest = fallbackPersistence.page_manifest;

  if(!operationId) return null;
  if(!storageMetadata || !Array.isArray(storageMetadata.files) || !storageMetadata.files.length) return null;
  if(!pageManifest || !Array.isArray(pageManifest.pages) || !pageManifest.pages.length) return null;
  if(!Array.isArray(pageManifest.uploads) || !pageManifest.uploads.length) return null;

  const safeExtractedData = sanitizeSingleInvoiceResult({
    multiple_invoices: false,
    ...(fallbackPersistence.default_extracted_data || {})
  }) || createEmptySingleInvoiceExtractedData();

  return {
    multiple_invoices: false,
    ...safeExtractedData,
    _operation: {
      id: operationId,
      storage_metadata: storageMetadata,
      page_manifest: pageManifest
    }
  };
}

async function tryPersistSingleInvoiceFallbackFromFailure(result, {openReviewList = true} = {}){
  const fallbackResult = buildFallbackSingleInvoiceExtractionResult(result?.fallback_persistence);
  if(!fallbackResult) return false;

  const safeExtractedData = sanitizeSingleInvoiceResult(fallbackResult) || createEmptySingleInvoiceExtractedData();
  const rpcInput = buildScanBatchRpcInput(fallbackResult, {singleItemExtractedData: safeExtractedData});
  if(!rpcInput) return false;

  const {data:batchResult, error:batchError} = await sb.rpc(
    "persist_invoice_scan_batch_atomic",
    rpcInput
  );

  if(batchError){
    throw new Error(batchError.message || "שגיאה בשמירת החשבונית לבדיקה מאוחרת");
  }

  const batchRow = Array.isArray(batchResult) ? batchResult[0] : batchResult;
  if(!batchRow || !batchRow.batch_id){
    throw new Error("תשובת שמירת הסריקה אינה תקינה");
  }

  clearPendingGroupingAnalysisResult();
  activeExpenseReviewContext = null;
  canDeferSingleExtractedInvoice = false;
  if(openReviewList){
    const reviewRows = await loadPendingReviewRows();
    renderExpenseReviewList(reviewRows);
  }
  void refreshPendingInvoiceCountIndicator();
  setStatus($("expenseStatus"), "החילוץ נכשל, אך המסמך נשמר לבדיקה מאוחרת בתור הממתין.", "ok");
  return true;
}

function sanitizeSingleInvoiceResult(result){
  if(!result || typeof result !== "object") return null;
  if(normalizeMultipleInvoicesFlag(result.multiple_invoices)) return null;

  const asText = value => String(value || "").trim();
  const asNumber = value => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  const rawDate = asText(result.document_date);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : "";

  const rawCurrency = asText(result.currency_code).toUpperCase();
  const currency = ["ILS","USD","EUR","GBP"].includes(rawCurrency)
    ? rawCurrency
    : "ILS";

  const grossOriginal = asNumber(result.gross_original);

  return {
    supplier:asText(result.supplier),
    supplier_registration_number:asText(result.supplier_registration_number),
    document_number:asText(result.document_number),
    document_date:validDate,
    description:asText(result.description),
    gross_original:grossOriginal,
    currency_code:currency,
    suggested_category:asText(result.suggested_category),
    suggested_accounting_type:asText(result.suggested_accounting_type)
  };
}

function formatReviewCaptureDateTime(value){
  if(!value) return {capturedDate:"", capturedTime:""};

  const date = new Date(value);
  if(Number.isNaN(date.getTime())) return {capturedDate:"", capturedTime:""};

  return {
    capturedDate: new Intl.DateTimeFormat("he-IL", {
      dateStyle:"short"
    }).format(date),
    capturedTime: new Intl.DateTimeFormat("he-IL", {
      timeStyle:"short"
    }).format(date)
  };
}

function describeGlobalPageIndexes(globalPageIndexes){
  const sortedIndexes = Array.from(new Set(
    (Array.isArray(globalPageIndexes) ? globalPageIndexes : [])
      .map(value => Number(value))
      .filter(value => Number.isInteger(value) && value > 0)
  )).sort((a,b) => a - b);

  if(!sortedIndexes.length) return "";

  const ranges = [];
  let start = sortedIndexes[0];
  let end = sortedIndexes[0];

  for(let index = 1; index < sortedIndexes.length; index++){
    const current = sortedIndexes[index];
    if(current === end + 1){
      end = current;
      continue;
    }

    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    start = current;
    end = current;
  }

  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return ranges.join(", ");
}

function createGlobalPageSignature(globalPageIndexes){
  return Array.from(new Set(
    (Array.isArray(globalPageIndexes) ? globalPageIndexes : [])
      .map(value => Number(value))
      .filter(value => Number.isInteger(value) && value > 0)
  )).sort((a,b) => a - b).join(",");
}

function createManualGroupingDraft(result){
  const pageManifest = result?._operation?.page_manifest;
  const pageManifestPages = Array.isArray(pageManifest?.pages) ? pageManifest.pages : [];
  if(!pageManifestPages.length) return null;

  const uploadByIndex = new Map();
  (Array.isArray(pageManifest?.uploads) ? pageManifest.uploads : []).forEach(upload => {
    if(upload && Number.isInteger(upload.upload_index)){
      uploadByIndex.set(upload.upload_index, upload);
    }
  });

  const storageByIndex = new Map();
  (Array.isArray(result?._operation?.storage_metadata?.files) ? result._operation.storage_metadata.files : []).forEach(file => {
    if(file && Number.isInteger(file.upload_index)){
      storageByIndex.set(file.upload_index, file);
    }
  });

  const pages = [];
  for(const rawPage of pageManifestPages){
    const uploadIndex = Number(rawPage?.upload_index);
    const globalPageIndex = Number(rawPage?.global_page_index);
    const pageNumberInUpload = Number(rawPage?.page_number_in_upload);

    if(!Number.isInteger(uploadIndex) || uploadIndex < 0) continue;
    if(!Number.isInteger(globalPageIndex) || globalPageIndex <= 0) continue;
    if(!Number.isInteger(pageNumberInUpload) || pageNumberInUpload <= 0) continue;

    const uploadMeta = uploadByIndex.get(uploadIndex) || null;
    const storageMeta = storageByIndex.get(uploadIndex) || null;

    pages.push({
      pageId: String(rawPage?.page_id || "").trim(),
      globalPageIndex,
      uploadIndex,
      pageNumberInUpload,
      originalFilename: storageMeta?.original_filename || uploadMeta?.filename || `קובץ ${uploadIndex + 1}`,
      mimeType: storageMeta?.mime_type || uploadMeta?.mime_type || "application/octet-stream"
    });
  }

  pages.sort((a,b) => a.globalPageIndex - b.globalPageIndex);
  if(!pages.length) return null;

  const availablePageIndexes = new Set(pages.map(page => page.globalPageIndex));
  const assignments = {};
  const assignedPageIndexes = new Set();
  let nextGroupId = 1;

  const proposedGroups = Array.isArray(result?.grouped_invoices) ? result.grouped_invoices : [];
  proposedGroups.forEach(group => {
    const validIndexes = Array.from(new Set(
      (Array.isArray(group?.global_page_indexes) ? group.global_page_indexes : [])
        .map(value => Number(value))
        .filter(value => Number.isInteger(value) && value > 0 && availablePageIndexes.has(value) && !assignedPageIndexes.has(value))
    )).sort((a,b) => a - b);

    if(!validIndexes.length) return;

    const groupId = nextGroupId;
    nextGroupId += 1;
    validIndexes.forEach(globalPageIndex => {
      assignments[globalPageIndex] = groupId;
      assignedPageIndexes.add(globalPageIndex);
    });
  });

  pages.forEach(page => {
    if(assignedPageIndexes.has(page.globalPageIndex)) return;
    assignments[page.globalPageIndex] = nextGroupId;
    nextGroupId += 1;
  });

  return {
    pages,
    assignments,
    selectedPageGlobalIndex: pages[0].globalPageIndex,
    nextGroupId
  };
}

function getManualGroupingDraftGroups(draft){
  if(!draft || !Array.isArray(draft.pages)) return [];

  const pagesByGroupId = new Map();
  draft.pages.forEach(page => {
    const groupId = Number(draft.assignments?.[page.globalPageIndex]);
    if(!Number.isInteger(groupId) || groupId <= 0) return;

    if(!pagesByGroupId.has(groupId)){
      pagesByGroupId.set(groupId, []);
    }

    pagesByGroupId.get(groupId).push(page);
  });

  return Array.from(pagesByGroupId.entries())
    .map(([groupId, groupPages]) => {
      const pages = groupPages.slice().sort((a,b) => a.globalPageIndex - b.globalPageIndex);
      return {
        groupId,
        pages,
        pageIndexes: pages.map(page => page.globalPageIndex),
        signature: createGlobalPageSignature(pages.map(page => page.globalPageIndex)),
        minGlobalPageIndex: pages[0]?.globalPageIndex || Number.MAX_SAFE_INTEGER
      };
    })
    .sort((a,b) => {
      if(a.minGlobalPageIndex !== b.minGlobalPageIndex){
        return a.minGlobalPageIndex - b.minGlobalPageIndex;
      }

      return a.groupId - b.groupId;
    });
}

function getManualGroupingSelectedPage(draft){
  if(!draft || !Array.isArray(draft.pages)) return null;

  return draft.pages.find(page => page.globalPageIndex === draft.selectedPageGlobalIndex)
    || draft.pages[0]
    || null;
}

function getOriginalGroupingLookup(result){
  const lookup = new Map();
  (Array.isArray(result?.grouped_invoices) ? result.grouped_invoices : []).forEach(group => {
    const signature = createGlobalPageSignature(group?.global_page_indexes);
    if(!signature || lookup.has(signature)) return;
    lookup.set(signature, group);
  });
  return lookup;
}

function getManualGroupingLabelByGroupId(groups){
  const labels = new Map();
  groups.forEach((group, index) => {
    labels.set(group.groupId, `חשבונית ${index + 1}`);
  });
  return labels;
}

function validateManualGroupingDraft(draft){
  if(!draft || !Array.isArray(draft.pages) || !draft.pages.length){
    return {isValid:false, error:"לא נמצאו עמודים לקיבוץ ידני.", groups:[]};
  }

  const groups = getManualGroupingDraftGroups(draft);
  if(!groups.length){
    return {isValid:false, error:"יש לשייך את כל העמודים לחשבוניות.", groups:[]};
  }

  const assignedPageIndexes = new Set();
  for(const group of groups){
    if(!group.pages.length){
      return {isValid:false, error:"לא ניתן לאשר קבוצה ריקה.", groups};
    }

    for(const page of group.pages){
      if(assignedPageIndexes.has(page.globalPageIndex)){
        return {isValid:false, error:"כל עמוד חייב להיות משויך פעם אחת בלבד.", groups};
      }

      assignedPageIndexes.add(page.globalPageIndex);
    }
  }

  if(assignedPageIndexes.size !== draft.pages.length){
    return {isValid:false, error:"יש לשייך כל עמוד לחשבונית אחת.", groups};
  }

  return {isValid:true, error:"", groups};
}

async function renderManualGroupingPagePreview(page){
  const preview = $("expenseManualGroupingPreview");
  if(!preview) return;

  manualGroupingPreviewToken += 1;
  const previewToken = manualGroupingPreviewToken;
  clearCurrentManualGroupingPreviewUrl();
  preview.innerHTML = "";
  if(!page){
    const text = document.createElement("p");
    text.className = "review-document-state";
    text.textContent = "בחרי עמוד להצגה.";
    preview.appendChild(text);
    return;
  }

  const file = selectedFiles[page.uploadIndex] || null;
  const fileUrl = getLocalFileObjectUrl(file);
  if(!fileUrl){
    const text = document.createElement("p");
    text.className = "review-document-state error";
    text.textContent = "לא ניתן להציג את הקובץ שנבחר לעמוד זה.";
    preview.appendChild(text);
    return;
  }

  const isImage = String(page.mimeType || "").toLowerCase().startsWith("image/");
  if(isImage){
    const image = document.createElement("img");
    image.src = fileUrl;
    image.alt = `עמוד ${page.globalPageIndex}`;
    preview.appendChild(image);
    return;
  }

  const loading = document.createElement("p");
  loading.className = "review-document-state";
  loading.textContent = "טוען את עמוד ה-PDF שנבחר...";
  preview.appendChild(loading);

  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("page_number_in_upload", String(page.pageNumberInUpload));

    const response = await fetch("/api/manual-grouping-pdf-preview", {
      method: "POST",
      body: formData
    });

    const pdfBlob = await response.blob();
    if(previewToken !== manualGroupingPreviewToken) return;

    if(!response.ok){
      let errorMessage = "לא ניתן להציג את עמוד ה-PDF שנבחר.";
      try {
        const errorPayload = JSON.parse(await pdfBlob.text());
        errorMessage = errorPayload?.detail || errorMessage;
      } catch {}
      throw new Error(errorMessage);
    }

    currentManualGroupingPreviewUrl = URL.createObjectURL(pdfBlob);
    preview.innerHTML = "";
    const frame = document.createElement("iframe");
    frame.src = currentManualGroupingPreviewUrl;
    frame.title = `עמוד ${page.globalPageIndex}`;
    frame.loading = "lazy";
    preview.appendChild(frame);
  } catch(error){
    if(previewToken !== manualGroupingPreviewToken) return;
    preview.innerHTML = "";
    const text = document.createElement("p");
    text.className = "review-document-state error";
    text.textContent = error?.message || "לא ניתן להציג את עמוד ה-PDF שנבחר.";
    preview.appendChild(text);
  }
}

function renderExpenseManualGroupingWorkspace(){
  const workspace = $("expenseManualGroupingWorkspace");
  const pageList = $("expenseManualGroupingPageList");
  const previewMeta = $("expenseManualGroupingSelectedPageMeta");
  const assignActions = $("expenseManualGroupingAssignActions");
  const groupsHost = $("expenseManualGroupingGroups");
  const confirmButton = $("expenseManualGroupingConfirm");
  if(!workspace || !pageList || !previewMeta || !assignActions || !groupsHost || !confirmButton) return;

  const result = pendingGroupingAnalysisResult;
  if(result && !pendingManualGroupingDraft){
    pendingManualGroupingDraft = createManualGroupingDraft(result);
  }

  const draft = pendingManualGroupingDraft;
  if(!result || !draft){
    workspace.classList.add("hidden");
    pageList.innerHTML = "";
    previewMeta.innerHTML = "";
    assignActions.innerHTML = "";
    groupsHost.innerHTML = "";
    confirmButton.disabled = true;
    renderManualGroupingPagePreview(null);
    return;
  }

  workspace.classList.remove("hidden");
  const groups = getManualGroupingDraftGroups(draft);
  const groupLabels = getManualGroupingLabelByGroupId(groups);
  const selectedPage = getManualGroupingSelectedPage(draft);
  if(selectedPage && draft.selectedPageGlobalIndex !== selectedPage.globalPageIndex){
    draft.selectedPageGlobalIndex = selectedPage.globalPageIndex;
  }

  pageList.innerHTML = "";
  draft.pages.forEach(page => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `grouping-manual-page-button${selectedPage?.globalPageIndex === page.globalPageIndex ? " active" : ""}`;
    button.disabled = isManualGroupingConfirming;
    button.onclick = () => {
      if(!pendingManualGroupingDraft || isManualGroupingConfirming) return;
      pendingManualGroupingDraft.selectedPageGlobalIndex = page.globalPageIndex;
      renderExpenseManualGroupingWorkspace();
    };

    const title = document.createElement("p");
    title.className = "grouping-manual-page-title";
    title.textContent = `עמוד ${page.globalPageIndex}`;
    button.appendChild(title);

    const groupLine = document.createElement("p");
    groupLine.className = "grouping-manual-page-line";
    groupLine.textContent = `שייך ל-${groupLabels.get(Number(draft.assignments?.[page.globalPageIndex])) || "לא משויך"}`;
    button.appendChild(groupLine);

    const fileLine = document.createElement("p");
    fileLine.className = "grouping-manual-page-line";
    fileLine.textContent = `${page.originalFilename} | עמוד בקובץ ${page.pageNumberInUpload}`;
    button.appendChild(fileLine);

    pageList.appendChild(button);
  });

  void renderManualGroupingPagePreview(selectedPage);
  previewMeta.innerHTML = "";
  if(selectedPage){
    [
      `עמוד גלובלי: ${selectedPage.globalPageIndex}`,
      `קובץ מקור: ${selectedPage.originalFilename}`,
      `עמוד בקובץ: ${selectedPage.pageNumberInUpload}`,
      `קבוצה נוכחית: ${groupLabels.get(Number(draft.assignments?.[selectedPage.globalPageIndex])) || "לא משויך"}`
    ].forEach(text => {
      const line = document.createElement("p");
      line.className = "grouping-manual-selected-line";
      line.textContent = text;
      previewMeta.appendChild(line);
    });
  }

  assignActions.innerHTML = "";
  const assignTitle = document.createElement("p");
  assignTitle.className = "grouping-manual-selected-line";
  assignTitle.textContent = "שיוך העמוד הנבחר:";
  assignActions.appendChild(assignTitle);

  const assignGrid = document.createElement("div");
  assignGrid.className = "grouping-manual-assign-grid";
  groups.forEach(group => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.disabled = !selectedPage || isManualGroupingConfirming;
    button.textContent = `העבירי אל ${groupLabels.get(group.groupId)}`;
    button.onclick = () => {
      if(!pendingManualGroupingDraft || !selectedPage || isManualGroupingConfirming) return;
      pendingManualGroupingDraft.assignments[selectedPage.globalPageIndex] = group.groupId;
      renderExpenseManualGroupingWorkspace();
    };
    assignGrid.appendChild(button);
  });

  const newGroupButton = document.createElement("button");
  newGroupButton.type = "button";
  newGroupButton.className = "secondary";
  newGroupButton.disabled = !selectedPage || isManualGroupingConfirming;
  newGroupButton.textContent = "חשבונית חדשה";
  newGroupButton.onclick = () => {
    if(!pendingManualGroupingDraft || !selectedPage || isManualGroupingConfirming) return;
    const newGroupId = pendingManualGroupingDraft.nextGroupId;
    pendingManualGroupingDraft.nextGroupId += 1;
    pendingManualGroupingDraft.assignments[selectedPage.globalPageIndex] = newGroupId;
    renderExpenseManualGroupingWorkspace();
  };
  assignGrid.appendChild(newGroupButton);
  assignActions.appendChild(assignGrid);

  const originalLookup = getOriginalGroupingLookup(result);
  groupsHost.innerHTML = "";
  groups.forEach(group => {
    const item = document.createElement("article");
    item.className = "grouping-manual-group-item";

    const title = document.createElement("p");
    title.className = "grouping-manual-group-title";
    title.textContent = groupLabels.get(group.groupId) || "חשבונית";
    item.appendChild(title);

    const pagesLine = document.createElement("p");
    pagesLine.className = "grouping-manual-group-line";
    pagesLine.textContent = `עמודים: ${describeGlobalPageIndexes(group.pageIndexes)}`;
    item.appendChild(pagesLine);

    const countLine = document.createElement("p");
    countLine.className = "grouping-manual-group-line";
    countLine.textContent = `מספר עמודים: ${group.pageIndexes.length}`;
    item.appendChild(countLine);

    const extractionLine = document.createElement("p");
    extractionLine.className = "grouping-manual-group-line";
    extractionLine.textContent = originalLookup.has(group.signature)
      ? "נתוני החשבונית הקיימים יישמרו לקבוצה זו."
      : "נתוני החשבונית יחולצו מחדש לקבוצה זו באישור.";
    item.appendChild(extractionLine);

    groupsHost.appendChild(item);
  });

  confirmButton.disabled = isManualGroupingConfirming;
  confirmButton.textContent = isManualGroupingConfirming
    ? "מחלצת נתונים וממשיכה לבדיקה..."
    : "אשרי קיבוץ והמשיכי לבדיקה";
}

function hideExpenseGroupingGate(){
  const section = $("expenseGroupingGate");
  const summary = $("expenseGroupingGateSummary");
  const workspace = $("expenseManualGroupingWorkspace");
  if(!section || !summary) return;

  section.classList.add("hidden");
  summary.innerHTML = "";
  if(workspace) workspace.classList.add("hidden");
}

function clearPendingGroupingAnalysisResult(){
  pendingGroupingAnalysisResult = null;
  pendingManualGroupingDraft = null;
  isManualGroupingConfirming = false;
  manualGroupingPreviewToken += 1;
  clearCurrentManualGroupingPreviewUrl();
  hideExpenseGroupingGate();
}

function renderExpenseGroupingGate(result){
  const section = $("expenseGroupingGate");
  const summary = $("expenseGroupingGateSummary");
  if(!section || !summary) return;

  setExpenseDialogPrimaryState(EXPENSE_DIALOG_PRIMARY_STATES.MANUAL_GROUPING);

  summary.innerHTML = "";

  const groups = Array.isArray(result?.grouped_invoices) ? result.grouped_invoices : [];
  if(groups.length){
    const list = document.createElement("div");
    list.className = "grouping-gate-summary-list";

    groups.forEach((group, index) => {
      const item = document.createElement("article");
      item.className = "grouping-gate-summary-item";

      const title = document.createElement("p");
      title.className = "grouping-gate-summary-title";
      title.textContent = `חשבונית ${index + 1}`;
      item.appendChild(title);

      const indexes = Array.isArray(group?.global_page_indexes)
        ? group.global_page_indexes.filter(value => Number.isInteger(Number(value)) && Number(value) > 0).map(value => Number(value))
        : [];

      const details = [];
      if(indexes.length){
        details.push(`עמודים: ${describeGlobalPageIndexes(indexes)}`);
        details.push(`מספר עמודים: ${indexes.length}`);
      }

      const supplier = String(group?.supplier || "").trim();
      if(supplier) details.push(`ספק: ${supplier}`);

      const documentNumber = String(group?.document_number || "").trim();
      if(documentNumber) details.push(`מספר חשבונית: ${documentNumber}`);

      const description = String(group?.description || "").trim();
      if(description) details.push(`תיאור: ${description}`);

      details.forEach(text => {
        const line = document.createElement("p");
        line.className = "grouping-gate-summary-line";
        line.textContent = text;
        item.appendChild(line);
      });

      list.appendChild(item);
    });

    summary.appendChild(list);
  }

  section.classList.remove("hidden");
  renderExpenseManualGroupingWorkspace();
}

function buildSelectedPagesJsonForManualGroup(group){
  const uploads = new Map();

  group.pages.forEach(page => {
    if(!uploads.has(page.uploadIndex)){
      uploads.set(page.uploadIndex, []);
    }

    uploads.get(page.uploadIndex).push(page.pageNumberInUpload);
  });

  return JSON.stringify({
    uploads: Array.from(uploads.entries())
      .sort((a,b) => a[0] - b[0])
      .map(([uploadIndex, pageNumbers]) => ({
        upload_index: uploadIndex,
        page_numbers_in_upload: Array.from(new Set(pageNumbers)).sort((a,b) => a - b)
      }))
  });
}

async function reextractManualGroupingGroup(group, groupPosition, totalGroups){
  const formData = new FormData();
  selectedFiles.forEach(file => formData.append("files", file));
  formData.append("document_type", "invoice");
  formData.append("contract_version", "1");
  formData.append("operation_source", "web");
  formData.append("selected_pages_json", buildSelectedPagesJsonForManualGroup(group));

  setStatus(
    $("expenseStatus"),
    `מחלצת נתונים לקבוצה ${groupPosition} מתוך ${totalGroups}...`,
    ""
  );

  const response = await fetch("/api/analyze-invoice", {
    method: "POST",
    body: formData
  });

  const result = await response.json();
  if(!response.ok){
    throw new Error(result?.detail || `שגיאה בחילוץ נתונים לקבוצה ${groupPosition}`);
  }

  if(normalizeMultipleInvoicesFlag(result?.multiple_invoices)){
    throw new Error(`בקבוצה ${groupPosition} זוהתה יותר מחשבונית אחת. עדכני את הקיבוץ ונסי שוב.`);
  }

  const invoiceData = sanitizeSingleInvoiceResult(result);
  if(!invoiceData){
    throw new Error(`מבנה תשובת החילוץ לקבוצה ${groupPosition} אינו תקין.`);
  }

  return invoiceData;
}

async function confirmManualGroupingAndContinue(){
  if(isManualGroupingConfirming) return;
  if(!pendingGroupingAnalysisResult || !pendingManualGroupingDraft){
    setStatus($("expenseStatus"), "לא נמצא קיבוץ ידני לאישור.", "error");
    return;
  }

  const validation = validateManualGroupingDraft(pendingManualGroupingDraft);
  if(!validation.isValid){
    setStatus($("expenseStatus"), validation.error || "קיבוץ העמודים אינו תקין.", "error");
    return;
  }

  isManualGroupingConfirming = true;
  renderExpenseManualGroupingWorkspace();

  try {
    const originalLookup = getOriginalGroupingLookup(pendingGroupingAnalysisResult);
    const extractedDataBySignature = new Map();

    for(let index = 0; index < validation.groups.length; index++){
      const group = validation.groups[index];
      if(originalLookup.has(group.signature)) continue;

      const extractedData = await reextractManualGroupingGroup(
        group,
        index + 1,
        validation.groups.length
      );
      extractedDataBySignature.set(group.signature, extractedData);
    }

    const groupedInvoices = validation.groups.map(group => {
      const originalGroup = originalLookup.get(group.signature);
      const extractedData = originalGroup
        ? sanitizeSingleInvoiceResult({multiple_invoices:false, ...originalGroup})
        : extractedDataBySignature.get(group.signature) || null;

      if(!extractedData){
        throw new Error("לא ניתן להשלים את נתוני החשבוניות לאחר הקיבוץ הידני.");
      }

      return {
        global_page_indexes: group.pageIndexes.slice(),
        ...extractedData
      };
    });

    const finalResult = {
      ...pendingGroupingAnalysisResult,
      multiple_invoices: true,
      grouped_invoices: groupedInvoices
    };

    const rpcInput = buildScanBatchRpcInput(finalResult);
    if(!rpcInput){
      throw new Error("מבנה הקיבוץ הידני אינו תקין לשמירה.");
    }

    const {data:batchResult, error:batchError} = await sb.rpc(
      "persist_invoice_scan_batch_atomic",
      rpcInput
    );

    if(batchError){
      throw new Error(batchError.message || "שגיאה בשמירת החשבוניות לאחר הקיבוץ הידני");
    }

    const batchRow = Array.isArray(batchResult) ? batchResult[0] : batchResult;
    if(!batchRow || !batchRow.batch_id){
      throw new Error("תשובת שמירת הסריקה אינה תקינה");
    }

    const reviewRows = await loadPendingReviewRows();
    clearPendingGroupingAnalysisResult();
    hideExpenseReviewContext();
    activeExpenseReviewContext = null;
    renderExpenseReviewList(reviewRows);
    void refreshPendingInvoiceCountIndicator();
    setStatus($("expenseStatus"), "הקיבוץ הידני נשמר. הוצגה רשימת חשבוניות לבדיקה.", "ok");
  } catch(error){
    console.error(error);
    setStatus(
      $("expenseStatus"),
      error?.message || "שגיאה בחילוץ הנתונים לאחר הקיבוץ הידני. לא נשמרו חשבוניות.",
      "error"
    );
  } finally {
    isManualGroupingConfirming = false;
    renderExpenseManualGroupingWorkspace();
  }
}

function hideExpenseReviewList(){
  const section = $("expenseReviewList");
  const tableHost = $("expenseReviewListTable");
  if(!section || !tableHost) return;

  section.classList.add("hidden");
  tableHost.innerHTML = "אין חשבוניות להצגה.";
  updateExpenseContinueLaterButtonState();
}

function updateExpenseContinueLaterButtonState(){
  const queueButton = $("queueButton");
  if(!queueButton) return;

  if(currentExpenseDialogPrimaryState === EXPENSE_DIALOG_PRIMARY_STATES.UPLOAD){
    queueButton.textContent = "חלץ ואבדוק מאוחר יותר";
    queueButton.disabled = selectedFiles.length === 0 || isDeferredAnalyzeInFlight;
    return;
  }

  queueButton.textContent = "אבדוק מאוחר יותר";

  if(currentExpenseDialogPrimaryState === EXPENSE_DIALOG_PRIMARY_STATES.EXTRACTED_FORM){
    queueButton.disabled = !canDeferSingleExtractedInvoice;
    return;
  }

  queueButton.disabled = expenseReviewRows.length === 0;
}

function hideExpenseReviewContext(){
  const section = $("expenseReviewContext");
  if(!section) return;

  section.classList.add("hidden");
  renderExpenseReviewDocumentState({message:"בחרי חשבונית להצגת המסמך."});
  updateExpenseReviewNavigation();
  updateExpenseContinueLaterButtonState();
}

function clearExpenseInvoiceDerivedFields(){
  $("expenseSupplier").value = "";
  $("expenseSupplierReg").value = "";
  $("expenseDocumentNumber").value = "";
  $("expenseDate").value = "";
  $("expenseDescription").value = "";
  $("expenseGross").value = "";
}

function fillExpenseFormFromInvoice(invoice){
  clearExpenseInvoiceDerivedFields();
  if(!invoice) return;

  $("expenseSupplier").value = invoice.supplier || "";
  $("expenseSupplierReg").value = invoice.supplier_registration_number || "";
  $("expenseDocumentNumber").value = invoice.document_number || "";
  $("expenseDate").value = invoice.document_date || "";
  $("expenseDescription").value = invoice.description || "";

  if(invoice.currency_code === "ILS"){
    $("expenseGross").value = invoice.gross_original || "";
  }
}

function renderExpenseExtractedPreviewState({message = "", isError = false} = {}){
  const section = $("expenseExtractedPreview");
  const panel = $("expenseExtractedPreviewPanel");
  if(!section || !panel) return;

  section.classList.remove("hidden");
  panel.classList.remove("preview-openable", "preview-overlay-openable");
  panel.removeAttribute("tabindex");
  panel.removeAttribute("role");
  panel.removeAttribute("aria-label");
  panel.removeAttribute("title");
  panel.onclick = null;
  panel.onkeydown = null;
  setCurrentExpenseReviewDocument(null);
  clearExpenseReviewPageSelection();
  panel.innerHTML = "";

  const text = document.createElement("p");
  text.className = isError ? "review-document-state error" : "review-document-state";
  text.textContent = message || "אין מסמך להצגה.";
  panel.appendChild(text);
}

function openExpenseExtractedPreviewFullscreen(opener){
  expenseReviewFullscreenOpener = opener;
  openExpenseReviewFullscreen();
}

function prepareExpenseExtractedPreviewFullscreenDocument({src, mimeType}){
  if(!src || !mimeType) return;
  setCurrentExpenseReviewDocument({signedUrl: src, mimeType});
  clearExpenseReviewPageSelection();
}

function renderExpenseExtractedPreviewFile({src, mimeType}){
  const section = $("expenseExtractedPreview");
  const panel = $("expenseExtractedPreviewPanel");
  if(!section || !panel || !src) return;

  section.classList.remove("hidden");
  panel.innerHTML = "";
  panel.classList.remove("preview-openable", "preview-overlay-openable");

  const normalizedMimeType = String(mimeType || "").toLowerCase();
  prepareExpenseExtractedPreviewFullscreenDocument({
    src,
    mimeType: normalizedMimeType || "application/octet-stream"
  });

  if(normalizedMimeType.startsWith("image/")){
    const image = document.createElement("img");
    image.src = src;
    image.alt = "מסמך חשבונית";
    image.tabIndex = 0;
    image.style.cursor = "pointer";
    image.setAttribute("role", "button");
    image.setAttribute("aria-label", "פתחי את מסמך החשבונית בתצוגת מסך מלא");
    image.setAttribute("title", "פתחי במסך מלא");
    image.addEventListener("click", () => {
      openExpenseExtractedPreviewFullscreen(image);
    });
    image.addEventListener("keydown", event => {
      if(event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openExpenseExtractedPreviewFullscreen(image);
    });
    panel.appendChild(image);
    return;
  }

  panel.classList.add("preview-overlay-openable");
  const frame = document.createElement("iframe");
  frame.src = src;
  frame.title = "מסמך חשבונית";
  frame.loading = "lazy";
  panel.appendChild(frame);

  const openOverlay = document.createElement("button");
  openOverlay.type = "button";
  openOverlay.className = "review-document-overlay-trigger";
  openOverlay.setAttribute("aria-label", "פתחי את מסמך החשבונית בתצוגת מסך מלא");
  openOverlay.setAttribute("title", "פתחי במסך מלא");
  openOverlay.addEventListener("click", () => {
    openExpenseExtractedPreviewFullscreen(openOverlay);
  });
  openOverlay.addEventListener("keydown", event => {
    if(event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openExpenseExtractedPreviewFullscreen(openOverlay);
  });
  panel.appendChild(openOverlay);
}

function renderExpenseExtractedPreviewFromLocalFiles(files){
  const candidateFiles = Array.isArray(files) ? files : [];
  if(!candidateFiles.length) return false;

  const preferredFile = candidateFiles.find(file => String(file?.type || "").toLowerCase().startsWith("image/")) || candidateFiles[0];
  const localUrl = getLocalFileObjectUrl(preferredFile);
  if(!localUrl) return false;

  renderExpenseExtractedPreviewFile({
    src: localUrl,
    mimeType: preferredFile.type || "application/octet-stream"
  });
  return true;
}

function getSingleItemFirstPageForPreview(rpcInput){
  const pages = rpcInput?.p_items?.[0]?.pages;
  if(!Array.isArray(pages) || !pages.length) return null;

  return pages
    .slice()
    .sort((a,b) => Number(a?.global_page_index || 0) - Number(b?.global_page_index || 0))[0] || null;
}

async function getSignedUrlForExtractedPreview(storagePath){
  const now = Date.now();
  const cached = extractedPreviewSignedUrlCache.get(storagePath);
  if(cached && cached.expiresAt > (now + 2000)){
    return cached.signedUrl;
  }

  const {data:signed, error:signError} = await sb.storage
    .from("invoice-documents")
    .createSignedUrl(storagePath, 60);

  if(signError || !signed?.signedUrl){
    throw new Error(signError?.message || "שגיאה בטעינת מסמך החשבונית");
  }

  extractedPreviewSignedUrlCache.set(storagePath, {
    signedUrl: signed.signedUrl,
    expiresAt: now + 55000
  });

  return signed.signedUrl;
}

async function renderExpenseExtractedPreviewFromPersistedPage(page){
  const storagePath = String(page?.storage_path || "").trim();
  const mimeType = String(page?.mime_type || "").trim() || "application/octet-stream";
  if(!storagePath){
    renderExpenseExtractedPreviewState({message:"אין מסמך להצגה."});
    return;
  }

  expenseExtractedPreviewLoadToken += 1;
  const loadToken = expenseExtractedPreviewLoadToken;
  renderExpenseExtractedPreviewState({message:"טוען מסמך חשבונית..."});

  const isCurrentLoad = () => (
    loadToken === expenseExtractedPreviewLoadToken
    && currentExpenseDialogPrimaryState === EXPENSE_DIALOG_PRIMARY_STATES.EXTRACTED_FORM
  );

  try {
    const signedUrl = await getSignedUrlForExtractedPreview(storagePath);
    if(!isCurrentLoad()) return;

    renderExpenseExtractedPreviewFile({src:signedUrl, mimeType});
  } catch(error){
    if(!isCurrentLoad()) return;
    console.error(error);
    renderExpenseExtractedPreviewState({
      message: "לא ניתן לטעון את מסמך החשבונית.",
      isError: true
    });
  }
}

function renderExpenseReviewDocumentState({message = "", isError = false} = {}){
  const panel = $("expenseReviewDocument");
  if(!panel) return;

  setCurrentExpenseReviewDocument(null);
  panel.innerHTML = "";
  const text = document.createElement("p");
  text.className = isError ? "review-document-state error" : "review-document-state";
  text.textContent = message || "אין מסמך להצגה.";
  panel.appendChild(text);
}

function renderExpenseReviewDocumentFile({signedUrl, mimeType}){
  const panel = $("expenseReviewDocument");
  if(!panel) return;

  setCurrentExpenseReviewDocument({signedUrl, mimeType});
  panel.innerHTML = "";

  if(String(mimeType || "").toLowerCase().startsWith("image/")){
    const image = document.createElement("img");
    image.src = signedUrl;
    image.alt = "מסמך חשבונית נבחר";
    image.title = "פתחי במסך מלא";
    image.style.cursor = "pointer";
    image.tabIndex = 0;
    image.addEventListener("click", () => {
      expenseReviewFullscreenOpener = image;
      openExpenseReviewFullscreen();
    });
    image.addEventListener("keydown", event => {
      if(event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      expenseReviewFullscreenOpener = image;
      openExpenseReviewFullscreen();
    });
    panel.appendChild(image);
    return;
  }

  const frame = document.createElement("iframe");
  frame.src = signedUrl;
  frame.title = "מסמך חשבונית נבחר";
  frame.loading = "lazy";
  panel.appendChild(frame);
}

function clearExpenseReviewPageSelection(){
  currentExpenseReviewPages = [];
  currentExpenseReviewPageIndex = 0;
  updateExpenseReviewFullscreenPageNavigation();
}

function setExpenseReviewPageSelection(pages, pageIndex = 0){
  currentExpenseReviewPages = Array.isArray(pages) ? pages : [];
  currentExpenseReviewPageIndex = currentExpenseReviewPages.length
    ? Math.min(Math.max(0, pageIndex), currentExpenseReviewPages.length - 1)
    : 0;
  updateExpenseReviewFullscreenPageNavigation();
}

function getCurrentExpenseReviewPage(){
  return currentExpenseReviewPages[currentExpenseReviewPageIndex] || null;
}

function updateExpenseReviewFullscreenPageNavigation(){
  const nav = $("expenseReviewFullscreenPageNav");
  const prevButton = $("expenseReviewFullscreenPagePrev");
  const nextButton = $("expenseReviewFullscreenPageNext");
  const position = $("expenseReviewFullscreenPagePosition");
  if(!nav || !prevButton || !nextButton) return;

  const total = currentExpenseReviewPages.length;
  const hasPages = total > 0;
  const hasMultiplePages = total > 1;
  const activeIndex = hasPages
    ? Math.min(Math.max(0, currentExpenseReviewPageIndex), total - 1)
    : 0;

  nav.classList.toggle("hidden", !hasMultiplePages);
  prevButton.disabled = !hasMultiplePages || activeIndex <= 0;
  nextButton.disabled = !hasMultiplePages || activeIndex >= (total - 1);
  if(position){
    position.textContent = hasPages ? `עמוד ${activeIndex + 1} מתוך ${total}` : "";
  }
}

function getExpenseReviewPageRenderSequence(){
  const pages = currentExpenseReviewPages;
  const index = currentExpenseReviewPageIndex;
  const itemId = activeExpenseReviewContext?.scanItemId || null;

  return {pages, index, itemId};
}

async function renderExpenseReviewPageAtIndex(pageIndex){
  if(!currentExpenseReviewPages.length) return;

  const requestedIndex = Math.min(Math.max(0, pageIndex), currentExpenseReviewPages.length - 1);
  const requestedPage = currentExpenseReviewPages[requestedIndex];
  if(!requestedPage || !requestedPage.storage_path){
    renderExpenseReviewDocumentState({message:"לא נמצאו עמודים לחשבונית זו."});
    return;
  }

  const {pages, itemId} = getExpenseReviewPageRenderSequence();
  currentExpenseReviewPageIndex = requestedIndex;
  updateExpenseReviewFullscreenPageNavigation();
  clearFullscreenImageState();
  const requestedPageIsImage = String(requestedPage.mime_type || "").toLowerCase().startsWith("image/");
  setFullscreenImageControlsVisible(requestedPageIsImage);
  if(requestedPageIsImage){
    resetFullscreenImageState();
  }

  const {data:signed, error:signError} = await sb.storage
    .from("invoice-documents")
    .createSignedUrl(requestedPage.storage_path, 60);

  if(pages !== currentExpenseReviewPages || itemId !== (activeExpenseReviewContext?.scanItemId || null) || requestedIndex !== currentExpenseReviewPageIndex){
    return;
  }

  if(signError || !signed?.signedUrl){
    throw new Error(signError?.message || "שגיאה בטעינת מסמך החשבונית");
  }

  renderExpenseReviewDocumentFile({
    signedUrl: signed.signedUrl,
    mimeType: requestedPage.mime_type
  });

  if($("expenseReviewFullscreenDialog")?.open){
    renderExpenseReviewFullscreenContent();
  }
}

function navigateExpenseReviewFullscreenPageByOffset(offset){
  if(!Number.isInteger(offset) || !offset || !currentExpenseReviewPages.length) return;

  const targetIndex = currentExpenseReviewPageIndex + offset;
  if(targetIndex < 0 || targetIndex >= currentExpenseReviewPages.length) return;

  void renderExpenseReviewPageAtIndex(targetIndex).catch(error => {
    console.error(error);
    renderExpenseReviewDocumentState({
      message: "לא ניתן לטעון את עמוד החשבונית.",
      isError: true
    });
    setStatus($("expenseStatus"), error?.message || "שגיאה בטעינת עמוד החשבונית", "error");
  });
}

async function openExpenseReviewPageAtIndex(pageIndex){
  await renderExpenseReviewPageAtIndex(pageIndex);
}

function isFullscreenImageDocument(){
  return Boolean(currentExpenseReviewDocument?.mimeType && String(currentExpenseReviewDocument.mimeType).toLowerCase().startsWith("image/"));
}

function createFullscreenImageState(){
  return {
    scale: 1,
    translateX: 0,
    translateY: 0,
    pointers: new Map(),
    dragPointerId: null,
    dragStartX: 0,
    dragStartY: 0,
    dragOriginX: 0,
    dragOriginY: 0,
    pinchStartDistance: 0,
    pinchStartMidpoint: null,
    pinchStartScale: 1,
    pinchStartTranslateX: 0,
    pinchStartTranslateY: 0
  };
}

function clearFullscreenImageState(){
  currentFullscreenImageState = null;
}

function resetFullscreenImageState(){
  currentFullscreenImageState = createFullscreenImageState();
}

function getFullscreenImageToolbar(){
  return $("expenseReviewFullscreenToolbar");
}

function getFullscreenImageViewport(){
  return $("expenseReviewFullscreenViewport");
}

function getFullscreenImageElement(){
  return $("expenseReviewFullscreenImage");
}

function setFullscreenImageControlsVisible(isVisible){
  const toolbar = getFullscreenImageToolbar();
  if(!toolbar) return;

  toolbar.classList.toggle("hidden", !isVisible);
}

function clampFullscreenImageValue(value, min, max){
  return Math.min(max, Math.max(min, value));
}

function getFullscreenImageBounds(scale){
  const viewport = getFullscreenImageViewport();
  const image = getFullscreenImageElement();
  if(!viewport || !image || !image.naturalWidth || !image.naturalHeight){
    return {minX: 0, maxX: 0, minY: 0, maxY: 0};
  }

  const viewportWidth = viewport.clientWidth;
  const viewportHeight = viewport.clientHeight;
  const fitScale = Math.min(
    viewportWidth / image.naturalWidth,
    viewportHeight / image.naturalHeight,
    1
  );
  const baseWidth = image.naturalWidth * fitScale;
  const baseHeight = image.naturalHeight * fitScale;
  const overflowX = Math.max(0, (baseWidth * scale - viewportWidth) / 2);
  const overflowY = Math.max(0, (baseHeight * scale - viewportHeight) / 2);

  return {
    minX: -overflowX,
    maxX: overflowX,
    minY: -overflowY,
    maxY: overflowY
  };
}

function clampFullscreenImageTransform(){
  if(!currentFullscreenImageState) return;

  if(currentFullscreenImageState.scale <= 1){
    currentFullscreenImageState.scale = 1;
    currentFullscreenImageState.translateX = 0;
    currentFullscreenImageState.translateY = 0;
    return;
  }

  const bounds = getFullscreenImageBounds(currentFullscreenImageState.scale);
  currentFullscreenImageState.translateX = clampFullscreenImageValue(
    currentFullscreenImageState.translateX,
    bounds.minX,
    bounds.maxX
  );
  currentFullscreenImageState.translateY = clampFullscreenImageValue(
    currentFullscreenImageState.translateY,
    bounds.minY,
    bounds.maxY
  );
}

function applyFullscreenImageTransform(){
  const image = getFullscreenImageElement();
  if(!image || !currentFullscreenImageState) return;

  clampFullscreenImageTransform();
  image.style.transform = `translate3d(${currentFullscreenImageState.translateX}px, ${currentFullscreenImageState.translateY}px, 0) scale(${currentFullscreenImageState.scale})`;
  image.classList.toggle("dragging", Boolean(currentFullscreenImageState.dragPointerId && currentFullscreenImageState.scale > 1));
}

function zoomFullscreenImageTo(targetScale, focalClientX, focalClientY){
  if(!currentFullscreenImageState || !isFullscreenImageDocument()) return;

  const viewport = getFullscreenImageViewport();
  if(!viewport) return;

  const nextScale = clampFullscreenImageValue(targetScale, 1, 4);
  if(nextScale === 1){
    currentFullscreenImageState.scale = 1;
    currentFullscreenImageState.translateX = 0;
    currentFullscreenImageState.translateY = 0;
    applyFullscreenImageTransform();
    return;
  }

  const rect = viewport.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const focalX = (focalClientX ?? (rect.left + centerX)) - rect.left - centerX;
  const focalY = (focalClientY ?? (rect.top + centerY)) - rect.top - centerY;
  const previousScale = currentFullscreenImageState.scale || 1;

  currentFullscreenImageState.scale = nextScale;
  currentFullscreenImageState.translateX = focalX - ((focalX - currentFullscreenImageState.translateX) * nextScale / previousScale);
  currentFullscreenImageState.translateY = focalY - ((focalY - currentFullscreenImageState.translateY) * nextScale / previousScale);
  applyFullscreenImageTransform();
}

function zoomFullscreenImageBy(factor, focalClientX, focalClientY){
  if(!currentFullscreenImageState) return;
  zoomFullscreenImageTo(currentFullscreenImageState.scale * factor, focalClientX, focalClientY);
}

function renderExpenseReviewFullscreenImage(){
  const content = $("expenseReviewFullscreenContent");
  if(!content) return;

  content.classList.add("image-mode");
  content.innerHTML = `
    <div id="expenseReviewFullscreenViewport" class="review-fullscreen-viewport">
      <img id="expenseReviewFullscreenImage" alt="מסמך חשבונית במסך מלא">
    </div>
  `;

  const image = getFullscreenImageElement();
  if(!image || !currentExpenseReviewDocument?.signedUrl) return;

  image.draggable = false;
  image.src = currentExpenseReviewDocument.signedUrl;
  image.addEventListener("load", () => {
    if(currentFullscreenImageState){
      applyFullscreenImageTransform();
    }
  }, {once: true});

  const viewport = getFullscreenImageViewport();
  if(!viewport) return;

  viewport.addEventListener("wheel", event => {
    if(!currentFullscreenImageState) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    zoomFullscreenImageBy(factor, event.clientX, event.clientY);
  }, {passive: false});

  viewport.addEventListener("pointerdown", event => {
    if(!currentFullscreenImageState) return;
    if(event.button !== 0) return;

    const state = currentFullscreenImageState;
    state.pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
    try { viewport.setPointerCapture(event.pointerId); } catch {}

    if(state.pointers.size === 1){
      state.dragPointerId = event.pointerId;
      state.dragStartX = event.clientX;
      state.dragStartY = event.clientY;
      state.dragOriginX = state.translateX;
      state.dragOriginY = state.translateY;
    }

    if(state.pointers.size >= 2){
      const points = Array.from(state.pointers.values()).slice(0, 2);
      const [firstPoint, secondPoint] = points;
      state.pinchStartDistance = Math.hypot(firstPoint.x - secondPoint.x, firstPoint.y - secondPoint.y) || 1;
      state.pinchStartMidpoint = {
        x: (firstPoint.x + secondPoint.x) / 2,
        y: (firstPoint.y + secondPoint.y) / 2
      };
      state.pinchStartScale = state.scale;
      state.pinchStartTranslateX = state.translateX;
      state.pinchStartTranslateY = state.translateY;
      state.dragPointerId = null;
    }

    event.preventDefault();
  });

  viewport.addEventListener("pointermove", event => {
    if(!currentFullscreenImageState) return;
    const state = currentFullscreenImageState;
    if(!state.pointers.has(event.pointerId)) return;

    state.pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});

    if(state.pointers.size >= 2 && state.pinchStartMidpoint){
      const points = Array.from(state.pointers.values()).slice(0, 2);
      const [firstPoint, secondPoint] = points;
      const currentDistance = Math.hypot(firstPoint.x - secondPoint.x, firstPoint.y - secondPoint.y) || 1;
      const currentMidpoint = {
        x: (firstPoint.x + secondPoint.x) / 2,
        y: (firstPoint.y + secondPoint.y) / 2
      };
      const nextScale = clampFullscreenImageValue(
        state.pinchStartScale * (currentDistance / state.pinchStartDistance),
        1,
        4
      );
      const rect = viewport.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const startMidX = state.pinchStartMidpoint.x - rect.left - centerX;
      const startMidY = state.pinchStartMidpoint.y - rect.top - centerY;
      const currentMidX = currentMidpoint.x - rect.left - centerX;
      const currentMidY = currentMidpoint.y - rect.top - centerY;

      currentFullscreenImageState.scale = nextScale;
      currentFullscreenImageState.translateX = currentMidX - ((startMidX - state.pinchStartTranslateX) * nextScale / state.pinchStartScale);
      currentFullscreenImageState.translateY = currentMidY - ((startMidY - state.pinchStartTranslateY) * nextScale / state.pinchStartScale);
      applyFullscreenImageTransform();
      return;
    }

    if(state.pointers.size === 1 && state.dragPointerId === event.pointerId && state.scale > 1){
      state.translateX = state.dragOriginX + (event.clientX - state.dragStartX);
      state.translateY = state.dragOriginY + (event.clientY - state.dragStartY);
      applyFullscreenImageTransform();
    }
  });

  viewport.addEventListener("pointerup", event => {
    if(!currentFullscreenImageState) return;
    const state = currentFullscreenImageState;
    state.pointers.delete(event.pointerId);
    if(state.dragPointerId === event.pointerId){
      state.dragPointerId = null;
    }

    if(state.pointers.size === 0){
      state.pinchStartMidpoint = null;
      state.pinchStartDistance = 0;
      state.pinchStartScale = state.scale;
      state.pinchStartTranslateX = state.translateX;
      state.pinchStartTranslateY = state.translateY;
      state.dragPointerId = null;
    } else if(state.pointers.size === 1){
      const [remainingPointerId, remainingPointer] = Array.from(state.pointers.entries())[0];
      state.dragPointerId = remainingPointerId;
      state.dragStartX = remainingPointer.x;
      state.dragStartY = remainingPointer.y;
      state.dragOriginX = state.translateX;
      state.dragOriginY = state.translateY;
      state.pinchStartMidpoint = null;
      state.pinchStartDistance = 0;
    }

    try { viewport.releasePointerCapture(event.pointerId); } catch {}
    applyFullscreenImageTransform();
  });

  viewport.addEventListener("pointercancel", event => {
    if(!currentFullscreenImageState) return;
    currentFullscreenImageState.pointers.delete(event.pointerId);
    if(currentFullscreenImageState.dragPointerId === event.pointerId){
      currentFullscreenImageState.dragPointerId = null;
    }
    try { viewport.releasePointerCapture(event.pointerId); } catch {}
    applyFullscreenImageTransform();
  });

  applyFullscreenImageTransform();
}

function renderExpenseReviewFullscreenDocument(){
  const content = $("expenseReviewFullscreenContent");
  if(!content) return;

  content.classList.remove("image-mode");
  content.innerHTML = "";

  const frame = document.createElement("iframe");
  frame.src = currentExpenseReviewDocument?.signedUrl || "";
  frame.title = "מסמך חשבונית במסך מלא";
  frame.loading = "lazy";
  content.appendChild(frame);
}

function setCurrentExpenseReviewDocument(documentFile){
  const hasValidDocument = Boolean(documentFile?.signedUrl && documentFile?.mimeType);

  currentExpenseReviewDocument = hasValidDocument
    ? {signedUrl: documentFile.signedUrl, mimeType: documentFile.mimeType}
    : null;

  if(!hasValidDocument){
    clearFullscreenImageState();
    setFullscreenImageControlsVisible(false);
  }

  updateExpenseReviewFullscreenEntry();
  updateExpenseReviewFullscreenPageNavigation();

  if(!currentExpenseReviewDocument){
    closeExpenseReviewFullscreen({shouldRestoreFocus:false});
  }
}

function updateExpenseReviewFullscreenEntry(){
  const entryButton = $("expenseReviewFullscreenOpen");
  if(!entryButton) return;

  const hasDocument = Boolean(currentExpenseReviewDocument?.signedUrl && currentExpenseReviewDocument?.mimeType);
  entryButton.classList.toggle("hidden", !hasDocument);
  entryButton.disabled = !hasDocument;
}

function renderExpenseReviewFullscreenContent(){
  const content = $("expenseReviewFullscreenContent");
  if(!content) return;

  content.innerHTML = "";

  if(!currentExpenseReviewDocument?.signedUrl || !currentExpenseReviewDocument?.mimeType){
    setFullscreenImageControlsVisible(false);
    const text = document.createElement("p");
    text.className = "review-document-state";
    text.textContent = "אין מסמך להצגה.";
    content.appendChild(text);
    return;
  }

  if(isFullscreenImageDocument()){
    setFullscreenImageControlsVisible(true);
    renderExpenseReviewFullscreenImage();
    return;
  }

  setFullscreenImageControlsVisible(false);
  renderExpenseReviewFullscreenDocument();
}

function openExpenseReviewFullscreen(){
  if(!currentExpenseReviewDocument?.signedUrl || !currentExpenseReviewDocument?.mimeType) return;

  const dialog = $("expenseReviewFullscreenDialog");
  const closeButton = $("expenseReviewFullscreenClose");
  const entryButton = $("expenseReviewFullscreenOpen");
  if(!dialog) return;

  expenseReviewFullscreenOpener = entryButton || expenseReviewFullscreenOpener || null;
  clearFullscreenImageState();
  if(isFullscreenImageDocument()){
    resetFullscreenImageState();
  }
  renderExpenseReviewFullscreenContent();
  updateExpenseReviewFullscreenPageNavigation();
  dialog.showModal();
  if(closeButton) closeButton.focus();
}

function closeExpenseReviewFullscreen({shouldRestoreFocus = true} = {}){
  const dialog = $("expenseReviewFullscreenDialog");
  if(!dialog) return;

  if(dialog.open) dialog.close();

  clearFullscreenImageState();

  if(
    shouldRestoreFocus
    && expenseReviewFullscreenOpener
    && !expenseReviewFullscreenOpener.disabled
    && !expenseReviewFullscreenOpener.classList.contains("hidden")
  ){
    expenseReviewFullscreenOpener.focus();
  }

  if(shouldRestoreFocus){
    expenseReviewFullscreenOpener = null;
  }
}

function setActiveExpenseReviewContext(context){
  const section = $("expenseReviewContext");
  if(!section) return;

  activeExpenseReviewContext = {
    batchId: context.batchId,
    scanItemId: context.scanItemId,
    itemOrder: context.itemOrder,
    enteredFromReviewList: true
  };

  section.classList.remove("hidden");
  updateExpenseReviewNavigation();
}

function getActiveExpenseReviewRowIndex(){
  if(!activeExpenseReviewContext?.scanItemId) return -1;
  return expenseReviewRows.findIndex(
    row => row.scanItemId === activeExpenseReviewContext.scanItemId
  );
}

function updateExpenseReviewNavigation(){
  const prevButton = $("expenseReviewNavPrev");
  const backButton = $("expenseReviewBackToList");
  const nextButton = $("expenseReviewNavNext");
  const discardButton = $("expenseReviewDiscardButton");
  const position = $("expenseReviewPosition");
  if(!prevButton || !backButton || !nextButton || !position) return;

  const total = expenseReviewRows.length;
  const activeIndex = getActiveExpenseReviewRowIndex();
  const hasActive = activeIndex >= 0;

  prevButton.textContent = "→";
  nextButton.textContent = "←";
  prevButton.setAttribute("aria-label", "חשבונית קודמת");
  nextButton.setAttribute("aria-label", "חשבונית הבאה");
  prevButton.title = "חשבונית קודמת";
  nextButton.title = "חשבונית הבאה";

  prevButton.disabled = !hasActive || activeIndex <= 0;
  nextButton.disabled = !hasActive || activeIndex >= (total - 1);
  backButton.disabled = total === 0;
  if(discardButton) discardButton.disabled = !hasActive;

  position.textContent = hasActive
    ? `חשבונית ${activeIndex + 1} מתוך ${total}`
    : "";
}

function navigateExpenseReviewByOffset(offset){
  if(!Number.isInteger(offset) || !offset || !expenseReviewRows.length) return;
  const activeIndex = getActiveExpenseReviewRowIndex();
  if(activeIndex < 0) return;

  const targetIndex = activeIndex + offset;
  if(targetIndex < 0 || targetIndex >= expenseReviewRows.length) return;

  openExpenseReviewItem(expenseReviewRows[targetIndex]);
}

function returnToExpenseReviewList(){
  if(!expenseReviewRows.length) return;

  expenseReviewLoadToken += 1;
  activeExpenseReviewContext = null;
  hideExpenseReviewContext();
  renderExpenseReviewList(expenseReviewRows);
}

function removeSavedExpenseReviewItemAndOpenNext(savedScanItemId){
  const savedIndex = expenseReviewRows.findIndex(row => row.scanItemId === savedScanItemId);
  if(savedIndex < 0){
    throw new Error("לא נמצאה החשבונית שנשמרה ברשימת הבדיקה");
  }

  const remainingRows = expenseReviewRows.filter(row => row.scanItemId !== savedScanItemId);
  const nextRow = remainingRows[savedIndex] || null;

  expenseReviewRows = remainingRows;

  if(activeExpenseReviewContext?.scanItemId === savedScanItemId){
    activeExpenseReviewContext = null;
  }

  if(!nextRow){
    hideExpenseReviewContext();
    renderExpenseReviewList(remainingRows);
    return;
  }

  renderExpenseReviewList(remainingRows);
  openExpenseReviewItem(nextRow);
}

async function openNextPendingInvoice({
  sessionRows = null,
  refreshWhenEmpty = false
} = {}){
  const normalizedSessionRows = Array.isArray(sessionRows) ? sessionRows.slice() : expenseReviewRows.slice();

  expenseReviewRows = normalizedSessionRows;
  pendingExpenseEntryRows = normalizedSessionRows.slice();

  if(normalizedSessionRows.length){
    renderExpenseReviewList(normalizedSessionRows);
    openExpenseReviewItem(normalizedSessionRows[0]);
    void refreshPendingInvoiceCountIndicator();
    return true;
  }

  if(refreshWhenEmpty){
    const refreshedRows = await loadPendingReviewRows();
    expenseReviewRows = refreshedRows;
    pendingExpenseEntryRows = refreshedRows.slice();

    if(refreshedRows.length){
      renderExpenseReviewList(refreshedRows);
      openExpenseReviewItem(refreshedRows[0]);
      void refreshPendingInvoiceCountIndicator();
      return true;
    }
  }

  activeExpenseReviewContext = null;
  hideExpenseReviewContext();
  renderExpenseReviewList([]);
  void refreshPendingInvoiceCountIndicator();
  $("expenseDialog")?.close();
  return false;
}

async function discardPendingInvoiceScanItem(row){
  const scanItemId = String(row?.scanItemId || "").trim();
  if(!scanItemId) return false;

  const {data:discardResult, error:discardError} = await sb.rpc(
    "discard_pending_invoice_scan_item_atomic",
    {p_scan_item_id: scanItemId}
  );

  if(discardError){
    throw new Error(discardError.message || "שגיאה במחיקת החשבונית הממתינה");
  }

  const discardRow = Array.isArray(discardResult) ? discardResult[0] : discardResult;
  if(!discardRow?.deleted_scan_item_id){
    throw new Error("תשובת מחיקת החשבונית אינה תקינה");
  }

  const storagePaths = (Array.isArray(discardRow.storage_paths) ? discardRow.storage_paths : [])
    .map(path => String(path || "").trim())
    .filter(Boolean);

  if(storagePaths.length){
    const cleanupError = await cleanupUploadedExpenseFiles(storagePaths);
    if(cleanupError){
      enqueuePendingExpenseStorageCleanup(storagePaths);
    }
  }

  const removedScanItemId = String(discardRow.deleted_scan_item_id || "").trim();
  const remainingRows = expenseReviewRows.filter(candidate => candidate.scanItemId !== removedScanItemId);

  await openNextPendingInvoice({
    sessionRows: remainingRows,
    refreshWhenEmpty: true
  });

  if(storagePaths.length && getPendingExpenseStorageCleanupPaths().length){
    showToast("החשבונית הוסרה. ניקוי קבצי המסמך יושלם אוטומטית.", "ok");
  } else {
    showToast("החשבונית הוסרה מרשימת ההמתנה", "ok");
  }

  return true;
}

async function confirmAndDiscardActiveReviewInvoice(){
  if(currentExpenseDialogPrimaryState !== EXPENSE_DIALOG_PRIMARY_STATES.REVIEW_CONTEXT){
    setStatus($("expenseStatus"), "בחרי חשבונית למחיקה מרשימת ההמתנה.", "error");
    return;
  }

  const activeIndex = getActiveExpenseReviewRowIndex();
  if(activeIndex < 0){
    setStatus($("expenseStatus"), "לא נמצאה חשבונית פעילה למחיקה.", "error");
    return;
  }

  if(!window.confirm("למחוק את החשבונית הממתינה? המסמך יוסר ולא תיווצר ממנו הוצאה.")) return;

  const targetRow = expenseReviewRows[activeIndex];
  try {
    await discardPendingInvoiceScanItem(targetRow);
  } catch(error){
    console.error(error);
    setStatus($("expenseStatus"), error?.message || "שגיאה במחיקת החשבונית הממתינה", "error");
  }
}

async function deferActivePendingInvoiceAndOpenNext(){
  const activeIndex = getActiveExpenseReviewRowIndex();
  if(activeIndex < 0){
    setStatus($("expenseStatus"), "לא נמצאה חשבונית פעילה לבדיקה מאוחרת.", "error");
    return;
  }

  const activeRow = expenseReviewRows[activeIndex];
  const otherRows = expenseReviewRows.filter((_, index) => index !== activeIndex);

  if(!otherRows.length){
    setStatus($("expenseStatus"), "החשבונית סומנה לבדיקה מאוחרת.", "ok");
    await openNextPendingInvoice({sessionRows: [], refreshWhenEmpty: false});
    return;
  }

  const reorderedRows = otherRows.concat(activeRow);
  setStatus($("expenseStatus"), "החשבונית סומנה לבדיקה מאוחרת.", "ok");
  await openNextPendingInvoice({sessionRows: reorderedRows, refreshWhenEmpty: false});
}

async function reconcileExpenseReviewRowsAfterSave(batchId){
  const activeScanItemId = activeExpenseReviewContext?.scanItemId || null;
  const reconciledRows = await loadPendingReviewRows();
  expenseReviewRows = reconciledRows;
  pendingExpenseEntryRows = reconciledRows.slice();
  void refreshPendingInvoiceCountIndicator();

  if(!reconciledRows.length){
    activeExpenseReviewContext = null;
    hideExpenseReviewContext();
    renderExpenseReviewList(reconciledRows);
    return;
  }

  const hasActivePendingRow = activeScanItemId
    ? reconciledRows.some(row => row.scanItemId === activeScanItemId)
    : false;

  if(hasActivePendingRow){
    if(!$("expenseReviewList")?.classList.contains("hidden")){
      renderExpenseReviewList(reconciledRows);
      return;
    }

    updateExpenseReviewNavigation();
    return;
  }

  activeExpenseReviewContext = null;
  hideExpenseReviewContext();
  renderExpenseReviewList(reconciledRows);
}

async function loadExpenseReviewItemData(row, loadToken){
  const isStaleLoad = () => loadToken !== expenseReviewLoadToken;

  const {data:item, error:itemError} = await sb.from("invoice_scan_items")
    .select("id,batch_id,item_order,extracted_data")
    .eq("user_id", userId)
    .eq("batch_id", row.batchId)
    .eq("id", row.scanItemId)
    .maybeSingle();

  if(isStaleLoad()) return;

  if(itemError || !item){
    throw new Error(itemError?.message || "שגיאה בטעינת פרטי החשבונית לבדיקה");
  }

  const invoiceData = sanitizeSingleInvoiceResult({
    multiple_invoices: false,
    ...(item.extracted_data || {})
  });
  fillExpenseFormFromInvoice(invoiceData);

  const {data:pages, error:pagesError} = await sb.from("invoice_scan_pages")
    .select("storage_path,mime_type,global_page_index")
    .eq("user_id", userId)
    .eq("scan_item_id", row.scanItemId)
    .order("global_page_index", {ascending:true});

  if(isStaleLoad()) return;

  if(pagesError){
    throw new Error(pagesError.message || "שגיאה בטעינת עמודי החשבונית");
  }

  const orderedPages = pages || [];
  if(!orderedPages.length){
    clearExpenseReviewPageSelection();
    renderExpenseReviewDocumentState({message:"לא נמצאו עמודים לחשבונית זו."});
    return;
  }

  setExpenseReviewPageSelection(orderedPages, 0);
  await openExpenseReviewPageAtIndex(0);

  if(isStaleLoad()) return;
}

async function openExpenseReviewItem(row){
  if(!row || !row.scanItemId || !row.batchId || !Number.isInteger(row.itemOrder)) return;

  const pendingRow = expenseReviewRows.find(candidate => candidate.scanItemId === row.scanItemId);
  if(expenseReviewRows.length && !pendingRow){
    setStatus($("expenseStatus"), "החשבונית כבר נשמרה ואינה זמינה לבדיקה.", "error");
    return;
  }

  const targetRow = pendingRow || row;

  expenseReviewLoadToken += 1;
  const loadToken = expenseReviewLoadToken;

  setExpenseDialogPrimaryState(EXPENSE_DIALOG_PRIMARY_STATES.REVIEW_CONTEXT);

  setActiveExpenseReviewContext({
    batchId: targetRow.batchId,
    scanItemId: targetRow.scanItemId,
    itemOrder: targetRow.itemOrder,
    label: targetRow.label
  });

  hideExpenseReviewList();

  clearExpenseReviewPageSelection();
  clearExpenseInvoiceDerivedFields();
  renderExpenseReviewDocumentState({message:"טוען מסמך חשבונית..."});

  try {
    await loadExpenseReviewItemData(targetRow, loadToken);
  } catch(error){
    if(loadToken !== expenseReviewLoadToken) return;
    console.error(error);
    renderExpenseReviewDocumentState({
      message: "לא ניתן לטעון את מסמך החשבונית.",
      isError: true
    });
    setStatus($("expenseStatus"), error?.message || "שגיאה בטעינת פרטי החשבונית", "error");
  }
}

function renderExpenseReviewList(rows){
  const section = $("expenseReviewList");
  const tableHost = $("expenseReviewListTable");
  if(!section || !tableHost) return;

  setExpenseDialogPrimaryState(EXPENSE_DIALOG_PRIMARY_STATES.PENDING_REVIEW_LIST);
  expenseReviewRows = Array.isArray(rows) ? rows : [];
  pendingExpenseEntryRows = expenseReviewRows.slice();

  if(!expenseReviewRows.length){
    section.classList.remove("hidden");
    tableHost.innerHTML = "אין חשבוניות להצגה.";
    updateExpenseReviewNavigation();
    updateExpenseContinueLaterButtonState();
    return;
  }

  tableHost.innerHTML = `
    <table aria-label="טבלת חשבוניות לבדיקה">
      <thead>
        <tr>
          <th scope="col">מס' חשבונית</th>
          <th scope="col">תאריך</th>
          <th scope="col">שעה</th>
        </tr>
      </thead>
      <tbody>
        ${expenseReviewRows.map(row => `
          <tr data-scan-item-id="${row.scanItemId}" data-batch-id="${row.batchId}" data-item-order="${row.itemOrder}">
            <td><button type="button" class="review-row-open" data-open-review-item="${row.scanItemId}">${row.label}</button></td>
            <td>${row.capturedDate}</td>
            <td>${row.capturedTime}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  tableHost.querySelectorAll("[data-open-review-item]").forEach(button => {
    button.onclick = () => {
      const scanItemId = button.getAttribute("data-open-review-item") || "";
      const targetRow = expenseReviewRows.find(row => row.scanItemId === scanItemId);
      if(!targetRow) return;
      openExpenseReviewItem(targetRow);
    };
  });

  section.classList.remove("hidden");
  updateExpenseReviewNavigation();
  updateExpenseContinueLaterButtonState();
}

async function loadPendingReviewRows({batchId = null} = {}){
  let itemsQuery = sb.from("invoice_scan_items")
    .select("id,batch_id,item_order,invoice_scan_batches!inner(completed_at)")
    .eq("user_id", userId)
    .is("saved_expense_id", null)
    .order("item_order", {ascending:true});

  if(batchId){
    itemsQuery = itemsQuery.eq("batch_id", batchId);
  }

  const {data:items, error:itemsError} = await itemsQuery;

  if(itemsError){
    throw new Error(itemsError.message || "שגיאה בטעינת פריטי חשבוניות לבדיקה");
  }

  const itemRows = items || [];
  if(!itemRows.length) return [];

  const itemIds = itemRows.map(item => item.id);
  const {data:pages, error:pagesError} = await sb.from("invoice_scan_pages")
    .select("scan_item_id")
    .eq("user_id", userId)
    .in("scan_item_id", itemIds);

  if(pagesError){
    throw new Error(pagesError.message || "שגיאה בטעינת עמודי חשבוניות לבדיקה");
  }

  const pageCountByItemId = new Map();
  (pages || []).forEach(page => {
    const currentCount = pageCountByItemId.get(page.scan_item_id) || 0;
    pageCountByItemId.set(page.scan_item_id, currentCount + 1);
  });

  const rows = itemRows.map(item => ({
    batchId: item.batch_id,
    scanItemId: item.id,
    itemOrder: item.item_order,
    label: `חשבונית ${item.item_order}`,
    ...formatReviewCaptureDateTime(item.invoice_scan_batches?.completed_at),
    completedAt: item.invoice_scan_batches?.completed_at || "",
    pageCount: pageCountByItemId.get(item.id) || 0
  }));

  rows.sort((a,b) => {
    const aTime = Date.parse(a.completedAt || "");
    const bTime = Date.parse(b.completedAt || "");
    const aHasTime = Number.isFinite(aTime);
    const bHasTime = Number.isFinite(bTime);

    if(aHasTime && bHasTime && aTime !== bTime){
      return aTime - bTime;
    }

    if(aHasTime !== bHasTime){
      return aHasTime ? -1 : 1;
    }

    if(a.itemOrder !== b.itemOrder){
      return a.itemOrder - b.itemOrder;
    }

    if(a.batchId !== b.batchId){
      return String(a.batchId).localeCompare(String(b.batchId));
    }

    return String(a.scanItemId).localeCompare(String(b.scanItemId));
  });

  return rows;
}

async function loadBatchReviewListRows(batchId){
  return loadPendingReviewRows({batchId});
}

async function init(){
  setupFieldValidationAccessibility();
  showLoading();
  try{
    const response = await fetch("/api/config");
    const config = await response.json();
    if(!response.ok) throw new Error(config.detail || "שגיאת הגדרה");

    sb = window.supabase.createClient(config.supabase_url, config.supabase_anon_key);

    sb.auth.onAuthStateChange(async(_, next) => {
      if(!initialSessionChecked) return;
      session = next;
      if(next) await enterApp(); else showAuth();
    });

    const {data:{session:current}} = await sb.auth.getSession();
    session = current;

    if(session) await enterApp(); else showAuth();

    if("serviceWorker" in navigator){
      navigator.serviceWorker.register("/service-worker.js").catch(console.error);
    }
  }catch(error){
    setStatus($("loginStatus"), error.message, "error");
    if(!session) showAuth();
  } finally {
    initialSessionChecked = true;
    hideLoading();
  }
}

function showAuth(){
  clearFormFieldValidation($("loginForm"));
  clearFormFieldValidation($("signupForm"));
  $("loginEmail").value = "";
  $("loginPassword").value = "";
  $("signupEmail").value = "";
  $("signupPassword").value = "";
  setStatus($("loginStatus"), "", "");
  setStatus($("signupStatus"), "", "");
  $("authScreen").classList.remove("hidden");
  $("appShell").classList.add("hidden");
  $("loginEmail").focus();
}

async function enterApp(){
  userId = session.user.id;
  $("authScreen").classList.add("hidden");
  $("appShell").classList.remove("hidden");

  const initialViewId = getSavedViewId() || ROOT_VIEW_ID;
  activateView(ROOT_VIEW_ID, {historyMode: "replace", resetScroll: false});
  if(initialViewId !== ROOT_VIEW_ID){
    activateView(initialViewId, {historyMode: "push", resetScroll: false});
  }
  resetViewScrollPosition();

  await loadBusiness();
  void flushPendingExpenseStorageCleanup();
  await loadLookups();
  await Promise.all([loadDashboard(), loadExpenses(), loadZReports(), loadEmployees(), loadIncomeTypeSuggestions()]);
  void refreshPendingInvoiceCountIndicator();
  void resumeDurableInvoiceCheckpoints();
}

function setTabSelection(tabs, activeTabId){
  tabs.forEach(tab => {
    const isActive = tab.id === activeTabId;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
    tab.setAttribute("tabindex", isActive ? "0" : "-1");
  });
}

function setAuthTab(activeTabId){
  const showLogin = activeTabId !== "signupTab";
  $("loginForm").classList.toggle("hidden", !showLogin);
  $("signupForm").classList.toggle("hidden", showLogin);
  setTabSelection([$("loginTab"), $("signupTab")], showLogin ? "loginTab" : "signupTab");
}

function setAlTab(activeTabId){
  const showInsights = activeTabId !== "chatTab";
  $("insightsPane").classList.toggle("hidden", !showInsights);
  $("chatPane").classList.toggle("hidden", showInsights);
  setTabSelection([$("insightsTab"), $("chatTab")], showInsights ? "insightsTab" : "chatTab");
}

function setupManualTablist(tabIds, activateTab){
  const tabs = tabIds.map(id => $(id)).filter(Boolean);
  if(tabs.length < 2) return;

  const tablist = tabs[0].closest('[role="tablist"]');
  if(!tablist || tablist.dataset.keyboardBound === "true") return;
  tablist.dataset.keyboardBound = "true";

  const isRtl = () => {
    const direction = tablist ? getComputedStyle(tablist).direction : document.dir || "ltr";
    return direction === "rtl";
  };

  const focusTabAt = index => {
    const nextIndex = (index + tabs.length) % tabs.length;
    tabs[nextIndex].focus();
  };

  tabs.forEach(tab => {
    tab.addEventListener("click", () => activateTab(tab.id));
    tab.addEventListener("keydown", event => {
      const currentIndex = tabs.indexOf(tab);
      if(currentIndex === -1) return;

      if(event.key === "ArrowRight"){
        event.preventDefault();
        focusTabAt(currentIndex + (isRtl() ? -1 : 1));
        return;
      }

      if(event.key === "ArrowLeft"){
        event.preventDefault();
        focusTabAt(currentIndex + (isRtl() ? 1 : -1));
        return;
      }

      if(event.key === "Home"){
        event.preventDefault();
        focusTabAt(0);
        return;
      }

      if(event.key === "End"){
        event.preventDefault();
        focusTabAt(tabs.length - 1);
        return;
      }

      if(event.key === "Enter" || event.key === " "){
        event.preventDefault();
        activateTab(tab.id);
      }
    });
  });
}

function setupDashboardCardNavigation(){
  document.querySelectorAll("[data-dashboard-view]").forEach(card => {
    const targetView = card.dataset.dashboardView;
    if(!AVAILABLE_VIEWS.includes(targetView)) return;

    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.classList.add("dashboard-nav-card-enabled");

    const dashboardLabel = String(card.dataset.dashboardLabel || "").trim();
    if(dashboardLabel){
      card.setAttribute("aria-label", `מעבר אל ${dashboardLabel}`);
    }

    const navigateToDashboardDestination = () => {
      activateView(targetView);
      if(targetView === "alView" && card.dataset.dashboardAlTab){
        setAlTab(card.dataset.dashboardAlTab);
      }
    };

    card.addEventListener("click", event => {
      navigateToDashboardDestination();
    });

    card.addEventListener("keydown", event => {
      if(event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      navigateToDashboardDestination();
    });
  });
}

setupManualTablist(["loginTab","signupTab"], setAuthTab);
setupManualTablist(["insightsTab","chatTab"], setAlTab);
setupDashboardCardNavigation();
setAuthTab($("signupTab").classList.contains("active") ? "signupTab" : "loginTab");
setAlTab($("chatTab").classList.contains("active") ? "chatTab" : "insightsTab");

$("loginForm").onsubmit = async event => {
  event.preventDefault();
  clearFormFieldValidation(event.target);
  const {error} = await sb.auth.signInWithPassword({
    email:$("loginEmail").value.trim(),
    password:$("loginPassword").value
  });
  if(error) setStatus($("loginStatus"), error.message, "error");
};

$("signupForm").onsubmit = async event => {
  event.preventDefault();
  clearFormFieldValidation(event.target);
  const {error} = await sb.auth.signUp({
    email:$("signupEmail").value.trim(),
    password:$("signupPassword").value
  });

  setStatus(
    $("signupStatus"),
    error ? error.message : "נשלח מייל לאימות החשבון",
    error ? "error" : "ok"
  );
};

$("forgotPassword").onclick = async () => {
  const emailField = $("loginEmail");
  const email = emailField.value.trim();

  if(!email){
    setFieldInvalid(emailField, "הזיני מייל");
    emailField.focus();
    setStatus($("loginStatus"), "", "");
    return;
  }

  if(!emailField.checkValidity()){
    setFieldInvalid(emailField, emailField.validationMessage || "יש להזין מייל תקין");
    emailField.focus();
    setStatus($("loginStatus"), "", "");
    return;
  }

  clearFieldInvalid(emailField);

  const {error} = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: location.origin
  });

  setStatus(
    $("loginStatus"),
    error ? error.message : "נשלח קישור לאיפוס סיסמה",
    error ? "error" : "ok"
  );
};

async function loadBusiness(){
  const {data,error} = await sb.from("businesses")
    .select("*")
    .eq("user_id",userId)
    .maybeSingle();

  if(error) console.error(error);

  business = data || {};
  $("businessTitle").textContent = business.business_name || "העסק שלי";
  fillBusinessForm();
  if(!business.business_name) $("businessDialog").showModal();
}

function fillBusinessForm(){
  $("businessName").value = business.business_name || "";
  $("businessRegistration").value = business.registration_number || "";
  $("businessField").value = business.business_field || "";
  $("businessDate").value = business.established_date || "";
  $("businessContact").value = business.contact_name || "";
  $("businessPhone").value = business.contact_phone || "";
  $("businessAddress").value = business.address || "";
}

$("businessForm").onsubmit = async event => {
  event.preventDefault();
  clearFormFieldValidation(event.target);

  const payload = {
    user_id:userId,
    business_name:$("businessName").value.trim(),
    registration_number:$("businessRegistration").value.trim(),
    business_field:$("businessField").value.trim(),
    established_date:$("businessDate").value || null,
    contact_name:$("businessContact").value.trim(),
    contact_phone:$("businessPhone").value.trim(),
    address:$("businessAddress").value.trim()
  };

  const {data,error} = await sb.from("businesses")
    .upsert(payload,{onConflict:"user_id"})
    .select()
    .single();

  if(error) return setStatus($("businessStatus"), error.message, "error");

  business = data;
  $("businessTitle").textContent = business.business_name;
  setStatus($("businessStatus"), "נשמר", "ok");
  setTimeout(() => $("businessDialog").close(), 450);
};

$("logoutButton").onclick = async () => {
  const result = await sb.auth.signOut().catch(error => ({ error }));
  const error = result?.error;

  if($("businessDialog") && $("businessDialog").open){
    $("businessDialog").close();
  }

  session = null;
  userId = null;
  clearSavedViewId();
  activateView(ROOT_VIEW_ID, {historyMode: "replace", resetScroll: false});
  showAuth();

  if(error){
    setStatus($("businessStatus"), error.message || "שגיאה ביציאה", "error");
  }
};

async function loadLookups(){
  const lookups = [
    ["accounting_types","expenseAccountingType"],
    ["categories","expenseCategory"],
    ["projects","expenseProject"],
    ["projects","zProject"],
    ["payment_sources","expensePaymentSource"],
    ["payment_methods","expensePaymentMethod"]
  ];

  for(const [table,id] of lookups){
    const {data,error} = await sb.from(table)
      .select("id,name")
      .eq("user_id",userId)
      .eq("is_active",true)
      .order("sort_order");

    if(error){
      setStatus($(id), `שגיאה בטעינת ${table}`, "error");
      $(id).innerHTML = '<option value="">לא ניתן לטעון</option>';
      continue;
    }

    const items = data || [];
    $(id).innerHTML = '<option value="">ללא בחירה</option>' + items.map(x => `<option value="${x.id}">${x.name}</option>`).join("");
  }

  const {data:settings} = await sb.from("business_settings")
    .select("*")
    .eq("user_id",userId)
    .maybeSingle();

  if(settings){
    $("expenseProject").value = settings.default_project_id || "";
    $("zProject").value = settings.default_project_id || "";
    $("expenseAccountingType").value = settings.default_accounting_type_id || "";
  }
}

async function loadDashboard(){
  const year = currentYear();
  const from = yearStart(year);
  const to = yearEnd(year);
  const monthFrom = monthStart();
  const monthTo = monthEnd();

  const [{data:expensesYear}, incomeYearTotal, {data:expensesMonth}, incomeMonthTotal] = await Promise.all([
    sb.from("expenses")
      .select("gross_ils")
      .eq("user_id",userId)
      .gte("document_date",from)
      .lte("document_date",to),
    fetchIncomeTotalInDateRange(from, to),
    sb.from("expenses")
      .select("gross_ils")
      .eq("user_id",userId)
      .gte("document_date",monthFrom)
      .lte("document_date",monthTo),
    fetchIncomeTotalInDateRange(monthFrom, monthTo)
  ]);

  const expenseYearTotal = (expensesYear || []).reduce((s,x)=>s+Number(x.gross_ils || 0),0);
  const expenseMonthTotal = (expensesMonth || []).reduce((s,x)=>s+Number(x.gross_ils || 0),0);

  $("incomeMonthMetric").textContent = money(incomeMonthTotal);
  $("expenseMonthMetric").textContent = money(expenseMonthTotal);
  $("incomeYearMetric").textContent = money(incomeYearTotal);
  $("expenseYearMetric").textContent = money(expenseYearTotal);
  $("profitYearMetric").textContent = money(incomeYearTotal-expenseYearTotal);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate()-1);
  const y = yesterday.toISOString().slice(0,10);

  const {data:zYesterday} = await sb.from("daily_z_reports")
    .select("id")
    .eq("user_id",userId)
    .eq("is_from_z_report", true)
    .eq("report_date",y);

  const missing = !(zYesterday || []).length;
  $("homeInsight").textContent = missing
    ? "לא הוזן דו״ח Z של אתמול."
    : "אין כרגע תובנה דחופה.";

  $("insightsList").innerHTML =
    (missing ? '<div>🔴 לא הוזן דו״ח Z של אתמול.</div><hr>' : "") +
    `<div>🟢 מצב העסק: הכנסות החודש ${money(incomeMonthTotal)}, הוצאות החודש ${money(expenseMonthTotal)}.</div>`;
}

function readExpensePermissions(expenseRecord){
  const hasExpense = Boolean(String(expenseRecord?.id || "").trim());
  return {
    canEdit: hasExpense,
    canDelete: hasExpense
  };
}

function expenseDisplayValue(value, fallback = "-"){
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function setExpenseDetailsValue(id, value, fallback = "-"){
  const el = $(id);
  if(!el) return;
  el.textContent = expenseDisplayValue(value, fallback);
}

function isFixedAssetAccountingTypeName(name){
  const normalized = String(name || "")
    .replace(/\s+/g, " ")
    .trim();

  if(!normalized) return false;
  if(normalized === "רכוש קבוע") return true;

  return normalized.includes("רכוש") && normalized.includes("קבוע");
}

function shouldShowExpenseAssetFollowupFromForm(){
  const select = $("expenseAccountingType");
  if(!select) return false;

  const selectedName = select.options?.[select.selectedIndex]?.textContent || "";
  return isFixedAssetAccountingTypeName(selectedName);
}

function populateExpenseFormFromExistingExpense(expenseRecord){
  if(!expenseRecord) return;

  $("expenseDate").value = expenseRecord.document_date || "";
  $("expenseGross").value = Number(expenseRecord.gross_ils || 0) || "";
  $("expenseSupplier").value = expenseRecord.supplier_name_snapshot || "";
  $("expenseSupplierReg").value = expenseRecord.supplier_registration_snapshot || "";
  $("expenseDocumentNumber").value = expenseRecord.document_number || "";
  $("expenseAccountingType").value = expenseRecord.accounting_type_id || "";
  $("expenseCategory").value = expenseRecord.category_id || "";
  $("expenseProject").value = expenseRecord.project_id || "";
  $("expensePaymentSource").value = expenseRecord.payment_source_id || "";
  $("expensePaymentMethod").value = expenseRecord.payment_method_id || "";
  $("expenseDescription").value = expenseRecord.description || "";
  $("expenseNotes").value = expenseRecord.notes || "";
}

function renderExpenseDetailsReadOnly(expenseRecord){
  if(!expenseRecord) return;

  const accountingTypeName = expenseRecord.accounting_types?.name || "";
  const debitCreditValue = expenseRecord.debit_credit || expenseRecord.debit_or_credit || "";
  setExpenseDetailsValue("expenseDetailsSupplier", expenseRecord.supplier_name_snapshot);
  setExpenseDetailsValue("expenseDetailsSupplierReg", expenseRecord.supplier_registration_snapshot, "ללא מספר זיהוי ספק");
  setExpenseDetailsValue("expenseDetailsDocumentNumber", expenseRecord.document_number);
  setExpenseDetailsValue("expenseDetailsDate", expenseRecord.document_date);
  setExpenseDetailsValue("expenseDetailsDescription", expenseRecord.description);
  setExpenseDetailsValue("expenseDetailsNotes", expenseRecord.notes, "ללא הערות");
  setExpenseDetailsValue("expenseDetailsGross", money(expenseRecord.gross_ils || 0));
  setExpenseDetailsValue("expenseDetailsNet", money(expenseRecord.net_ils || 0));
  setExpenseDetailsValue("expenseDetailsVat", money(expenseRecord.vat_ils || 0));
  setExpenseDetailsValue("expenseDetailsAccountingType", accountingTypeName);
  setExpenseDetailsValue("expenseDetailsDebitCredit", debitCreditValue, "לא צוין");
  setExpenseDetailsValue("expenseDetailsCategory", expenseRecord.categories?.name);
  setExpenseDetailsValue("expenseDetailsProject", expenseRecord.projects?.name);
  setExpenseDetailsValue("expenseDetailsPaymentSource", expenseRecord.payment_sources?.name);
  setExpenseDetailsValue("expenseDetailsPaymentMethod", expenseRecord.payment_methods?.name);
}

function setExpenseDialogMode(mode){
  currentExpenseDialogMode = mode;

  const title = $("expenseDialogTitle");
  const detailsView = $("expenseDetailsView");
  const detailsActions = $("expenseDialogHeaderActions");
  const expenseForm = $("expenseForm");
  const deferButton = $("expenseFormDeferButton");
  const submitButton = expenseForm?.querySelector('button[type="submit"], button:not([type])');

  if(mode === EXPENSE_DIALOG_MODES.NEW){
    detailsView?.classList.add("hidden");
    detailsActions?.classList.add("hidden");
    if(title) title.textContent = "הוצאה חדשה";
    if(deferButton){
      deferButton.textContent = "אבדוק מאוחר יותר";
      deferButton.classList.remove("hidden");
    }
    if(submitButton) submitButton.textContent = "שמרי חשבונית בהוצאות";
    return;
  }

  [
    $("expenseFilePreview"),
    $("expenseExtractedPreview"),
    $("expensePendingChoice"),
    $("expenseGroupingGate"),
    $("expenseManualGroupingWorkspace"),
    $("expenseReviewList"),
    $("expenseReviewContext"),
    $("expenseReviewPosition")?.closest(".review-item-nav"),
    document.querySelector("#expenseDialog .file-actions"),
    document.querySelector("#expenseDialog .expense-actions")
  ].forEach(section => section?.classList.add("hidden"));

  setStatus($("expenseStatus"), "", "");
  if(title) title.textContent = "פרטי הוצאה";
  detailsActions?.classList.remove("hidden");
  if(detailsView) detailsView.classList.toggle("hidden", mode !== EXPENSE_DIALOG_MODES.DETAILS_READONLY);
  if(expenseForm) expenseForm.classList.toggle("hidden", mode !== EXPENSE_DIALOG_MODES.DETAILS_EDIT);

  if(deferButton) deferButton.classList.add("hidden");
  if(submitButton){
    submitButton.textContent = mode === EXPENSE_DIALOG_MODES.DETAILS_EDIT
      ? "שמרי שינויים"
      : "שמרי חשבונית בהוצאות";
  }

  const editButton = $("expenseDetailsEditButton");
  const deleteButton = $("expenseDetailsDeleteButton");
  if(editButton) editButton.disabled = !currentExpensePermissions.canEdit || mode === EXPENSE_DIALOG_MODES.DETAILS_EDIT;
  if(deleteButton) deleteButton.disabled = !currentExpensePermissions.canDelete;
}

async function getExpenseRecordForDetails(expenseId){
  const safeExpenseId = String(expenseId || "").trim();
  if(!safeExpenseId) return null;

  const {data, error} = await sb.from("expenses")
    .select(`
      *,
      accounting_types(name),
      categories(name),
      projects(name),
      payment_sources(name),
      payment_methods(name)
    `)
    .eq("user_id", userId)
    .eq("id", safeExpenseId)
    .maybeSingle();

  if(error) throw error;
  return data || null;
}

async function openExpenseDetailsDialog(expenseId){
  try {
    const expenseRecord = await getExpenseRecordForDetails(expenseId);
    if(!expenseRecord){
      showToast("ההוצאה לא נמצאה", "error");
      return;
    }

    resetExpenseDialogState();
    currentExpenseDetailsRecord = expenseRecord;
    currentExpenseEditId = expenseRecord.id;
    currentExpensePermissions = readExpensePermissions(expenseRecord);
    renderExpenseDetailsReadOnly(expenseRecord);
    setExpenseDialogMode(EXPENSE_DIALOG_MODES.DETAILS_READONLY);
    $("expenseDialog")?.showModal();
  } catch(error){
    console.error(error);
    showToast(error?.message || "שגיאה בטעינת פרטי הוצאה", "error");
  }
}

function startEditingCurrentExpense(){
  if(!currentExpenseDetailsRecord || !currentExpensePermissions.canEdit) return;
  clearFormFieldValidation($("expenseForm"));
  populateExpenseFormFromExistingExpense(currentExpenseDetailsRecord);
  setExpenseDialogMode(EXPENSE_DIALOG_MODES.DETAILS_EDIT);
}

async function confirmAndDeleteCurrentExpense(){
  if(!currentExpenseDetailsRecord || !currentExpensePermissions.canDelete) return;
  if(!window.confirm("למחוק את ההוצאה? הפעולה אינה ניתנת לביטול.")) return;

  const expenseId = String(currentExpenseDetailsRecord.id || "").trim();
  if(!expenseId) return;

  try {
    const {data:deleteResult, error:deleteError} = await sb.rpc(
      "delete_expense_atomic",
      {p_expense_id: expenseId}
    );

    if(deleteError){
      throw deleteError;
    }

    const deleteRow = Array.isArray(deleteResult) ? deleteResult[0] : deleteResult;
    if(!deleteRow?.deleted_expense_id){
      throw new Error("תשובת מחיקת ההוצאה אינה תקינה");
    }

    const storagePaths = (Array.isArray(deleteRow.storage_paths) ? deleteRow.storage_paths : [])
      .map(path => String(path || "").trim())
      .filter(Boolean);

    if(storagePaths.length){
      const cleanupError = await cleanupUploadedExpenseFiles(storagePaths);
      if(cleanupError){
        enqueuePendingExpenseStorageCleanup(storagePaths);
      }
    }

    $("expenseDialog")?.close();
    await Promise.all([loadExpenses(), loadDashboard()]);
    if(storagePaths.length && getPendingExpenseStorageCleanupPaths().length){
      showToast("ההוצאה נמחקה. ניקוי קבצי המסמך יושלם אוטומטית.", "ok");
    } else {
      showToast("ההוצאה נמחקה", "ok");
    }
  } catch(error){
    console.error(error);
    showToast(error?.message || "שגיאה במחיקת הוצאה", "error");
  }
}

async function loadExpenses(){
  const {data,error} = await sb.from("expenses")
    .select(`
      id,
      document_date,
      gross_ils,
      supplier_name_snapshot,
      accounting_types(name),
      payment_sources(name),
      expense_documents(id,storage_path,document_type,page_number)
    `)
    .eq("user_id",userId)
    .order("document_date",{ascending:false})
    .limit(100);

  if(error){
    $("expensesTable").textContent = error.message;
    return;
  }

  if(!(data || []).length){
    $("expensesTable").textContent = "אין עדיין הוצאות";
    return;
  }

  $("expensesTable").innerHTML = `
    <table aria-label="טבלת הוצאות">
      <thead>
        <tr>
          <th scope="col" aria-label="פעולות צפייה במסמכים">👁</th>
          <th scope="col">תאריך</th>
          <th scope="col">סכום</th>
          <th scope="col">ספק</th>
          <th scope="col">סוג חשבונאי</th>
          <th scope="col">מקור תשלום</th>
        </tr>
      </thead>
      <tbody>
        ${(data || []).map(row => `
          <tr class="expense-row" data-expense="${row.id}" tabindex="0" role="button" aria-label="פתיחת פרטי הוצאה">
            <td><button class="eye eye-expense" type="button" data-expense="${row.id}" aria-label="צפייה במסמכי הוצאה">👁</button></td>
            <td>${row.document_date || ""}</td>
            <td>${money(row.gross_ils)}</td>
            <td>${row.supplier_name_snapshot || ""}</td>
            <td>${row.accounting_types?.name || ""}</td>
            <td>${row.payment_sources?.name || ""}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  document.querySelectorAll(".eye-expense").forEach(btn => {
    btn.onclick = event => {
      event.stopPropagation();
      void openExpenseDocument(btn.dataset.expense);
    };
  });

  document.querySelectorAll(".expense-row[data-expense]").forEach(row => {
    row.onclick = () => {
      void openExpenseDetailsDialog(row.dataset.expense);
    };
    row.onkeydown = event => {
      if(event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      void openExpenseDetailsDialog(row.dataset.expense);
    };
  });
}

async function openExpenseDocument(expenseId){
  const {data,error} = await sb.from("expense_documents")
    .select("storage_path,document_type,page_number")
    .eq("user_id",userId)
    .eq("expense_id",expenseId)
    .order("page_number");

  if(error || !(data || []).length){
    alert("לא נמצא צילום לחשבונית");
    return;
  }

  const chosen = data.find(x => x.document_type === "pdf") || data[0];

  const {data:signed,error:signError} = await sb.storage
    .from("invoice-documents")
    .createSignedUrl(chosen.storage_path,60);

  if(signError){
    alert(signError.message);
    return;
  }

  window.open(signed.signedUrl,"_blank","noopener,noreferrer");
}

function setZViewerDocuments(documents){
  currentZDocuments = Array.isArray(documents) ? documents : [];
  currentZDocumentIndex = currentZDocuments.length ? 0 : -1;
  currentZViewerDocument = null;
  updateZViewerNavigation();
}

function updateZViewerNavigation(){
  const total = currentZDocuments.length;
  const hasDocs = total > 0;
  const index = hasDocs ? Math.min(Math.max(0, currentZDocumentIndex), total - 1) : -1;

  const prev = $("zDocumentsPrev");
  const next = $("zDocumentsNext");
  const pos = $("zDocumentsPosition");
  const openFullscreen = $("zDocumentsFullscreenOpen");
  const fullscreenNav = $("zDocumentsFullscreenPageNav");
  const fullscreenPrev = $("zDocumentsFullscreenPrev");
  const fullscreenNext = $("zDocumentsFullscreenNext");

  if(prev) prev.disabled = !hasDocs || index <= 0;
  if(next) next.disabled = !hasDocs || index >= total - 1;
  if(pos) pos.textContent = hasDocs ? `מסמך ${index + 1} מתוך ${total}` : "";

  const canOpenFullscreen = Boolean(currentZViewerDocument?.signedUrl && currentZViewerDocument?.mime_type);
  if(openFullscreen){
    openFullscreen.classList.toggle("hidden", !canOpenFullscreen);
    openFullscreen.disabled = !canOpenFullscreen;
  }

  const hasMulti = total > 1;
  if(fullscreenNav) fullscreenNav.classList.toggle("hidden", !hasMulti);
  if(fullscreenPrev) fullscreenPrev.disabled = !hasMulti || index <= 0;
  if(fullscreenNext) fullscreenNext.disabled = !hasMulti || index >= total - 1;
}

function renderZViewerState({message = "", isError = false} = {}){
  const panel = $("zDocumentsViewerPanel");
  if(!panel) return;
  panel.innerHTML = "";
  const text = document.createElement("p");
  text.className = isError ? "review-document-state error" : "review-document-state";
  text.textContent = message || "אין מסמך להצגה.";
  panel.appendChild(text);
}

function renderZViewerFile({signedUrl, mimeType}){
  const panel = $("zDocumentsViewerPanel");
  if(!panel) return;
  panel.innerHTML = "";

  if(String(mimeType || "").toLowerCase().startsWith("image/")){
    const image = document.createElement("img");
    image.src = signedUrl;
    image.alt = "מסמך הכנסה";
    image.title = "פתחי במסך מלא";
    image.style.cursor = "pointer";
    image.tabIndex = 0;
    image.addEventListener("click", () => {
      zDocumentsFullscreenOpener = image;
      openZDocumentsFullscreen();
    });
    image.addEventListener("keydown", event => {
      if(event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      zDocumentsFullscreenOpener = image;
      openZDocumentsFullscreen();
    });
    panel.appendChild(image);
    return;
  }

  const frame = document.createElement("iframe");
  frame.src = signedUrl;
  frame.title = "מסמך הכנסה";
  frame.loading = "lazy";
  panel.appendChild(frame);
}

function renderZFullscreenContent(){
  const content = $("zDocumentsFullscreenContent");
  if(!content) return;
  content.innerHTML = "";

  if(!currentZViewerDocument?.signedUrl || !currentZViewerDocument?.mime_type){
    const text = document.createElement("p");
    text.className = "review-document-state";
    text.textContent = "אין מסמך להצגה.";
    content.appendChild(text);
    return;
  }

  if(String(currentZViewerDocument.mime_type || "").toLowerCase().startsWith("image/")){
    const image = document.createElement("img");
    image.src = currentZViewerDocument.signedUrl;
    image.alt = "מסמך הכנסה במסך מלא";
    image.style.maxWidth = "100%";
    image.style.maxHeight = "100%";
    image.style.objectFit = "contain";
    image.style.background = "#fff";
    content.appendChild(image);
    return;
  }

  const frame = document.createElement("iframe");
  frame.src = currentZViewerDocument.signedUrl;
  frame.title = "מסמך הכנסה במסך מלא";
  frame.loading = "lazy";
  content.appendChild(frame);
}

function openZDocumentsFullscreen(){
  if(!currentZViewerDocument?.signedUrl || !currentZViewerDocument?.mime_type) return;
  const dialog = $("zDocumentsFullscreenDialog");
  if(!dialog) return;
  renderZFullscreenContent();
  updateZViewerNavigation();
  dialog.showModal();
  $("zDocumentsFullscreenClose")?.focus();
}

function closeZDocumentsFullscreen({restoreFocus = true} = {}){
  const dialog = $("zDocumentsFullscreenDialog");
  if(dialog?.open) dialog.close();

  if(
    restoreFocus
    && zDocumentsFullscreenOpener
    && !zDocumentsFullscreenOpener.disabled
    && !zDocumentsFullscreenOpener.classList.contains("hidden")
  ){
    zDocumentsFullscreenOpener.focus();
  }
  zDocumentsFullscreenOpener = null;
}

async function getSignedUrlForZDocument(storagePath){
  const now = Date.now();
  const cached = zDocumentsSignedUrlCache.get(storagePath);
  if(cached && cached.expiresAt > (now + 2000)){
    return cached.signedUrl;
  }

  const {data:signed, error} = await sb.storage
    .from("invoice-documents")
    .createSignedUrl(storagePath, 60);

  if(error || !signed?.signedUrl){
    throw new Error(error?.message || "שגיאה בטעינת מסמך דו״ח Z");
  }

  zDocumentsSignedUrlCache.set(storagePath, {
    signedUrl: signed.signedUrl,
    expiresAt: now + 55000
  });

  return signed.signedUrl;
}

async function renderCurrentZDocument(){
  if(!currentZDocuments.length || currentZDocumentIndex < 0){
    renderZViewerState({message: "אין מסמכים להצגה."});
    updateZViewerNavigation();
    return;
  }

  const documentMeta = currentZDocuments[currentZDocumentIndex];
  if(!documentMeta?.storage_path){
    renderZViewerState({message: "מסמך לא תקין.", isError: true});
    updateZViewerNavigation();
    return;
  }

  const loadToken = ++zDocumentsLoadToken;
  renderZViewerState({message: "טוען מסמך..."});

  try {
    const signedUrl = await getSignedUrlForZDocument(documentMeta.storage_path);
    if(loadToken !== zDocumentsLoadToken) return;

    currentZViewerDocument = {
      ...documentMeta,
      signedUrl
    };

    renderZViewerFile({signedUrl, mimeType: documentMeta.mime_type});
    updateZViewerNavigation();

    if($("zDocumentsFullscreenDialog")?.open){
      renderZFullscreenContent();
    }
  } catch(error){
    if(loadToken !== zDocumentsLoadToken) return;
    console.error(error);
    currentZViewerDocument = null;
    renderZViewerState({message: error?.message || "שגיאה בטעינת מסמך", isError: true});
    updateZViewerNavigation();
  }
}

async function openZReportDocuments(zReportId, incomeType = ""){
  const safeReportId = String(zReportId || "").trim();
  if(!safeReportId) return;

  const label = String(incomeType || "").trim() || "הכנסה";
  if($("zDocumentsDialogTitle")) $("zDocumentsDialogTitle").textContent = `מסמכי ${label}`;
  if($("zDocumentsFullscreenTitle")) $("zDocumentsFullscreenTitle").textContent = `מסמך ${label} במסך מלא`;

  const {data, error} = await sb.from("z_report_documents")
    .select("id,storage_path,original_filename,mime_type,document_order")
    .eq("user_id", userId)
    .eq("z_report_id", safeReportId)
    .order("document_order", {ascending: true});

  if(error){
    setStatus($("zStatus"), error.message || "שגיאה בטעינת מסמכי הכנסה", "error");
    return;
  }

  const documents = Array.isArray(data) ? data : [];
  if(!documents.length){
    setStatus($("zStatus"), "אין מסמכים מצורפים להכנסה זו.", "error");
    return;
  }

  setZViewerDocuments(documents);
  renderZViewerState({message: "טוען מסמך..."});
  $("zDocumentsDialog")?.showModal();
  await renderCurrentZDocument();
}

function navigateZDocumentsByOffset(offset){
  if(!Number.isInteger(offset) || !offset || !currentZDocuments.length) return;

  const target = currentZDocumentIndex + offset;
  if(target < 0 || target >= currentZDocuments.length) return;

  currentZDocumentIndex = target;
  void renderCurrentZDocument();
}

function resetZDocumentsViewerState(){
  zDocumentsLoadToken += 1;
  currentZDocuments = [];
  currentZDocumentIndex = -1;
  currentZViewerDocument = null;
  closeZDocumentsFullscreen({restoreFocus: false});
  renderZViewerState({message: "אין מסמך להצגה."});
  updateZViewerNavigation();
  clearZSignedUrlCache();
}

async function deleteZReport(zReportId){
  const safeReportId = String(zReportId || "").trim();
  if(!safeReportId) return;
  if(!confirm("למחוק הכנסה זו?")) return;

  try {
    const {data:attachedDocuments, error:documentsLookupError} = await sb.from("z_report_documents")
      .select("storage_path")
      .eq("user_id", userId)
      .eq("z_report_id", safeReportId);

    if(documentsLookupError){
      throw documentsLookupError;
    }

    const storagePaths = (attachedDocuments || [])
      .map(item => item?.storage_path)
      .filter(Boolean);

    if(storagePaths.length){
      await sb.storage.from("invoice-documents").remove(storagePaths);
    }

    const {error} = await sb.from("daily_z_reports")
      .delete()
      .eq("user_id", userId)
      .eq("id", safeReportId);

    if(error){
      throw error;
    }

    await Promise.all([loadZReports(), loadDashboard(), loadIncomeTypeSuggestions()]);
    showToast("הכנסה נמחקה", "ok");
  } catch(error){
    console.error(error);
    showToast(error?.message || "שגיאה במחיקת הכנסה", "error");
  }
}

function startEditingZReport(button){
  const safeReportId = String(button?.dataset?.zReportId || "").trim();
  if(!safeReportId) return;

  resetZFileSelection();
  setZDialogEditMode({
    id: safeReportId,
    report_date: button.dataset.zReportDate || today(),
    report_time: button.dataset.zReportTime || currentTime(),
    total_income_ils: button.dataset.zReportTotal || "",
    income_type: button.dataset.zReportIncomeType || Z_INCOME_TYPE_DEFAULT,
    project_id: button.dataset.zReportProjectId || "",
    notes: button.dataset.zReportNotes || "",
    income_source: button.dataset.zReportIncomeSource || Z_REPORT_INCOME_SOURCE
  });
  populateZDialogFromReport({
    id: safeReportId,
    report_date: button.dataset.zReportDate || today(),
    report_time: button.dataset.zReportTime || currentTime(),
    total_income_ils: button.dataset.zReportTotal || "",
    income_type: button.dataset.zReportIncomeType || Z_INCOME_TYPE_DEFAULT,
    project_id: button.dataset.zReportProjectId || "",
    notes: button.dataset.zReportNotes || ""
  });
  $("zDialog")?.showModal();
}

async function loadZReports(){
  const {data,error} = await sb.from("daily_z_reports")
    .select("id,report_date,report_time,total_income_ils,income_type,notes,is_from_z_report,projects(id,name),z_report_documents(id)")
    .eq("user_id",userId)
    .order("report_date",{ascending:false})
    .order("report_time",{ascending:false, nullsFirst:false})
    .limit(60);

  if(error){
    $("zTable").textContent = error.message;
    return;
  }

  $("zTable").innerHTML = (data || []).length ? `
    <table class="income-table" aria-label="טבלת הכנסות">
      <thead>
        <tr>
          <th scope="col">תאריך</th>
          <th scope="col">שעה</th>
          <th scope="col">הכנסות</th>
          <th scope="col">סוג הכנסה</th>
          <th scope="col">פרויקט</th>
          <th scope="col" aria-label="מצב מסמכים">מסמכים</th>
          <th scope="col" aria-label="פעולות">פעולות</th>
        </tr>
      </thead>
      <tbody>
        ${(data || []).map(row => {
          const documentCount = Array.isArray(row.z_report_documents) ? row.z_report_documents.length : 0;
          const hasDocuments = documentCount > 0;
          const incomeType = normalizeIncomeType(row.income_type);
          const documentLabel = hasDocuments
            ? `פתיחת מסמכי הכנסה (${documentCount})`
            : "אין מסמכים מצורפים להכנסה";
          const reportTime = row.report_time ? String(row.report_time).slice(0,5) : "";

          return `
          <tr>
            <td>${row.report_date}</td>
            <td>${reportTime}</td>
            <td>${money(row.total_income_ils)}</td>
            <td>${incomeType}</td>
            <td>${row.projects?.name || ""}</td>
            <td>
              <button
                class="doc-indicator ${hasDocuments ? "active" : "inactive"}"
                type="button"
                ${hasDocuments ? `data-z-report-id="${row.id}" data-z-report-income-type="${incomeType.replace(/"/g, "&quot;")}"` : "disabled aria-disabled=\"true\""}
                aria-label="${documentLabel}"
                title="${documentLabel}">
                <span class="doc-indicator-icon">${hasDocuments ? "📎" : "📄"}</span>
                <span class="doc-indicator-text">${hasDocuments ? `(${documentCount})` : "(0)"}</span>
              </button>
            </td>
            <td>
              <div class="row-actions">
                <button
                  class="row-action edit-action"
                  type="button"
                  data-z-report-id="${row.id}"
                  data-z-report-date="${row.report_date}"
                  data-z-report-time="${reportTime}"
                  data-z-report-total="${Number(row.total_income_ils || 0)}"
                  data-z-report-income-type="${incomeType.replace(/"/g, "&quot;")}"
                  data-z-report-project-id="${row.projects?.id || ""}"
                  data-z-report-notes="${String(row.notes || "").replace(/"/g, "&quot;")}"
                  data-z-report-income-source="${row.is_from_z_report === false ? NON_Z_INCOME_SOURCE : Z_REPORT_INCOME_SOURCE}"
                  aria-label="עריכת הכנסה"
                  title="עריכת הכנסה">
                  ✏️
                </button>
                <button
                  class="row-action delete-action"
                  type="button"
                  data-z-report-id="${row.id}"
                  aria-label="מחיקת הכנסה"
                  title="מחיקת הכנסה">
                  ❌
                </button>
              </div>
            </td>
          </tr>
        `;
        }).join("")} 
      </tbody>
    </table>
  ` : "אין עדיין דו״חות Z";

  document.querySelectorAll(".doc-indicator[data-z-report-id]").forEach(button => {
    button.onclick = () => {
      void openZReportDocuments(button.dataset.zReportId || "", button.dataset.zReportIncomeType || "");
    };
  });

  document.querySelectorAll(".edit-action[data-z-report-id]").forEach(button => {
    button.onclick = () => startEditingZReport(button);
  });

  document.querySelectorAll(".delete-action[data-z-report-id]").forEach(button => {
    button.onclick = () => void deleteZReport(button.dataset.zReportId || "");
  });
}

async function loadIncomeTypeSuggestions(){
  incomeTypeSuggestions.clear();
  addIncomeTypeSuggestion(Z_INCOME_TYPE_DEFAULT);

  if(!sb || !userId){
    renderIncomeTypeSuggestionsPanel();
    return;
  }

  const {data, error} = await sb.from("daily_z_reports")
    .select("income_type")
    .eq("user_id", userId)
    .order("income_type", {ascending: true});

  if(error){
    console.error(error);
    renderIncomeTypeSuggestionsPanel();
    return;
  }

  (Array.isArray(data) ? data : []).forEach(row => addIncomeTypeSuggestion(row?.income_type));
  renderIncomeTypeSuggestionsPanel($("zIncomeType")?.value || "");
}

async function loadEmployees(){
  const {data,error} = await sb.from("employees")
    .select("full_name,employment_type,hourly_rate,monthly_salary,is_active")
    .eq("user_id",userId)
    .order("full_name");

  if(error){
    $("employeesTable").textContent = error.message;
    return;
  }

  $("employeesTable").innerHTML = (data || []).length ? `
    <table aria-label="טבלת צוות">
      <thead>
        <tr><th scope="col">שם</th><th scope="col">סוג העסקה</th><th scope="col">שכר</th><th scope="col">פעילה</th></tr>
      </thead>
      <tbody>
        ${(data || []).map(row => `
          <tr>
            <td>${row.full_name}</td>
            <td>${row.employment_type === "hourly" ? "שעתי" : "חודשי"}</td>
            <td>${row.employment_type === "hourly" ? money(row.hourly_rate)+"/שעה" : money(row.monthly_salary)}</td>
            <td>${row.is_active ? "כן" : "לא"}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  ` : "אין עדיין עובדות";
}

document.querySelectorAll(".bottom-nav button").forEach(button => {
  button.onclick = () => activateView(button.dataset.view);
});

$("viewBackButton").onclick = () => window.history.back();

$("quickAddButton").onclick = () => $("quickAddDialog").showModal();

document.querySelectorAll("[data-close]").forEach(button => {
  button.onclick = () => {
    const dialog = button.closest("dialog");
    if(!dialog) return;

    if(dialog.id === "expenseDialog" && isDeferredAnalyzeInFlight){
      setStatus($("expenseStatus"), "ממתינות לשמירת טיוטת המסמכים לפני יציאה בטוחה.", "error");
      return;
    }

    if(dialog.id === "expenseDialog" && !confirmManualGroupingDiscard()){
      return;
    }

    dialog.close();
  };
});

document.querySelectorAll("[data-action]").forEach(button => {
  button.onclick = () => openAction(button.dataset.action);
});

bindIncomeTypeSuggestionInteractions();

async function showExpensePendingEntryChoice(){
  try {
    const pendingRows = await loadPendingReviewRows();
    pendingExpenseEntryRows = pendingRows;
    updateExpensePendingCountIndicator(pendingRows.length);
    updateExpenseContinueLaterButtonState();

    if(!pendingRows.length){
      return;
    }

    setExpenseDialogPrimaryState(EXPENSE_DIALOG_PRIMARY_STATES.PENDING_CHOICE);
    showExpensePendingChoice(pendingRows.length);
  } catch(error){
    console.error(error);
    setStatus($("expenseStatus"), error?.message || "שגיאה בטעינת חשבוניות ממתינות", "error");
  }
}

async function openAction(action){
  $("quickAddDialog").close();

  if(action === "expense"){
    resetExpenseDialogState();
    const pendingRows = await loadPendingReviewRows();
    pendingExpenseEntryRows = pendingRows;
    updateExpensePendingCountIndicator(pendingRows.length);

    if(pendingRows.length){
      setExpenseDialogPrimaryState(EXPENSE_DIALOG_PRIMARY_STATES.PENDING_CHOICE);
      showExpensePendingChoice(pendingRows.length);
    } else {
      setExpenseDialogPrimaryState(EXPENSE_DIALOG_PRIMARY_STATES.UPLOAD);
    }

    $("expenseDialog").showModal();
  } else if(action === "z"){
    openNewIncomeDialog({source: Z_REPORT_INCOME_SOURCE});
  } else if(action === "income"){
    openNewIncomeDialog({source: NON_Z_INCOME_SOURCE});
  }else{
    alert("הפעולה תתווסף בעדכון הבא.");
  }
}

function openNewIncomeDialog({source = Z_REPORT_INCOME_SOURCE} = {}){
  resetZDialogMode();
  resetZFileSelection();
  currentZIncomeSource = normalizeIncomeSource(source);
  $("zForm")?.reset();
  $("zDate").value = today();
  $("zTime").value = currentTime();
  $("zIncomeType").value = Z_INCOME_TYPE_DEFAULT;
  $("zNotes").value = "";

  if(currentZIncomeSource === NON_Z_INCOME_SOURCE){
    const title = $("zDialogTitle");
    if(title) title.textContent = "הכנסה חדשה";
  }

  $("zDialog")?.showModal();
}

$("expenseDialog")?.addEventListener("cancel", event => {
  if(isDeferredAnalyzeInFlight){
    event.preventDefault();
    setStatus($("expenseStatus"), "ממתינות לשמירת טיוטת המסמכים לפני יציאה בטוחה.", "error");
    return;
  }

  if(confirmManualGroupingDiscard()) return;
  event.preventDefault();
});

$("expenseDialog")?.addEventListener("close", () => {
  closeExpenseReviewFullscreen({shouldRestoreFocus:false});
  resetExpenseDialogState();
});

$("zDialog")?.addEventListener("close", () => {
  pendingZReportId = "";
  setStatus($("zStatus"), "", "");

  if(!shouldResetZFormAfterClose){
    pendingZSuccessToastMessage = "";
    return;
  }

  const successMessage = pendingZSuccessToastMessage || "הכנסה חדשה נשמרה";
  pendingZSuccessToastMessage = "";

  setTimeout(() => {
    applyZDialogResetAndToast(successMessage);
  }, 0);
});

$("zForm")?.addEventListener("reset", () => {
  pendingZReportId = "";
  currentZReportEditId = "";
  currentZIncomeSource = Z_REPORT_INCOME_SOURCE;
  $("zIncomeType").value = Z_INCOME_TYPE_DEFAULT;
  $("zTime").value = currentTime();
  $("zNotes").value = "";
});

$("zDocumentsDialog")?.addEventListener("close", () => {
  resetZDocumentsViewerState();
});

$("zDocumentsFullscreenDialog")?.addEventListener("close", () => {
  if(
    zDocumentsFullscreenOpener
    && !zDocumentsFullscreenOpener.disabled
    && !zDocumentsFullscreenOpener.classList.contains("hidden")
  ){
    zDocumentsFullscreenOpener.focus();
  }
  zDocumentsFullscreenOpener = null;
});

$("zDocumentsFullscreenDialog")?.addEventListener("cancel", event => {
  event.preventDefault();
  closeZDocumentsFullscreen();
});

$("zDocumentsPrev")?.addEventListener("click", () => navigateZDocumentsByOffset(-1));
$("zDocumentsNext")?.addEventListener("click", () => navigateZDocumentsByOffset(1));
$("zDocumentsFullscreenOpen")?.addEventListener("click", () => {
  zDocumentsFullscreenOpener = $("zDocumentsFullscreenOpen") || null;
  openZDocumentsFullscreen();
});
$("zDocumentsFullscreenClose")?.addEventListener("click", () => closeZDocumentsFullscreen());
$("zDocumentsFullscreenPrev")?.addEventListener("click", () => navigateZDocumentsByOffset(-1));
$("zDocumentsFullscreenNext")?.addEventListener("click", () => navigateZDocumentsByOffset(1));

$("profileButton").onclick = () => $("businessDialog").showModal();
$("incomeNewButton")?.addEventListener("click", () => {
  openNewIncomeDialog({source: NON_Z_INCOME_SOURCE});
});

function renderSelectedFiles(){
  const preview = $("expenseFilePreview");
  if(!preview) return;

  if(!selectedFiles.length){
    preview.innerHTML = `<div class="file-preview-empty">לא נבחרו מסמכים.</div>`;
    return;
  }

  preview.innerHTML = selectedFiles.map((file,index) => {
    const fileName = file.name || "קובץ";
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(fileName);

    if(isPdf){
      return `
        <div class="file-preview-item" data-file-index="${index}">
          <div class="file-preview-card pdf">
            <div class="file-preview-icon">PDF</div>
          </div>
          <button type="button" class="file-remove" data-index="${index}" aria-label="הסר קובץ">✕</button>
        </div>`;
    }

    const previewUrl = getLocalFileObjectUrl(file) || "";
    return `
      <div class="file-preview-item" data-file-index="${index}">
        <div class="file-preview-card image">
          <img src="${previewUrl}" alt="${fileName}">
        </div>
        <button type="button" class="file-remove" data-index="${index}" aria-label="הסר קובץ">✕</button>
      </div>`;
  }).join("");

  preview.querySelectorAll(".file-remove").forEach(button => {
    button.onclick = () => removeSelectedFile(Number(button.dataset.index));
  });

  updateExpenseContinueLaterButtonState();
}

function removeSelectedFile(index){
  if(index < 0 || index >= selectedFiles.length) return;

  if(hasUnfinishedManualGroupingWork() && !confirmManualGroupingDiscard()){
    return;
  }

  clearLocalFileObjectUrl(selectedFiles[index]);
  selectedFiles.splice(index,1);
  clearPendingGroupingAnalysisResult();
  if(!selectedFiles.length){
    resetExpenseDialogState();
  } else {
    setStatus($("expenseStatus"), `${selectedFiles.length} קבצים נבחרו`, "ok");
  }
  renderSelectedFiles();
}

function updateFiles(input, mode){
  const newFiles = Array.from(input.files || []);

  if(hasUnfinishedManualGroupingWork() && !confirmManualGroupingDiscard()){
    input.value = "";
    return;
  }

  clearPendingGroupingAnalysisResult();

  if(mode === "single"){
    clearLocalFileObjectUrls();
    selectedFiles = newFiles.slice(0, 1);
  } else {
    const existingKeys = new Set(selectedFiles.map(file => getFileKey(file)));

    newFiles.forEach(file => {
      const key = getFileKey(file);
      if(!existingKeys.has(key)){
        selectedFiles.push(file);
        existingKeys.add(key);
      }
    });
  }

  input.value = "";

  const message = selectedFiles.length
    ? `${selectedFiles.length} קבצים נבחרו`
    : "לא נבחרו קבצים";

  setStatus(
    $("expenseStatus"),
    message,
    selectedFiles.length ? "ok" : ""
  );

  renderSelectedFiles();
}

$("singleCameraButton").onclick = event => {
  event.preventDefault();
  $("singleCameraInput").click();
};
$("multiCameraButton").onclick = event => {
  event.preventDefault();
  $("multiCameraInput").click();
};
$("browseButton").onclick = event => {
  event.preventDefault();
  $("browseInput").click();
};
$("zBrowseButton")?.addEventListener("click", event => {
  event.preventDefault();
  const input = $("zBrowseInput");
  if(!input) return;
  input.value = "";
  input.click();
});
$("singleCameraInput").onchange = event => updateFiles(event.currentTarget, "single");
$("multiCameraInput").onchange = event => updateFiles(event.currentTarget, "append");
$("browseInput").onchange = event => updateFiles(event.currentTarget, "append");
$("zBrowseInput")?.addEventListener("change", event => updateZFiles(event.currentTarget));

function resetExpenseDialogState(){
  selectedFiles = [];
  clearLocalFileObjectUrls();
  extractedPreviewSignedUrlCache.clear();
  expenseExtractedPreviewLoadToken += 1;
  resetScanOperationId();
  clearPendingGroupingAnalysisResult();
  expenseReviewLoadToken += 1;
  activeExpenseReviewContext = null;
  expenseReviewRows = [];
  pendingExpenseEntryRows = [];
  canDeferSingleExtractedInvoice = false;
  isDeferredAnalyzeInFlight = false;
  currentExpenseDialogMode = EXPENSE_DIALOG_MODES.NEW;
  currentExpenseDetailsRecord = null;
  currentExpenseEditId = "";
  currentExpensePermissions = {canEdit:true, canDelete:true};
  $("singleCameraInput").value = "";
  $("multiCameraInput").value = "";
  $("browseInput").value = "";
  clearExpenseInvoiceDerivedFields();
  renderSelectedFiles();
  setExpenseDialogPrimaryState(EXPENSE_DIALOG_PRIMARY_STATES.UPLOAD);
  setExpenseDialogMode(EXPENSE_DIALOG_MODES.NEW);
}

async function runAnalyzeFlow({
  mode = "review-now",
  files = null,
  operationId: providedOperationId = null,
  uploadedScanFiles: providedUploadedScanFiles = null,
  selectionSignature: providedSelectionSignature = null,
  onCheckpointSecured = null,
  checkpointOnly = false
} = {}){
  const runToken = ++currentAnalyzeRunToken;
  const filesToProcess = Array.isArray(files) ? files.slice() : selectedFiles.slice();
  if(!filesToProcess.length){
    setStatus($("expenseStatus"), "בחרי תמונה או PDF", "error");
    return null;
  }

  const isDeferredMode = mode === "defer-now" || mode === "defer-resume";
  const isResumeMode = mode === "defer-resume";

  if(mode === "defer-now"){
    isDeferredAnalyzeInFlight = true;
    updateExpenseContinueLaterButtonState();
    setStatus($("expenseStatus"), "שומרת טיוטה של המסמכים…", "");
  } else {
    const progressMessage = filesToProcess.length === 1
      ? "מחלצת נתונים מהחשבונית..."
      : "מחלצת נתונים מהחשבוניות...";
    setStatus($("expenseStatus"), progressMessage);
  }

  let operationId = String(providedOperationId || "").trim();
  let uploadedScanFiles = Array.isArray(providedUploadedScanFiles) ? providedUploadedScanFiles : null;
  let selectionSignature = String(providedSelectionSignature || "").trim();
  let checkpointSecured = isResumeMode;

  try {
    if(hasUnfinishedManualGroupingWork() && !confirmManualGroupingDiscard()){
      return null;
    }

    if(!operationId || !uploadedScanFiles){
      clearPendingGroupingAnalysisResult();
    }

    if(!selectionSignature){
      selectionSignature = await buildFileSelectionSignature(filesToProcess);
    }

    if(!operationId){
      operationId = getOrCreateScanOperationId(selectionSignature);
    }

    if(!uploadedScanFiles){
      uploadedScanFiles = await uploadScanFilesBeforeAnalyze(filesToProcess, operationId);
    }

    if(isDeferredMode && !isResumeMode){
      await upsertDurableScanCheckpoint({
        operationId,
        extractionMode: "all",
        uploadedScanFiles,
        selectionSignature
      });
      checkpointSecured = true;

      if(typeof onCheckpointSecured === "function"){
        try {
          onCheckpointSecured({operationId});
        } catch(error){
          console.error(error);
        }
      }
    }

    if(isDeferredMode){
      if(!isResumeMode){
        setStatus($("expenseStatus"), "טיוטת המסמכים נשמרה בבטחה. אפשר לצאת ולהמשיך מאוחר יותר.", "ok");
      }
      if(checkpointOnly){
        return {mode, operationId, uploadedScanFiles, selectionSignature, checkpointSecured: true};
      }
    }

    const formData = new FormData();
    filesToProcess.forEach(file => formData.append("files", file));
    formData.append("document_type", "invoice");
    formData.append("contract_version", "1");
    formData.append("operation_source", "web");
    formData.append("operation_id", operationId);
    formData.append("storage_metadata_json", JSON.stringify({
      storage_metadata_version: 1,
      files: uploadedScanFiles
    }));

    const response = await fetch("/api/analyze-invoice", {
      method: "POST",
      body: formData
    });

    const result = await response.json();

    if(runToken !== currentAnalyzeRunToken && mode === "review-now"){
      return null;
    }

    if(!response.ok){
      const mayFallbackToSingleItem = filesToProcess.length === 1;
      const persistedFallback = mayFallbackToSingleItem
        ? await tryPersistSingleInvoiceFallbackFromFailure(result, {openReviewList: !isDeferredMode})
        : false;

      if(persistedFallback){
        return {mode, operationId, status: "fallback-persisted"};
      }

      if(checkpointSecured){
        await markCheckpointTerminalFailure(operationId, result?.detail || "שגיאה בחילוץ");
      }

      setStatus($("expenseStatus"), result.detail || "שגיאה בחילוץ", "error");
      return null;
    }

    if(normalizeMultipleInvoicesFlag(result.multiple_invoices)){
      if(isLowConfidenceGroupingResult(result)){
        if(isDeferredMode){
          if(checkpointSecured){
            await markCheckpointTerminalFailure(operationId, "נדרש קיבוץ ידני לפני המשך עיבוד החשבוניות.");
          }
          setStatus($("expenseStatus"), "נדרשת פעולה ידנית להמשך הקיבוץ. הטיוטה נשמרה ותוכלי לחזור אליה מאוחר יותר.", "error");
          return null;
        }

        pendingGroupingAnalysisResult = result;
        expenseReviewRows = [];
        activeExpenseReviewContext = null;
        renderExpenseGroupingGate(result);
        setStatus($("expenseStatus"), "הקיבוץ האוטומטי לא אמין מספיק. נדרש קיבוץ ידני לפני המשך.", "error");
        return null;
      }

      const rpcInput = buildScanBatchRpcInput(result);
      if(!rpcInput){
        if(checkpointSecured){
          await markCheckpointTerminalFailure(operationId, "מבנה קיבוץ החשבוניות אינו תקין");
        }
        setStatus($("expenseStatus"), "מבנה קיבוץ החשבוניות אינו תקין", "error");
        return null;
      }

      const {data:batchResult, error:batchError} = await sb.rpc(
        "persist_invoice_scan_batch_atomic",
        rpcInput
      );

      if(batchError){
        if(checkpointSecured){
          await markCheckpointTerminalFailure(operationId, batchError.message || "שגיאה בשמירת הסריקה");
        }
        setStatus($("expenseStatus"), batchError.message || "שגיאה בשמירת הסריקה", "error");
        return null;
      }

      const batchRow = Array.isArray(batchResult) ? batchResult[0] : batchResult;
      if(!batchRow || !batchRow.batch_id){
        if(checkpointSecured){
          await markCheckpointTerminalFailure(operationId, "תשובת שמירת הסריקה אינה תקינה");
        }
        setStatus($("expenseStatus"), "תשובת שמירת הסריקה אינה תקינה", "error");
        return null;
      }

      if(isDeferredMode){
        void refreshPendingInvoiceCountIndicator();
        setStatus($("expenseStatus"), "החשבוניות נשמרו לבדיקה מאוחרת.", "ok");
        return {mode, operationId, status: "persisted"};
      }

      const reviewRows = await loadPendingReviewRows();
      clearPendingGroupingAnalysisResult();
      activeExpenseReviewContext = null;
      renderExpenseReviewList(reviewRows);
      void refreshPendingInvoiceCountIndicator();
      setStatus($("expenseStatus"), "החשבוניות נשמרו לבדיקה. הוצגה רשימת חשבוניות.", "ok");
      return {mode, operationId, status: "persisted"};
    }

    const singleInvoice = sanitizeSingleInvoiceResult(result);
    if(!singleInvoice){
      if(checkpointSecured){
        await markCheckpointTerminalFailure(operationId, "מבנה תשובת החילוץ לא תקין");
      }
      setStatus($("expenseStatus"), "מבנה תשובת החילוץ לא תקין", "error");
      return null;
    }

    const rpcInput = buildScanBatchRpcInput(result);
    if(!rpcInput){
      if(checkpointSecured){
        await markCheckpointTerminalFailure(operationId, "חסר מידע סריקה לשמירה אטומית");
      }
      setStatus($("expenseStatus"), "חסר מידע סריקה לשמירה אטומית", "error");
      return null;
    }

    const {data:batchResult, error:batchError} = await sb.rpc(
      "persist_invoice_scan_batch_atomic",
      rpcInput
    );

    if(batchError){
      if(checkpointSecured){
        await markCheckpointTerminalFailure(operationId, batchError.message || "שגיאה בשמירת סריקה");
      }
      setStatus($("expenseStatus"), batchError.message || "שגיאה בשמירת סריקה", "error");
      return null;
    }

    const batchRow = Array.isArray(batchResult) ? batchResult[0] : batchResult;
    if(!batchRow || !batchRow.batch_id){
      if(checkpointSecured){
        await markCheckpointTerminalFailure(operationId, "תשובת שמירת הסריקה אינה תקינה");
      }
      setStatus($("expenseStatus"), "תשובת שמירת הסריקה אינה תקינה", "error");
      return null;
    }

    if(isDeferredMode){
      canDeferSingleExtractedInvoice = false;
      void refreshPendingInvoiceCountIndicator();
      setStatus($("expenseStatus"), "החשבונית נשמרה לבדיקה מאוחרת.", "ok");
      return {mode, operationId, status: "persisted"};
    }

    canDeferSingleExtractedInvoice = true;
    setExpenseDialogPrimaryState(EXPENSE_DIALOG_PRIMARY_STATES.EXTRACTED_FORM);
    const didRenderLocalPreview = renderExpenseExtractedPreviewFromLocalFiles(filesToProcess);
    if(!didRenderLocalPreview){
      const firstPersistedPage = getSingleItemFirstPageForPreview(rpcInput);
      if(firstPersistedPage){
        void renderExpenseExtractedPreviewFromPersistedPage(firstPersistedPage);
      } else {
        renderExpenseExtractedPreviewState({message:"אין מסמך להצגה."});
      }
    }
    fillExpenseFormFromInvoice(singleInvoice);
    void refreshPendingInvoiceCountIndicator();
    setStatus($("expenseStatus"), "הנתונים חולצו. בדקי לפני שמירה.", "ok");
    return {mode, operationId, status: "persisted"};
  } catch(error){
    console.error(error);
    if(isDeferredMode && !checkpointSecured){
      const diagnostic = {
        stage: error?.diagnosticStage || "unknown",
        operation_id: error?.diagnosticOperationId || operationId || "",
        checkpointSecured,
        code: error?.diagnosticCode || error?.code || "",
        message: error?.message || "",
        details: error?.diagnosticDetails || error?.details || "",
        hint: error?.diagnosticHint || error?.hint || ""
      };

      console.error("defer_checkpoint_diagnostic", {
        stage: diagnostic.stage,
        operation_id: diagnostic.operation_id || null,
        checkpointSecured: diagnostic.checkpointSecured,
        code: diagnostic.code || null,
        message: diagnostic.message || null,
        details: diagnostic.details || null,
        hint: diagnostic.hint || null,
        rawError: error?.diagnosticRawError || error
      });

      const diagnosticText = [
        "[Temporary Diagnostic]",
        `stage: ${diagnostic.stage}`,
        `operation_id: ${diagnostic.operation_id || ""}`,
        `checkpointSecured: ${String(diagnostic.checkpointSecured)}`,
        `code: ${diagnostic.code || ""}`,
        `message: ${diagnostic.message || ""}`,
        `details: ${diagnostic.details || ""}`,
        `hint: ${diagnostic.hint || ""}`
      ].join("\n");

      setStatus(
        $("expenseStatus"),
        `טיוטת המסמכים לא נשמרה בבטחה. הישארי במסך ונסי שוב.\n\n${diagnosticText}`,
        "error"
      );
      return null;
    }

    if(checkpointSecured && operationId){
      await markCheckpointTerminalFailure(operationId, error?.message || "שגיאה בעיבוד הטיוטה");
      setStatus($("expenseStatus"), "טיוטת המסמכים נשמרה, אך העיבוד נעצר. אפשר לנסות שוב מאוחר יותר.", "error");
      return null;
    }

    setStatus($("expenseStatus"), error?.message || "שגיאה בחילוץ", "error");
    return null;
  } finally {
    if(mode === "defer-now"){
      isDeferredAnalyzeInFlight = false;
      updateExpenseContinueLaterButtonState();
    }
  }
}

async function resumeDurableInvoiceCheckpoints(){
  if(isCheckpointResumeRunning || !sb || !userId) return;
  isCheckpointResumeRunning = true;

  try {
    const checkpoints = await listRecoverableCheckpoints(5);
    for(const checkpoint of checkpoints){
      const operationId = String(checkpoint?.operation_id || "").trim();
      if(!operationId) continue;

      const files = await buildFilesFromCheckpoint(checkpoint);
      const uploadedScanFiles = getCheckpointStorageFiles(checkpoint);
      const selectionSignature = String(checkpoint?.checkpoint_payload?.selection_signature || "").trim();

      await runAnalyzeFlow({
        mode: "defer-resume",
        files,
        operationId,
        uploadedScanFiles,
        selectionSignature
      });
    }
  } catch(error){
    console.error(error);
  } finally {
    isCheckpointResumeRunning = false;
  }
}

$("analyzeButton").onclick = async () => {
  await runAnalyzeFlow({mode: "review-now"});
};

$("expensePendingContinue").onclick = async () => {
  let rows = pendingExpenseEntryRows.slice();

  if(!rows.length){
    try {
      rows = await loadPendingReviewRows();
      pendingExpenseEntryRows = rows;
    } catch(error){
      console.error(error);
      setStatus($("expenseStatus"), error?.message || "שגיאה בטעינת חשבוניות ממתינות", "error");
      return;
    }
  }

  hideExpensePendingChoice();

  if(!rows.length){
    setStatus($("expenseStatus"), "אין חשבוניות ממתינות לבדיקה.", "ok");
    return;
  }

  hideExpenseReviewContext();
  activeExpenseReviewContext = null;
  renderExpenseReviewList(rows);
};

$("expensePendingScanNew").onclick = () => {
  resetExpenseDialogState();
};

async function handleExpenseContinueLaterAction(){
  if(!confirmManualGroupingDiscard()) return;

  if(currentExpenseDialogPrimaryState === EXPENSE_DIALOG_PRIMARY_STATES.UPLOAD){
    void runAnalyzeFlow({
      mode: "defer-now",
      onCheckpointSecured: () => {
        $("expenseDialog")?.close();
      }
    });
    return;
  }

  if(currentExpenseDialogPrimaryState === EXPENSE_DIALOG_PRIMARY_STATES.REVIEW_CONTEXT){
    await deferActivePendingInvoiceAndOpenNext();
    return;
  }

  if(currentExpenseDialogPrimaryState === EXPENSE_DIALOG_PRIMARY_STATES.PENDING_REVIEW_LIST){
    await openNextPendingInvoice({sessionRows: expenseReviewRows.slice(), refreshWhenEmpty: true});
    return;
  }

  canDeferSingleExtractedInvoice = false;
  $("expenseDialog")?.close();
}

$("queueButton").onclick = () => {
  if($("queueButton").disabled) return;
  void handleExpenseContinueLaterAction();
};

$("expenseFormDeferButton").onclick = () => {
  void handleExpenseContinueLaterAction();
};

$("expenseDetailsEditButton").onclick = () => {
  startEditingCurrentExpense();
};

$("expenseDetailsDeleteButton").onclick = () => {
  void confirmAndDeleteCurrentExpense();
};

$("expenseDetailsViewDocumentButton").onclick = () => {
  const expenseId = String(currentExpenseDetailsRecord?.id || "").trim();
  if(!expenseId) return;
  void openExpenseDocument(expenseId);
};

$("expenseAssetFollowupCreateButton")?.addEventListener("click", () => {
  showToast("זמין בהמשך", "ok");
});

$("expenseReviewNavPrev").onclick = () => navigateExpenseReviewByOffset(-1);
$("expenseReviewNavNext").onclick = () => navigateExpenseReviewByOffset(1);
$("expenseReviewBackToList").onclick = () => returnToExpenseReviewList();
$("expenseReviewDiscardButton").onclick = () => {
  void confirmAndDiscardActiveReviewInvoice();
};
$("expenseReviewFullscreenPagePrev").onclick = () => navigateExpenseReviewFullscreenPageByOffset(-1);
$("expenseReviewFullscreenPageNext").onclick = () => navigateExpenseReviewFullscreenPageByOffset(1);
$("expenseReviewFullscreenOpen")?.addEventListener("click", () => openExpenseReviewFullscreen());
$("expenseReviewFullscreenClose").onclick = () => closeExpenseReviewFullscreen();
$("expenseManualGroupingConfirm").onclick = () => {
  void confirmManualGroupingAndContinue();
};

$("expenseReviewFullscreenDialog")?.addEventListener("close", () => {
  if(
    expenseReviewFullscreenOpener
    && !expenseReviewFullscreenOpener.disabled
    && !expenseReviewFullscreenOpener.classList.contains("hidden")
  ){
    expenseReviewFullscreenOpener.focus();
  }

  expenseReviewFullscreenOpener = null;
});

$("expenseReviewFullscreenDialog")?.addEventListener("cancel", event => {
  event.preventDefault();
  closeExpenseReviewFullscreen();
});

$("expenseForm").onsubmit = async event => {
  event.preventDefault();
  if(isExpenseSaving) return;
  clearFormFieldValidation(event.target);

  const isEditingDetailsMode = (
    currentExpenseDialogMode === EXPENSE_DIALOG_MODES.DETAILS_EDIT
    && Boolean(String(currentExpenseEditId || "").trim())
  );
  const shouldShowAssetFollowupAfterSave = !isEditingDetailsMode && shouldShowExpenseAssetFollowupFromForm();

  const submitButton = event.target.querySelector('button[type="submit"], button:not([type])');
  isExpenseSaving = true;
  if(submitButton) submitButton.disabled = true;

  try {
    if(!$("expenseAccountingType").value){
      setFieldInvalid($("expenseAccountingType"), "סוג חשבונאי הוא שדה חובה");
      $("expenseAccountingType").focus();
      setStatus($("expenseStatus"), "", "");
      return;
    }

    const gross = Number($("expenseGross").value || 0);
    const net = Math.round((gross / 1.18) * 100) / 100;
    const vat = Math.round((gross - net) * 100) / 100;

    const supplierName = $("expenseSupplier").value.trim();
    let supplierId = null;

    if(supplierName){
      let {data:existingSupplier} = await sb.from("suppliers")
        .select("id")
        .eq("user_id",userId)
        .ilike("name",supplierName)
        .maybeSingle();

      if(!existingSupplier){
        const {data:createdSupplier,error:supplierError} = await sb.from("suppliers")
          .insert({
            user_id:userId,
            name:supplierName,
            registration_number:$("expenseSupplierReg").value.trim()
          })
          .select("id")
          .single();

        if(supplierError){
          setStatus($("expenseStatus"), supplierError.message, "error");
          return;
        }

        existingSupplier = createdSupplier;
      }

      supplierId = existingSupplier.id;
    }

    const payload = {
      user_id:userId,
      supplier_id:supplierId,
      supplier_name_snapshot:supplierName,
      supplier_registration_snapshot:$("expenseSupplierReg").value.trim(),
      document_date:$("expenseDate").value || null,
      document_number:$("expenseDocumentNumber").value.trim(),
      description:$("expenseDescription").value.trim(),
      notes:$("expenseNotes").value.trim(),
      category_id:$("expenseCategory").value || null,
      accounting_type_id:$("expenseAccountingType").value,
      project_id:$("expenseProject").value || null,
      payment_source_id:$("expensePaymentSource").value || null,
      payment_method_id:$("expensePaymentMethod").value || null,
      gross_ils:gross,
      net_ils:net,
      vat_ils:vat
    };

    const reviewContextSnapshot = activeExpenseReviewContext?.enteredFromReviewList
      ? {
          batchId: activeExpenseReviewContext.batchId,
          scanItemId: activeExpenseReviewContext.scanItemId
        }
      : null;

    let expenseId = null;
    let reviewQueueSyncError = "";

    if(isEditingDetailsMode){
      const {data:updatedExpense,error:updateError} = await sb.from("expenses")
        .update(payload)
        .eq("user_id", userId)
        .eq("id", currentExpenseEditId)
        .select("id")
        .single();

      if(updateError){
        setStatus($("expenseStatus"), updateError.message || "שגיאה בעדכון ההוצאה", "error");
        return;
      }

      expenseId = updatedExpense.id;
    } else if(reviewContextSnapshot?.scanItemId && reviewContextSnapshot?.batchId){
      const {data:saveResult, error:saveError} = await sb.rpc(
        "save_current_invoice_expense_atomic",
        {
          p_scan_item_id: reviewContextSnapshot.scanItemId,
          p_batch_id: reviewContextSnapshot.batchId,
          p_expense: {
            supplier_id: payload.supplier_id,
            supplier_name_snapshot: payload.supplier_name_snapshot,
            supplier_registration_snapshot: payload.supplier_registration_snapshot,
            document_date: payload.document_date,
            document_number: payload.document_number,
            description: payload.description,
            notes: payload.notes,
            category_id: payload.category_id,
            accounting_type_id: payload.accounting_type_id,
            project_id: payload.project_id,
            payment_source_id: payload.payment_source_id,
            payment_method_id: payload.payment_method_id,
            gross_ils: payload.gross_ils,
            net_ils: payload.net_ils,
            vat_ils: payload.vat_ils
          }
        }
      );

      if(saveError){
        const duplicateSave = saveError.code === "23505";
        setStatus(
          $("expenseStatus"),
          duplicateSave ? "החשבונית הזו כבר נשמרה." : (saveError.message || "שגיאה בשמירת החשבונית"),
          "error"
        );
        return;
      }

      const saveRow = Array.isArray(saveResult) ? saveResult[0] : saveResult;
      if(!saveRow?.expense_id){
        setStatus($("expenseStatus"), "תשובת שמירת החשבונית אינה תקינה", "error");
        return;
      }

      expenseId = saveRow.expense_id;

      try {
        removeSavedExpenseReviewItemAndOpenNext(reviewContextSnapshot.scanItemId);
      } catch(uiError){
        console.error(uiError);
        setStatus($("expenseStatus"), uiError?.message || "שגיאה בעדכון רשימת החשבוניות", "error");
        return;
      }

      try {
        await reconcileExpenseReviewRowsAfterSave(reviewContextSnapshot.batchId);
      } catch(syncError){
        console.error(syncError);
        reviewQueueSyncError = "החשבונית נשמרה, אך סנכרון רשימת החשבוניות נכשל.";
      }
    } else {
      const {data:expense,error} = await sb.from("expenses")
        .insert(payload)
        .select("id")
        .single();

      if(error){
        setStatus($("expenseStatus"), error.message, "error");
        return;
      }

      expenseId = expense.id;
    }

    for(let i=0;i<selectedFiles.length;i++){
      const file = selectedFiles[i];
      const path = `${userId}/${expenseId}/${String(i+1).padStart(3,"0")}-${file.name}`;

      const upload = await sb.storage
        .from("invoice-documents")
        .upload(path,file,{contentType:file.type,upsert:false});

      if(!upload.error){
        await sb.from("expense_documents").insert({
          user_id:userId,
          expense_id:expenseId,
          storage_path:path,
          original_filename:file.name,
          mime_type:file.type,
          page_number:i+1,
          document_type:file.type === "application/pdf" ? "pdf" : "image",
          generated_by_app:false
        });
      }
    }

    await Promise.all([loadExpenses(),loadDashboard()]);
    void refreshPendingInvoiceCountIndicator();

    if(isEditingDetailsMode){
      const refreshedExpense = await getExpenseRecordForDetails(expenseId);
      if(refreshedExpense){
        currentExpenseDetailsRecord = refreshedExpense;
        currentExpensePermissions = readExpensePermissions(refreshedExpense);
        renderExpenseDetailsReadOnly(refreshedExpense);
      }

      setStatus($("expenseStatus"), "ההוצאה עודכנה", "ok");
      setExpenseDialogMode(EXPENSE_DIALOG_MODES.DETAILS_READONLY);
      return;
    }

    event.target.reset();
    selectedFiles = [];
    clearLocalFileObjectUrls();
    setStatus(
      $("expenseStatus"),
      reviewQueueSyncError || "החשבונית נשמרה",
      reviewQueueSyncError ? "error" : "ok"
    );

    setTimeout(() => {
      $("expenseDialog")?.close();
      if(shouldShowAssetFollowupAfterSave){
        $("expenseAssetFollowupDialog")?.showModal();
      }
    },650);
    return;
  
} catch(error){
    console.error(error);
    setStatus($("expenseStatus"), error?.message || "שגיאה בשמירת ההוצאה", "error");
  } finally {
    isExpenseSaving = false;
    if(submitButton) submitButton.disabled = false;
  }
};

$("zForm").onsubmit = async event => {
  event.preventDefault();
  if(isZSaving) return;
  clearFormFieldValidation(event.target);

  const form = event.target;
  const submitButton = form.querySelector('button[type="submit"], button:not([type])');
  const zBrowseButton = $("zBrowseButton");
  const zBrowseInput = $("zBrowseInput");
  const isEditingSession = Boolean(currentZReportEditId);

  isZSaving = true;
  if(submitButton) submitButton.disabled = true;
  if(zBrowseButton) zBrowseButton.disabled = true;
  if(zBrowseInput) zBrowseInput.disabled = true;

  const isRetryingPendingZReport = !isEditingSession && Boolean(String(pendingZReportId || "").trim());
  let zReportId = String(pendingZReportId || "").trim();
  let uploadedPaths = [];
  let uploadCleanupAttempted = false;

  try {
    const normalizedIncomeType = normalizeIncomeType($("zIncomeType")?.value);
    const reportTime = $("zTime")?.value || null;
    const notesValue = $("zNotes")?.value?.trim() || "";
    const isFromZReport = normalizedIncomeType === Z_INCOME_TYPE_DEFAULT;

    if(currentZReportEditId){
      const {error:updateError} = await sb.from("daily_z_reports")
        .update({
          report_date:$("zDate").value,
          report_time: reportTime,
          project_id:$("zProject").value || null,
          total_income_ils:Number($("zTotal").value || 0),
          income_type: normalizedIncomeType,
          notes: notesValue || null,
          is_from_z_report: isFromZReport
        })
        .eq("user_id", userId)
        .eq("id", currentZReportEditId);

      if(updateError){
        setStatus($("zStatus"), updateError.message, "error");
        return;
      }

      zReportId = currentZReportEditId;
      pendingZReportId = "";
    } else if(!zReportId){
      const {data:insertedReport, error:createError} = await sb.from("daily_z_reports")
        .insert({
          user_id:userId,
          report_date:$("zDate").value,
          report_time: reportTime,
          project_id:$("zProject").value || null,
          total_income_ils:Number($("zTotal").value || 0),
          income_type: normalizedIncomeType,
          notes: notesValue || null,
          is_from_z_report: isFromZReport
        })
        .select("id")
        .single();

      if(createError){
        setStatus($("zStatus"), createError.message, "error");
        return;
      }

      zReportId = insertedReport?.id || "";
      if(!zReportId){
        setStatus($("zStatus"), "תשובת שמירת ההכנסה אינה תקינה", "error");
        return;
      }

      pendingZReportId = zReportId;
    }

    if(!selectedZFiles.length){
      pendingZReportId = "";
      currentZReportEditId = "";
      await Promise.all([loadZReports(),loadDashboard(),loadIncomeTypeSuggestions()]);
      queueZDialogResetAfterClose(isEditingSession ? "הכנסה עודכנה" : "הכנסה חדשה נשמרה");
      return;
    }

    const uploadPlan = buildPendingZReportUploadPlan(zReportId, selectedZFiles);

    if(isRetryingPendingZReport){
      const {data:existingDocuments, error:existingDocumentsError} = await sb.from("z_report_documents")
        .select("id,storage_path,original_filename,mime_type,document_order")
        .eq("user_id", userId)
        .eq("z_report_id", zReportId)
        .order("document_order", {ascending: true});

      if(existingDocumentsError){
        setStatus($("zStatus"), existingDocumentsError.message || "שגיאה בטעינת מצב המסמכים הקיים", "error");
        return;
      }

      const existingRows = Array.isArray(existingDocuments) ? existingDocuments : [];
      const uploadPlanByOrder = new Map(uploadPlan.map(item => [item.order, item]));
      const existingRowsByOrder = new Map();

      for(const existingRow of existingRows){
        const plannedItem = uploadPlanByOrder.get(existingRow.document_order);
        const plannedMimeType = plannedItem?.file?.type || "application/octet-stream";
        const plannedFilename = plannedItem?.file?.name || "file";

        if(
          !plannedItem
          || existingRow.original_filename !== plannedFilename
          || existingRow.mime_type !== plannedMimeType
        ){
          setStatus(
            $("zStatus"),
            "מצב המסמכים שכבר נשמרו אינו תואם לקבצים שנבחרו, ולכן אי אפשר להמשיך בבטחה בניסיון החוזר.",
            "error"
          );
          return;
        }

        existingRowsByOrder.set(existingRow.document_order, existingRow);
      }

      const missingUploadPlan = uploadPlan.filter(item => !existingRowsByOrder.has(item.order));
      if(!missingUploadPlan.length && existingRows.length === uploadPlan.length){
        pendingZReportId = "";
        await Promise.all([loadZReports(),loadDashboard(),loadIncomeTypeSuggestions()]);
        queueZDialogResetAfterClose("הכנסה חדשה נשמרה");
        return;
      }

      const staleRetryPaths = missingUploadPlan.map(item => item.storagePath);
      if(staleRetryPaths.length){
        const staleCleanupError = await cleanupUploadedZReportFiles(staleRetryPaths);
        if(staleCleanupError){
          setStatus(
            $("zStatus"),
            "לא ניתן לנקות שרידי מסמכים מהניסיון הקודם, ולכן הניסיון החוזר נעצר כדי למנוע כשל העלאה נוסף.",
            "error"
          );
          return;
        }
      }

      uploadPlan.splice(0, uploadPlan.length, ...missingUploadPlan);
    }

    let nextDocumentOrder = 1;
    if(!isRetryingPendingZReport){
      const {data:existingDocumentOrders, error:existingDocumentOrdersError} = await sb.from("z_report_documents")
        .select("document_order")
        .eq("user_id", userId)
        .eq("z_report_id", zReportId);

      if(existingDocumentOrdersError){
        setStatus($("zStatus"), existingDocumentOrdersError.message || "שגיאה בטעינת מסמכים קיימים", "error");
        return;
      }

      nextDocumentOrder = (Array.isArray(existingDocumentOrders) ? existingDocumentOrders : [])
        .reduce((maxOrder, row) => Math.max(maxOrder, Number(row?.document_order || 0)), 0) + 1;
    }

    const documentRows = [];

    for(let uploadIndex = 0; uploadIndex < uploadPlan.length; uploadIndex++){
      const uploadItem = uploadPlan[uploadIndex];
      const file = uploadItem.file;
      const order = isRetryingPendingZReport ? uploadItem.order : nextDocumentOrder + uploadIndex;
      const storagePath = uploadItem.storagePath;

      const upload = await sb.storage
        .from("invoice-documents")
        .upload(storagePath, file, {contentType:file.type || "application/octet-stream", upsert:false});

      if(upload.error){
        uploadCleanupAttempted = true;
        const cleanupError = await cleanupUploadedZReportFiles(uploadedPaths);
        const cleanupSuffix = cleanupError ? " ניקוי הקבצים שהועלו לא הושלם." : "";
        setStatus(
          $("zStatus"),
          `ההכנסה נשמרה, אבל צירוף המסמכים נכשל והמסמכים לא נשמרו.${cleanupSuffix}`,
          "error"
        );
        await Promise.all([loadZReports(),loadDashboard(),loadIncomeTypeSuggestions()]);
        return;
      }

      uploadedPaths.push(storagePath);
      documentRows.push({
        user_id: userId,
        z_report_id: zReportId,
        storage_path: storagePath,
        original_filename: file.name || "file",
        mime_type: file.type || "application/octet-stream",
        document_order: order
      });
    }

    const {error:metadataError} = await sb.from("z_report_documents").insert(documentRows);
    if(metadataError){
      uploadCleanupAttempted = true;
      const cleanupError = await cleanupUploadedZReportFiles(uploadedPaths);
      const cleanupSuffix = cleanupError ? " ניקוי הקבצים שהועלו לא הושלם." : "";
      setStatus(
        $("zStatus"),
        `ההכנסה נשמרה, אבל צירוף המסמכים נכשל והמסמכים לא נשמרו.${cleanupSuffix}`,
        "error"
      );
      await Promise.all([loadZReports(),loadDashboard(),loadIncomeTypeSuggestions()]);
      return;
    }

    pendingZReportId = "";
    currentZReportEditId = "";
    await Promise.all([loadZReports(),loadDashboard(),loadIncomeTypeSuggestions()]);
    queueZDialogResetAfterClose(isEditingSession ? "הכנסה עודכנה" : "הכנסה חדשה נשמרה");
  } catch(error){
    console.error(error);

    let cleanupSuffix = "";
    if(uploadedPaths.length && !uploadCleanupAttempted){
      const cleanupError = await cleanupUploadedZReportFiles(uploadedPaths);
      if(cleanupError){
        cleanupSuffix = " ניקוי הקבצים שהועלו לא הושלם.";
      }
    }

    if(zReportId){
      setStatus(
        $("zStatus"),
        `ההכנסה נשמרה, אבל צירוף המסמכים נכשל והמסמכים לא נשמרו.${cleanupSuffix}`,
        "error"
      );
      await Promise.all([loadZReports(),loadDashboard(),loadIncomeTypeSuggestions()]);
      return;
    }

    setStatus($("zStatus"), `${error?.message || "שגיאה בשמירת הכנסה"}${cleanupSuffix}`, "error");
  } finally {
    isZSaving = false;
    if(submitButton) submitButton.disabled = false;
    if(zBrowseButton) zBrowseButton.disabled = false;
    if(zBrowseInput) zBrowseInput.disabled = false;
  }
};

init();
