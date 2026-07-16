const $ = id => document.getElementById(id);
let sb, session, userId, business = {}, selectedFiles = [];
let isExpenseSaving = false;
let initialSessionChecked = false;
let currentScanOperationId = null;
let currentScanSelectionSignature = "";
let activeExpenseReviewContext = null;
let expenseReviewLoadToken = 0;
let expenseReviewRows = [];
let currentExpenseReviewDocument = null;
let expenseReviewFullscreenOpener = null;
let currentFullscreenImageState = null;
let currentExpenseReviewPages = [];
let currentExpenseReviewPageIndex = 0;
const fileSha256Cache = new WeakMap();
const ACTIVE_VIEW_KEY = "activeView";
const AVAILABLE_VIEWS = ["homeView","expensesView","financeView","teamView","alView"];

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

const activateView = viewId => {
  const target = AVAILABLE_VIEWS.includes(viewId) ? viewId : "homeView";
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === target));
  document.querySelectorAll(".bottom-nav button").forEach(button => {
    button.classList.toggle("active", button.dataset.view === target);
  });
  saveActiveViewId(target);
};

const money = n => new Intl.NumberFormat("he-IL", {
  style:"currency", currency:"ILS", maximumFractionDigits:0
}).format(Number(n || 0));

const today = () => new Date().toISOString().slice(0,10);
const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`;
};

const currentYear = () => new Date().getFullYear();
const getSelectedYear = () => {
  const yearInput = $("selectedYear") || $("yearSelect");
  const year = yearInput && yearInput.value ? Number(yearInput.value) : NaN;
  return Number.isInteger(year) ? year : currentYear();
};

const yearStart = year => `${year}-01-01`;
const yearEnd = year => `${year}-12-31`;

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
          throw new Error(upload.error.message || "שגיאה בהעלאת קובץ הסריקה");
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

function normalizeMultipleInvoicesFlag(value){
  if(value === true) return true;
  if(typeof value === "string" && value.trim().toLowerCase() === "true") return true;
  return false;
}

function buildScanBatchRpcInput(extractionResult){
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
        pages
      }
    ]
  };
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
  if(!value) return "";

  const date = new Date(value);
  if(Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("he-IL", {
    dateStyle:"short",
    timeStyle:"short"
  }).format(date);
}

function hideExpenseReviewList(){
  const section = $("expenseReviewList");
  const tableHost = $("expenseReviewListTable");
  if(!section || !tableHost) return;

  section.classList.add("hidden");
  tableHost.innerHTML = "אין חשבוניות להצגה.";
}

function hideExpenseReviewContext(){
  const section = $("expenseReviewContext");
  const label = $("expenseReviewContextLabel");
  const documentTitle = $("expenseReviewDocumentTitle");
  if(!section || !label) return;

  section.classList.add("hidden");
  label.textContent = "";
  if(documentTitle) documentTitle.textContent = "";
  renderExpenseReviewDocumentState({message:"בחרי חשבונית להצגת המסמך."});
  updateExpenseReviewNavigation();
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
  if(!nav || !prevButton || !nextButton || !position) return;

  const total = currentExpenseReviewPages.length;
  const hasPages = total > 0;
  const activeIndex = hasPages
    ? Math.min(Math.max(0, currentExpenseReviewPageIndex), total - 1)
    : 0;

  nav.classList.toggle("hidden", !hasPages);
  prevButton.disabled = !hasPages || activeIndex <= 0;
  nextButton.disabled = !hasPages || activeIndex >= (total - 1);
  position.textContent = hasPages ? `עמוד ${activeIndex + 1} מתוך ${total}` : "";
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

  expenseReviewFullscreenOpener = entryButton || null;
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
  const label = $("expenseReviewContextLabel");
  const documentTitle = $("expenseReviewDocumentTitle");
  if(!section || !label) return;

  activeExpenseReviewContext = {
    batchId: context.batchId,
    scanItemId: context.scanItemId,
    itemOrder: context.itemOrder,
    enteredFromReviewList: true
  };

  label.textContent = context.label;
  if(documentTitle) documentTitle.textContent = context.label;
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
  const position = $("expenseReviewPosition");
  if(!prevButton || !backButton || !nextButton || !position) return;

  const total = expenseReviewRows.length;
  const activeIndex = getActiveExpenseReviewRowIndex();
  const hasActive = activeIndex >= 0;

  prevButton.disabled = !hasActive || activeIndex <= 0;
  nextButton.disabled = !hasActive || activeIndex >= (total - 1);
  backButton.disabled = total === 0;

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

async function reconcileExpenseReviewRowsAfterSave(batchId){
  if(!batchId) return;

  const activeScanItemId = activeExpenseReviewContext?.scanItemId || null;
  const reconciledRows = await loadBatchReviewListRows(batchId);
  expenseReviewRows = reconciledRows;

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

  expenseReviewRows = Array.isArray(rows) ? rows : [];

  if(!expenseReviewRows.length){
    section.classList.remove("hidden");
    tableHost.innerHTML = "אין חשבוניות להצגה.";
    updateExpenseReviewNavigation();
    return;
  }

  tableHost.innerHTML = `
    <table aria-label="טבלת חשבוניות לבדיקה">
      <thead>
        <tr>
          <th scope="col">תווית חשבונית</th>
          <th scope="col">תאריך/שעת קליטה</th>
          <th scope="col">מספר עמודים</th>
        </tr>
      </thead>
      <tbody>
        ${expenseReviewRows.map(row => `
          <tr data-scan-item-id="${row.scanItemId}" data-batch-id="${row.batchId}" data-item-order="${row.itemOrder}">
            <td><button type="button" class="review-row-open" data-open-review-item="${row.scanItemId}">${row.label}</button></td>
            <td>${row.capturedAt}</td>
            <td>${row.pageCount}</td>
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
}

async function loadBatchReviewListRows(batchId){
  if(!batchId) return [];

  const {data:items, error:itemsError} = await sb.from("invoice_scan_items")
    .select("id,item_order,invoice_scan_batches!inner(completed_at)")
    .eq("user_id", userId)
    .eq("batch_id", batchId)
    .is("saved_expense_id", null)
    .order("item_order", {ascending:true});

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

  return itemRows.map(item => ({
    batchId,
    scanItemId: item.id,
    itemOrder: item.item_order,
    label: `חשבונית ${item.item_order}`,
    capturedAt: formatReviewCaptureDateTime(item.invoice_scan_batches?.completed_at),
    pageCount: pageCountByItemId.get(item.id) || 0
  }));
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
  activateView(getSavedViewId() || "homeView");

  await loadBusiness();
  await loadLookups();
  await Promise.all([loadDashboard(), loadExpenses(), loadZReports(), loadEmployees()]);
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

setupManualTablist(["loginTab","signupTab"], setAuthTab);
setupManualTablist(["insightsTab","chatTab"], setAlTab);
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
  const year = getSelectedYear();
  const from = yearStart(year);
  const to = yearEnd(year);

  const [{data:expenses},{data:income}] = await Promise.all([
    sb.from("expenses")
      .select("gross_ils")
      .eq("user_id",userId)
      .gte("document_date",from)
      .lte("document_date",to),
    sb.from("daily_z_reports")
      .select("total_income_ils")
      .eq("user_id",userId)
      .gte("report_date",from)
      .lte("report_date",to)
  ]);

  const expenseTotal = (expenses || []).reduce((s,x)=>s+Number(x.gross_ils || 0),0);
  const incomeTotal = (income || []).reduce((s,x)=>s+Number(x.total_income_ils || 0),0);

  $("incomeMetric").textContent = money(incomeTotal);
  $("expenseMetric").textContent = money(expenseTotal);
  $("profitMetric").textContent = money(incomeTotal-expenseTotal);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate()-1);
  const y = yesterday.toISOString().slice(0,10);

  const {data:zYesterday} = await sb.from("daily_z_reports")
    .select("id")
    .eq("user_id",userId)
    .eq("report_date",y);

  const missing = !(zYesterday || []).length;
  $("homeInsight").textContent = missing
    ? "לא הוזן דו״ח Z של אתמול."
    : "אין כרגע תובנה דחופה.";

  $("insightsList").innerHTML =
    (missing ? '<div>🔴 לא הוזן דו״ח Z של אתמול.</div><hr>' : "") +
    `<div>🟢 מצב העסק: הכנסות החודש ${money(incomeTotal)}, הוצאות ${money(expenseTotal)}.</div>`;
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
          <tr>
            <td><button class="eye" data-expense="${row.id}" aria-label="צפייה במסמכי הוצאה">👁</button></td>
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

  document.querySelectorAll(".eye").forEach(btn => {
    btn.onclick = () => openExpenseDocument(btn.dataset.expense);
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

async function loadZReports(){
  const {data,error} = await sb.from("daily_z_reports")
    .select("report_date,total_income_ils,projects(name)")
    .eq("user_id",userId)
    .order("report_date",{ascending:false})
    .limit(60);

  if(error){
    $("zTable").textContent = error.message;
    return;
  }

  $("zTable").innerHTML = (data || []).length ? `
    <table aria-label="טבלת דו״חות Z">
      <thead>
        <tr><th scope="col">תאריך</th><th scope="col">הכנסות</th><th scope="col">פרויקט</th></tr>
      </thead>
      <tbody>
        ${(data || []).map(row => `
          <tr>
            <td>${row.report_date}</td>
            <td>${money(row.total_income_ils)}</td>
            <td>${row.projects?.name || ""}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  ` : "אין עדיין דו״חות Z";
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

$("quickAddButton").onclick = () => $("quickAddDialog").showModal();

document.querySelectorAll("[data-close]").forEach(button => {
  button.onclick = () => button.closest("dialog").close();
});

document.querySelectorAll("[data-action]").forEach(button => {
  button.onclick = () => openAction(button.dataset.action);
});

function openAction(action){
  $("quickAddDialog").close();

  if(action === "expense"){
    resetExpenseDialogState();
    $("expenseDialog").showModal();
  } else if(action === "z"){
    $("zDate").value = today();
    $("zDialog").showModal();
  }else{
    alert("הפעולה תתווסף בעדכון הבא.");
  }
}

$("profileButton").onclick = () => $("businessDialog").showModal();

function renderSelectedFiles(){
  const preview = $("expenseFilePreview");
  if(!preview) return;

  preview.querySelectorAll("img").forEach(img => {
    if(img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
  });

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

    const previewUrl = URL.createObjectURL(file);
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
}

function removeSelectedFile(index){
  if(index < 0 || index >= selectedFiles.length) return;
  selectedFiles.splice(index,1);
  if(!selectedFiles.length){
    resetExpenseDialogState();
  } else {
    setStatus($("expenseStatus"), `${selectedFiles.length} קבצים נבחרו`, "ok");
  }
  renderSelectedFiles();
}

function updateFiles(input, mode){
  const newFiles = Array.from(input.files || []);

  if(mode === "single"){
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

$("singleCameraButton").onclick = () => $("singleCameraInput").click();
$("multiCameraButton").onclick = () => $("multiCameraInput").click();
$("browseButton").onclick = () => $("browseInput").click();
$("singleCameraInput").onchange = event => updateFiles(event.currentTarget, "single");
$("multiCameraInput").onchange = event => updateFiles(event.currentTarget, "append");
$("browseInput").onchange = event => updateFiles(event.currentTarget, "append");

function resetExpenseDialogState(){
  selectedFiles = [];
  resetScanOperationId();
  expenseReviewLoadToken += 1;
  activeExpenseReviewContext = null;
  expenseReviewRows = [];
  $("singleCameraInput").value = "";
  $("multiCameraInput").value = "";
  $("browseInput").value = "";
  clearExpenseInvoiceDerivedFields();
  hideExpenseReviewList();
  hideExpenseReviewContext();
  renderSelectedFiles();
  setStatus($("expenseStatus"), "", "");
}

$("analyzeButton").onclick = async () => {
  if(!selectedFiles.length){
    setStatus($("expenseStatus"), "בחרי תמונה או PDF", "error");
    return;
  }

  const progressMessage = selectedFiles.length === 1
    ? "מחלצת נתונים מהחשבונית..."
    : "מחלצת נתונים מהחשבוניות...";

  setStatus($("expenseStatus"), progressMessage);

  const formData = new FormData();
  selectedFiles.forEach(file => formData.append("files",file));
  formData.append("document_type","invoice");
  formData.append("contract_version","1");
  formData.append("operation_source","web");

  try {
    const selectionSignature = await buildFileSelectionSignature(selectedFiles);
    const operationId = getOrCreateScanOperationId(selectionSignature);
    const uploadedScanFiles = await uploadScanFilesBeforeAnalyze(selectedFiles, operationId);
    formData.append("operation_id",operationId);
    formData.append("storage_metadata_json", JSON.stringify({
      storage_metadata_version: 1,
      files: uploadedScanFiles
    }));

    const response = await fetch("/api/analyze-invoice",{
      method:"POST",
      body:formData
    });

    const result = await response.json();

    if(!response.ok){
      setStatus($("expenseStatus"), result.detail || "שגיאה בחילוץ", "error");
      return;
    }

    if(normalizeMultipleInvoicesFlag(result.multiple_invoices)){
      const rpcInput = buildScanBatchRpcInput(result);
      if(!rpcInput){
        setStatus($("expenseStatus"), "מבנה קיבוץ החשבוניות אינו תקין", "error");
        return;
      }

      const {data:batchResult, error:batchError} = await sb.rpc(
        "persist_invoice_scan_batch_atomic",
        rpcInput
      );

      if(batchError){
        setStatus($("expenseStatus"), batchError.message || "שגיאה בשמירת הסריקה", "error");
        return;
      }

      const batchRow = Array.isArray(batchResult) ? batchResult[0] : batchResult;
      if(!batchRow || !batchRow.batch_id){
        setStatus($("expenseStatus"), "תשובת שמירת הסריקה אינה תקינה", "error");
        return;
      }

      const reviewRows = await loadBatchReviewListRows(batchRow.batch_id);
      hideExpenseReviewContext();
      activeExpenseReviewContext = null;
      renderExpenseReviewList(reviewRows);
      setStatus($("expenseStatus"), "החשבוניות נשמרו לבדיקה. הוצגה רשימת חשבוניות.", "ok");
      return;
    }

    const singleInvoice = sanitizeSingleInvoiceResult(result);
    if(!singleInvoice){
      setStatus($("expenseStatus"), "מבנה תשובת החילוץ לא תקין", "error");
      return;
    }

    const rpcInput = buildScanBatchRpcInput(result);
    if(!rpcInput){
      setStatus($("expenseStatus"), "חסר מידע סריקה לשמירה אטומית", "error");
      return;
    }

    const {data:batchResult, error:batchError} = await sb.rpc(
      "persist_invoice_scan_batch_atomic",
      rpcInput
    );

    if(batchError){
      setStatus($("expenseStatus"), batchError.message || "שגיאה בשמירת סריקה", "error");
      return;
    }

    const batchRow = Array.isArray(batchResult) ? batchResult[0] : batchResult;
    if(!batchRow || !batchRow.batch_id){
      setStatus($("expenseStatus"), "תשובת שמירת הסריקה אינה תקינה", "error");
      return;
    }

    fillExpenseFormFromInvoice(singleInvoice);

    setStatus($("expenseStatus"), "הנתונים חולצו. בדקי לפני שמירה.", "ok");
  } catch(error){
    console.error(error);
    setStatus($("expenseStatus"), error?.message || "שגיאה בחילוץ", "error");
  }
};

$("expenseReviewNavPrev").onclick = () => navigateExpenseReviewByOffset(-1);
$("expenseReviewNavNext").onclick = () => navigateExpenseReviewByOffset(1);
$("expenseReviewBackToList").onclick = () => returnToExpenseReviewList();
$("expenseReviewFullscreenPagePrev").onclick = () => navigateExpenseReviewFullscreenPageByOffset(-1);
$("expenseReviewFullscreenPageNext").onclick = () => navigateExpenseReviewFullscreenPageByOffset(1);
$("expenseReviewFullscreenOpen").onclick = () => openExpenseReviewFullscreen();
$("expenseReviewFullscreenClose").onclick = () => closeExpenseReviewFullscreen();
$("expenseReviewFullscreenZoomIn").onclick = () => zoomFullscreenImageBy(1.2);
$("expenseReviewFullscreenZoomOut").onclick = () => zoomFullscreenImageBy(1 / 1.2);
$("expenseReviewFullscreenZoomReset").onclick = () => {
  if(!currentFullscreenImageState) return;
  currentFullscreenImageState.scale = 1;
  currentFullscreenImageState.translateX = 0;
  currentFullscreenImageState.translateY = 0;
  applyFullscreenImageTransform();
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

  if(reviewContextSnapshot?.scanItemId && reviewContextSnapshot?.batchId){
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

  event.target.reset();
  selectedFiles = [];
  setStatus(
    $("expenseStatus"),
    reviewQueueSyncError || "החשבונית נשמרה",
    reviewQueueSyncError ? "error" : "ok"
  );

  await Promise.all([loadExpenses(),loadDashboard()]);
  setTimeout(() => $("expenseDialog").close(),650);
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
  clearFormFieldValidation(event.target);

  const {error} = await sb.from("daily_z_reports").insert({
    user_id:userId,
    report_date:$("zDate").value,
    project_id:$("zProject").value || null,
    total_income_ils:Number($("zTotal").value || 0)
  });

  if(error){
    setStatus($("zStatus"), error.message, "error");
    return;
  }

  setStatus($("zStatus"), "דו״ח Z נשמר", "ok");
  event.target.reset();

  await Promise.all([loadZReports(),loadDashboard()]);
  setTimeout(() => $("zDialog").close(),650);
};

init();
