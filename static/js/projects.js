let projectsSearchTerm = "";
let projectsStatusFilter = "active";
let currentProjectId = "";
let currentProjectCard = null;
let currentProjectIncomeRows = [];
let currentProjectExpenseRows = [];
let currentProjectDocumentRows = [];
let projectCardSearchTerm = "";
let currentProjectEditorId = "";
let selectedProjectProfileFile = null;
let removeCurrentProjectProfile = false;
let projectEditorPreviewUrl = "";
let pendingProjectDocumentFile = null;
let pendingProjectDocumentReplacementId = "";
let projectDeleteInFlight = false;

function normalizeProjectSearchValue(value){
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("he");
}

function projectMatchesSearch(project, searchTerm = projectsSearchTerm){
  const query = normalizeProjectSearchValue(searchTerm);
  if(!query) return true;
  return [project?.name, project?.description, project?.notes]
    .some(value => normalizeProjectSearchValue(value).includes(query));
}

function projectMatchesStatus(project){
  if(projectsStatusFilter === "all") return true;
  if(projectsStatusFilter === "inactive") return !project?.is_active;
  return Boolean(project?.is_active);
}

function getProjectFallbackLetter(project){
  return String(project?.name || "פ").trim().slice(0, 1) || "פ";
}

async function renderProjectProfileImage(element, project){
  if(!element) return;
  const storagePath = String(project?.profile_storage_path || "").trim();
  element.dataset.projectProfilePath = storagePath;
  element.innerHTML = "";
  element.textContent = getProjectFallbackLetter(project);
  if(!storagePath) return;

  try {
    const signedUrl = await createSignedUrlForStoragePath(storagePath, 300);
    if(element.dataset.projectProfilePath !== storagePath) return;
    const image = document.createElement("img");
    image.src = signedUrl;
    image.alt = `תמונת פרופיל של ${project?.name || "הפרויקט"}`;
    element.innerHTML = "";
    element.appendChild(image);
  } catch(error){
    console.error("project_profile_load_failed", error);
  }
}

function renderProjectsList(){
  const host = $("projectsList");
  if(!host) return;
  const rows = projectRows.filter(project => projectMatchesStatus(project) && projectMatchesSearch(project));

  document.querySelectorAll("[data-project-status-filter]").forEach(button => {
    const isActive = button.dataset.projectStatusFilter === projectsStatusFilter;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  if(!rows.length){
    host.innerHTML = `<p class="project-related-empty">${projectRows.length ? "לא נמצאו פרויקטים התואמים לחיפוש ולסינון." : "אין עדיין פרויקטים."}</p>`;
    return;
  }

  host.innerHTML = rows.map(project => `
    <button type="button" class="project-list-row" data-project-open-id="${escapeHtml(project.id)}" aria-label="פתיחת כרטיס ${escapeHtml(project.name)}">
      <span class="project-profile" data-project-list-profile="${escapeHtml(project.id)}" aria-hidden="true">${escapeHtml(getProjectFallbackLetter(project))}</span>
      <span class="project-list-main">
        <span class="project-list-title"><strong>${escapeHtml(project.name)}</strong></span>
        <small>${escapeHtml(project.description || project.notes || "ללא תיאור")}</small>
      </span>
      <span class="project-list-statuses">
        <span class="project-status-badge ${project.is_active ? "is-active" : ""}">${project.is_active ? "פעיל" : "לא פעיל"}</span>
        ${String(project.id) === String(defaultProjectId) ? '<span class="project-status-badge is-default">ברירת מחדל</span>' : ""}
      </span>
    </button>
  `).join("");

  host.querySelectorAll("[data-project-open-id]").forEach(button => {
    button.addEventListener("click", () => void openProjectCard(button.dataset.projectOpenId));
  });

  rows.forEach(project => {
    void renderProjectProfileImage(
      host.querySelector(`[data-project-list-profile="${CSS.escape(project.id)}"]`),
      project
    );
  });
}

function projectRelatedMatches(values){
  const query = normalizeProjectSearchValue(projectCardSearchTerm);
  if(!query) return true;
  return values.some(value => normalizeProjectSearchValue(value).includes(query));
}

function renderProjectRelatedRows(){
  const incomeHost = $("projectCardIncomeList");
  const expenseHost = $("projectCardExpenseList");
  const documentHost = $("projectCardDocumentsList");
  if(!incomeHost || !expenseHost || !documentHost) return;

  const incomeRows = currentProjectIncomeRows.filter(row => projectRelatedMatches([
    row.report_date,
    row.report_time,
    row.income_type,
    row.notes,
    row.reference_number,
    row.total_income_ils
  ]));
  const expenseRows = currentProjectExpenseRows.filter(row => projectRelatedMatches([
    row.document_date,
    row.supplier_name_snapshot,
    row.document_number,
    row.description,
    row.notes,
    row.gross_ils
  ]));
  const documentRows = currentProjectDocumentRows.filter(row => projectRelatedMatches([
    row.display_name,
    row.original_filename,
    row.mime_type
  ]));

  incomeHost.innerHTML = incomeRows.length
    ? incomeRows.map(row => `
        <div class="project-related-row project-transaction-row">
          <span class="project-related-row-main">
            <span class="project-transaction-name">${escapeHtml(normalizeIncomeType(row.income_type) || "הכנסה")}</span>
            <small class="project-transaction-meta">${escapeHtml([row.report_date, row.reference_number].filter(Boolean).join(" · "))}</small>
          </span>
          <span class="project-transaction-amount">${escapeHtml(money(row.total_income_ils || 0))}</span>
        </div>
      `).join("")
    : `<p class="project-related-empty">${currentProjectIncomeRows.length ? "לא נמצאו הכנסות התואמות לחיפוש." : "אין הכנסות לפרויקט"}</p>`;

  expenseHost.innerHTML = expenseRows.length
    ? expenseRows.map(row => `
        <div class="project-related-row project-transaction-row">
          <span class="project-related-row-main">
            <span class="project-transaction-name">${escapeHtml(row.supplier_name_snapshot || row.description || "הוצאה")}</span>
            <small class="project-transaction-meta">${escapeHtml([row.document_date, row.document_number].filter(Boolean).join(" · "))}</small>
          </span>
          <span class="project-transaction-amount">${escapeHtml(moneyAbs(row.gross_ils || 0))}</span>
        </div>
      `).join("")
    : `<p class="project-related-empty">${currentProjectExpenseRows.length ? "לא נמצאו הוצאות התואמות לחיפוש." : "אין הוצאות לפרויקט"}</p>`;

  documentHost.innerHTML = documentRows.length ? documentRows.map((row, index) => `
    <button type="button" class="project-related-row" data-project-document-id="${escapeHtml(row.id)}">
      <span class="project-related-row-main">
        <strong>${escapeHtml(row.display_name || row.original_filename)}</strong>
        <small>${escapeHtml(row.original_filename)}</small>
      </span>
      <span aria-hidden="true">›</span>
    </button>
  `).join("") : `<p class="project-related-empty">${currentProjectDocumentRows.length ? "לא נמצאו מסמכי פרויקט התואמים לחיפוש." : "לא הועלו מסמכי פרויקט"}</p>`;

  documentHost.querySelectorAll("[data-project-document-id]").forEach(button => {
    button.addEventListener("click", () => {
      const documentIndex = currentProjectDocumentRows.findIndex(row => row.id === button.dataset.projectDocumentId);
      if(documentIndex < 0) return;
      void openSharedDocumentViewer({
        documentMeta: currentProjectDocumentRows[documentIndex],
        documents: currentProjectDocumentRows,
        initialIndex: documentIndex,
        title: currentProjectDocumentRows[documentIndex].display_name || "מסמך פרויקט",
        statusElement: $("projectCardStatus"),
        opener: button
      });
    });
  });
}

async function openCurrentProjectIncomeView(){
  if(!currentProjectId) return;
  incomeFilterState = {...DEFAULT_INCOME_FILTER_STATE, projectId:currentProjectId};
  incomeFilterDraft = {...incomeFilterState};
  syncIncomeFilterDialogFromState();
  renderIncomeFilterChips();
  await loadZReports();
  activateView("incomeView");
}

async function openCurrentProjectExpenseView(){
  if(!currentProjectId) return;
  expenseFilterState = {...DEFAULT_EXPENSE_FILTER_STATE, projectId:currentProjectId};
  expenseFilterDraft = {...expenseFilterState};
  syncExpenseFilterDialogFromState();
  renderExpenseFilterChips();
  await loadExpenses();
  activateView("expensesView");
}

function renderProjectCard(){
  const project = currentProjectCard;
  if(!project) return;
  $("projectCardName").textContent = project.name;
  $("projectCardDescription").textContent = project.description || "ללא תיאור";
  $("projectCardNotes").textContent = project.notes || "ללא הערות";
  const statusBadge = $("projectCardStatusBadge");
  statusBadge.textContent = project.is_active ? "פעיל" : "לא פעיל";
  statusBadge.classList.toggle("is-active", Boolean(project.is_active));
  const isDefault = project.id === defaultProjectId;
  $("projectCardDefaultBadge").classList.toggle("hidden", !isDefault);
  $("projectSetDefaultButton").classList.toggle(
    "hidden",
    isDefault || project.is_general || !project.is_active
  );
  $("projectCardDeleteButton").disabled = false;
  $("projectCardDeleteButton").title = project.is_general ? "לא ניתן למחוק את הפרויקט כללי" : "מחיקת פרויקט";
  $("projectDocumentsZipButton").disabled = currentProjectDocumentRows.length === 0;

  const incomeTotal = currentProjectIncomeRows.reduce((sum, row) => sum + Number(row.total_income_ils || 0), 0);
  const expenseTotal = currentProjectExpenseRows.reduce((sum, row) => sum + Number(row.gross_ils || 0), 0);
  $("projectCardIncomeTotal").textContent = money(incomeTotal);
  $("projectCardExpenseTotal").textContent = moneyAbs(expenseTotal);
  $("projectCardProfitTotal").textContent = money(incomeTotal - expenseTotal);
  void renderProjectProfileImage($("projectCardProfile"), project);
  renderProjectRelatedRows();
}

async function setCurrentProjectAsDefault(){
  const project = currentProjectCard;
  if(!project || project.is_general || !project.is_active || project.id === defaultProjectId) return;
  if(!window.confirm(`להגדיר את ${project.name} כפרויקט ברירת המחדל?`)) return;

  const button = $("projectSetDefaultButton");
  button.disabled = true;
  setStatus($("projectCardStatus"), "מעדכנת את פרויקט ברירת המחדל...", "");
  try {
    const {data, error} = await sb.from("business_settings")
      .update({default_project_id:project.id})
      .eq("user_id", userId)
      .select("default_project_id")
      .maybeSingle();
    if(error) throw error;
    if(data?.default_project_id !== project.id){
      throw new Error("לא נמצאה הגדרת עסק לעדכון");
    }

    defaultProjectId = project.id;
    renderProjectCard();
    renderProjectsList();
    setStatus($("projectCardStatus"), "הפרויקט הוגדר כברירת מחדל", "ok");
  } catch(error){
    console.error(error);
    setStatus($("projectCardStatus"), error?.message || "שגיאה בעדכון פרויקט ברירת המחדל", "error");
  } finally {
    button.disabled = false;
  }
}

async function fetchAllProjectRelatedRows(buildQuery){
  const pageSize = 1000;
  const rows = [];
  for(let from = 0; ; from += pageSize){
    const {data, error} = await buildQuery().range(from, from + pageSize - 1);
    if(error) throw error;
    const pageRows = Array.isArray(data) ? data : [];
    rows.push(...pageRows);
    if(pageRows.length < pageSize) break;
  }
  return rows;
}

async function fetchProjectCardData(projectId){
  const [incomeRows, expenseRows, documentRows] = await Promise.all([
    fetchAllProjectRelatedRows(() => sb.from("daily_z_reports")
      .select("id,report_date,report_time,total_income_ils,income_type,notes,is_from_z_report,reference_number,project_id")
      .eq("user_id", userId)
      .eq("project_id", projectId)
      .order("report_date", {ascending:false})
      .order("id", {ascending:true})),
    fetchAllProjectRelatedRows(() => sb.from("expenses")
      .select("id,document_date,gross_ils,supplier_name_snapshot,document_number,description,notes,project_id")
      .eq("user_id", userId)
      .eq("project_id", projectId)
      .order("document_date", {ascending:false})
      .order("id", {ascending:true})),
    fetchAllProjectRelatedRows(() => sb.from("project_documents")
      .select("id,user_id,project_id,display_name,storage_path,original_filename,mime_type,document_order,created_at,updated_at")
      .eq("user_id", userId)
      .eq("project_id", projectId)
      .order("document_order", {ascending:true})
      .order("created_at", {ascending:true})
      .order("id", {ascending:true}))
  ]);

  return {
    income: incomeRows,
    expenses: expenseRows,
    documents: documentRows
  };
}

async function openProjectCard(projectId){
  const project = getProjectById(projectId);
  if(!project){
    showToast("הפרויקט לא נמצא", "error");
    return;
  }

  setStatus($("projectCardStatus"), "טוענת כרטיס פרויקט...", "");
  try {
    const data = await fetchProjectCardData(project.id);
    currentProjectId = project.id;
    currentProjectCard = project;
    currentProjectIncomeRows = data.income;
    currentProjectExpenseRows = data.expenses;
    currentProjectDocumentRows = data.documents;
    projectCardSearchTerm = "";
    if($("projectCardSearchInput")) $("projectCardSearchInput").value = "";
    setStatus($("projectDocumentsZipStatus"), "", "");
    renderProjectCard();
    setStatus($("projectCardStatus"), "", "");
    activateView("projectCardView");
  } catch(error){
    console.error(error);
    setStatus($("projectCardStatus"), error?.message || "שגיאה בטעינת כרטיס הפרויקט", "error");
  }
}

function clearProjectEditorPreviewUrl(){
  if(!projectEditorPreviewUrl) return;
  URL.revokeObjectURL(projectEditorPreviewUrl);
  projectEditorPreviewUrl = "";
}

function renderProjectEditorProfilePreview(){
  const preview = $("projectEditorProfilePreview");
  if(!preview) return;
  clearProjectEditorPreviewUrl();
  const project = getProjectById(currentProjectEditorId);
  const hasProfileImage = Boolean(
    selectedProjectProfileFile
    || (!removeCurrentProjectProfile && project?.profile_storage_path)
  );
  $("projectEditorProfileBrowseButton").textContent = hasProfileImage ? "החליפי תמונה" : "בחרי תמונה";
  $("projectEditorProfileRemoveButton").classList.toggle("hidden", !hasProfileImage);
  if(selectedProjectProfileFile){
    projectEditorPreviewUrl = URL.createObjectURL(selectedProjectProfileFile);
    preview.innerHTML = `<img src="${projectEditorPreviewUrl}" alt="תמונה חדשה לפרויקט">`;
    return;
  }
  if(removeCurrentProjectProfile || !project?.profile_storage_path){
    preview.innerHTML = "";
    preview.textContent = getProjectFallbackLetter(project);
    return;
  }
  void renderProjectProfileImage(preview, project);
}

function openProjectEditor(projectId = ""){
  const project = getProjectById(projectId);
  currentProjectEditorId = project?.id || "";
  selectedProjectProfileFile = null;
  removeCurrentProjectProfile = false;
  $("projectEditorTitle").textContent = project ? "עריכת פרויקט" : "פרויקט חדש";
  $("projectEditorName").value = project?.name || "";
  $("projectEditorDescription").value = project?.description || "";
  $("projectEditorNotes").value = project?.notes || "";
  $("projectEditorActive").checked = project ? Boolean(project.is_active) : true;
  $("projectEditorName").disabled = false;
  $("projectEditorActive").disabled = false;
  $("projectEditorProfileInput").value = "";
  setStatus($("projectEditorStatus"), "", "");
  renderProjectEditorProfilePreview();
  $("projectEditorDialog")?.showModal();
  $("projectEditorName")?.focus();
}

function buildProjectProfileStoragePath(projectId, file){
  return `${userId}/projects/${projectId}/profile/${generateClientSideUuid()}-${sanitizeStorageFilename(file?.name || "profile")}`;
}

async function cleanupProjectStoragePaths(paths){
  const safePaths = (Array.isArray(paths) ? paths : []).map(path => String(path || "").trim()).filter(Boolean);
  if(!safePaths.length) return;
  const cleanupError = await cleanupUploadedExpenseFiles(safePaths);
  if(cleanupError) enqueuePendingExpenseStorageCleanup(safePaths);
}

async function saveProjectEditor(event){
  event.preventDefault();
  const existingProject = getProjectById(currentProjectEditorId);
  const projectId = existingProject?.id || generateClientSideUuid();
  const name = String($("projectEditorName").value || "").trim();
  if(!name){
    setFieldInvalid($("projectEditorName"), "שם פרויקט הוא שדה חובה");
    $("projectEditorName").focus();
    return;
  }

  const controls = Array.from($("projectEditorForm")?.querySelectorAll("button,input,textarea") || []);
  let uploadedProfilePath = "";
  const oldProfilePath = String(existingProject?.profile_storage_path || "").trim();
  setInformationActionBusy(controls, true);
  setStatus($("projectEditorStatus"), "שומרת פרויקט...", "");

  try {
    let profileMetadata = existingProject ? {
      profile_storage_path: existingProject.profile_storage_path,
      profile_original_filename: existingProject.profile_original_filename,
      profile_mime_type: existingProject.profile_mime_type
    } : {
      profile_storage_path: null,
      profile_original_filename: null,
      profile_mime_type: null
    };

    if(removeCurrentProjectProfile){
      profileMetadata = {
        profile_storage_path: null,
        profile_original_filename: null,
        profile_mime_type: null
      };
    }

    if(selectedProjectProfileFile){
      if(!String(selectedProjectProfileFile.type || "").startsWith("image/")){
        throw new Error("תמונת הפרופיל חייבת להיות קובץ תמונה");
      }
      uploadedProfilePath = buildProjectProfileStoragePath(projectId, selectedProjectProfileFile);
      const uploadResult = await sb.storage.from("invoice-documents").upload(
        uploadedProfilePath,
        selectedProjectProfileFile,
        {contentType:selectedProjectProfileFile.type, upsert:false}
      );
      if(uploadResult.error) throw uploadResult.error;
      profileMetadata = {
        profile_storage_path: uploadedProfilePath,
        profile_original_filename: selectedProjectProfileFile.name || "profile",
        profile_mime_type: selectedProjectProfileFile.type
      };
    }

    const payload = {
      user_id: userId,
      name: existingProject?.is_general ? "כללי" : name,
      description: String($("projectEditorDescription").value || "").trim(),
      notes: String($("projectEditorNotes").value || "").trim(),
      is_active: existingProject?.is_general ? true : Boolean($("projectEditorActive").checked),
      ...profileMetadata
    };

    const result = existingProject
      ? await sb.from("projects").update(payload).eq("user_id", userId).eq("id", projectId)
      : await sb.from("projects").insert({id:projectId, ...payload, is_general:false});
    if(result.error) throw result.error;

    if(oldProfilePath && oldProfilePath !== profileMetadata.profile_storage_path){
      await cleanupProjectStoragePaths([oldProfilePath]);
    }

    $("projectEditorDialog")?.close();
    await loadProjectsLookup();
    showToast(existingProject ? "הפרויקט עודכן" : "הפרויקט נוצר", "ok");
    await openProjectCard(projectId);
  } catch(error){
    console.error(error);
    if(uploadedProfilePath) await cleanupProjectStoragePaths([uploadedProfilePath]);
    setStatus($("projectEditorStatus"), error?.message || "שגיאה בשמירת הפרויקט", "error");
  } finally {
    setInformationActionBusy(controls, false);
  }
}

function renderProjectDocumentsManageList(){
  const host = $("projectDocumentsManageList");
  if(!host) return;
  if(!currentProjectDocumentRows.length){
    host.innerHTML = '<p class="project-related-empty">אין מסמכי פרויקט.</p>';
    return;
  }

  host.innerHTML = currentProjectDocumentRows.map(row => `
    <div class="project-document-manage-row">
      <div>
        <strong>${escapeHtml(row.display_name || row.original_filename)}</strong>
        <small>${escapeHtml(row.original_filename)}</small>
      </div>
      <div class="project-document-manage-actions">
        <button type="button" class="row-action" data-project-document-open="${escapeHtml(row.id)}" aria-label="פתיחת מסמך" title="פתיחת מסמך">◉</button>
        <button type="button" class="row-action edit-action" data-project-document-replace="${escapeHtml(row.id)}" aria-label="החלפת מסמך" title="החלפת מסמך">✎</button>
        <button type="button" class="row-action delete-action" data-project-document-delete="${escapeHtml(row.id)}" aria-label="מחיקת מסמך" title="מחיקת מסמך">✕</button>
      </div>
    </div>
  `).join("");

  host.querySelectorAll("[data-project-document-open]").forEach(button => {
    button.addEventListener("click", () => {
      const index = currentProjectDocumentRows.findIndex(row => row.id === button.dataset.projectDocumentOpen);
      if(index < 0) return;
      void openSharedDocumentViewer({
        documentMeta: currentProjectDocumentRows[index],
        documents: currentProjectDocumentRows,
        initialIndex:index,
        title:currentProjectDocumentRows[index].display_name,
        statusElement:$("projectDocumentsStatus"),
        opener:button
      });
    });
  });
  host.querySelectorAll("[data-project-document-replace]").forEach(button => {
    button.addEventListener("click", () => {
      pendingProjectDocumentReplacementId = button.dataset.projectDocumentReplace || "";
      openFileInputPicker($("projectDocumentReplaceInput"), {resetValue:true});
    });
  });
  host.querySelectorAll("[data-project-document-delete]").forEach(button => {
    button.addEventListener("click", () => void deleteProjectDocument(button.dataset.projectDocumentDelete));
  });
}

function buildProjectDocumentStoragePath(projectId, file){
  return `${userId}/projects/${projectId}/documents/${generateClientSideUuid()}-${sanitizeStorageFilename(file?.name || "document")}`;
}

function getProjectDocumentMetadata(file, storagePath, order = 0, displayName = ""){
  const mimeType = resolveCompanyDocumentMimeType(file);
  if(!(mimeType === "application/pdf" || mimeType.startsWith("image/"))){
    throw new Error("ניתן להעלות רק תמונות או PDF למסמכי פרויקט");
  }
  return {
    display_name:String(displayName || "").trim() || file.name || "מסמך",
    storage_path:storagePath,
    original_filename:file.name || "document",
    mime_type:mimeType,
    document_order:order
  };
}

async function refreshCurrentProjectCardData(){
  if(!currentProjectId) return;
  const data = await fetchProjectCardData(currentProjectId);
  currentProjectIncomeRows = data.income;
  currentProjectExpenseRows = data.expenses;
  currentProjectDocumentRows = data.documents;
  renderProjectCard();
  renderProjectDocumentsManageList();
}

function clearPendingProjectDocument(){
  pendingProjectDocumentFile = null;
  $("projectDocumentPendingForm").classList.add("hidden");
  $("projectDocumentPendingFilename").textContent = "";
  $("projectDocumentTitleInput").value = "";
  $("projectDocumentAddInput").value = "";
}

function stageProjectDocument(file){
  if(!file) return;
  try {
    getProjectDocumentMetadata(file, "pending");
  } catch(error){
    setStatus($("projectDocumentsStatus"), error?.message || "סוג המסמך אינו נתמך", "error");
    return;
  }
  pendingProjectDocumentFile = file;
  $("projectDocumentPendingFilename").textContent = `שם הקובץ המקורי: ${file.name || "מסמך"}`;
  $("projectDocumentTitleInput").value = "";
  $("projectDocumentPendingForm").classList.remove("hidden");
  setStatus($("projectDocumentsStatus"), "הזיני כותרת ואשרי כדי לשמור את המסמך.", "");
  $("projectDocumentTitleInput").focus();
}

async function confirmProjectDocument(event){
  event.preventDefault();
  const file = pendingProjectDocumentFile;
  const displayName = String($("projectDocumentTitleInput").value || "").trim();
  if(!file || !currentProjectId){
    setStatus($("projectDocumentsStatus"), "בחרי קובץ לפני השמירה.", "error");
    return;
  }
  if(!displayName){
    setFieldInvalid($("projectDocumentTitleInput"), "יש להזין כותרת למסמך");
    $("projectDocumentTitleInput").focus();
    return;
  }
  const uploadedPaths = [];
  const controls = Array.from($("projectDocumentPendingForm").querySelectorAll("button,input"));
  setInformationActionBusy(controls, true);
  setStatus($("projectDocumentsStatus"), "מעלה מסמך...", "");
  try {
    const storagePath = buildProjectDocumentStoragePath(currentProjectId, file);
    const metadata = getProjectDocumentMetadata(file, storagePath, currentProjectDocumentRows.length, displayName);
    const upload = await sb.storage.from("invoice-documents").upload(storagePath, file, {contentType:metadata.mime_type, upsert:false});
    if(upload.error) throw upload.error;
    uploadedPaths.push(storagePath);

    const {error} = await sb.rpc("update_project_documents_atomic", {
      p_project_id:currentProjectId,
      p_replacements:[],
      p_additions:[metadata],
      p_deleted_document_ids:[]
    });
    if(error) throw error;
    await refreshCurrentProjectCardData();
    clearPendingProjectDocument();
    setStatus($("projectDocumentsStatus"), "המסמך נוסף", "ok");
  } catch(error){
    console.error(error);
    await cleanupProjectStoragePaths(uploadedPaths);
    setStatus($("projectDocumentsStatus"), error?.message || "שגיאה בהוספת המסמך", "error");
  } finally {
    setInformationActionBusy(controls, false);
  }
}

async function replaceProjectDocument(documentId, file){
  const row = currentProjectDocumentRows.find(document => document.id === documentId);
  if(!row || !file) return;
  const storagePath = buildProjectDocumentStoragePath(currentProjectId, file);
  try {
    const metadata = getProjectDocumentMetadata(file, storagePath, row.document_order, row.display_name);
    setStatus($("projectDocumentsStatus"), "מחליפה מסמך...", "");
    const upload = await sb.storage.from("invoice-documents").upload(storagePath, file, {contentType:metadata.mime_type, upsert:false});
    if(upload.error) throw upload.error;
    const {data, error} = await sb.rpc("update_project_documents_atomic", {
      p_project_id:currentProjectId,
      p_replacements:[{document_id:documentId, ...metadata}],
      p_additions:[],
      p_deleted_document_ids:[]
    });
    if(error){
      await cleanupProjectStoragePaths([storagePath]);
      throw error;
    }
    const result = Array.isArray(data) ? data[0] : data;
    await cleanupProjectStoragePaths(result?.storage_paths || []);
    await refreshCurrentProjectCardData();
    setStatus($("projectDocumentsStatus"), "המסמך הוחלף", "ok");
  } catch(error){
    console.error(error);
    setStatus($("projectDocumentsStatus"), error?.message || "שגיאה בהחלפת המסמך", "error");
  }
}

async function deleteProjectDocument(documentId){
  const row = currentProjectDocumentRows.find(document => document.id === documentId);
  if(!row || !confirm(`למחוק את המסמך "${row.display_name || row.original_filename}"?`)) return;
  try {
    const {data, error} = await sb.rpc("update_project_documents_atomic", {
      p_project_id:currentProjectId,
      p_replacements:[],
      p_additions:[],
      p_deleted_document_ids:[documentId]
    });
    if(error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    await cleanupProjectStoragePaths(result?.storage_paths || []);
    await refreshCurrentProjectCardData();
    setStatus($("projectDocumentsStatus"), "המסמך נמחק", "ok");
  } catch(error){
    console.error(error);
    setStatus($("projectDocumentsStatus"), error?.message || "שגיאה במחיקת המסמך", "error");
  }
}

function openProjectDocumentsManager(){
  if(!currentProjectCard) return;
  clearPendingProjectDocument();
  $("projectDocumentsDialogTitle").textContent = `מסמכי ${currentProjectCard.name}`;
  setStatus($("projectDocumentsStatus"), "", "");
  renderProjectDocumentsManageList();
  $("projectDocumentsDialog")?.showModal();
}

function collectProjectCardInfoReport(){
  if(!currentProjectCard) return {title:"כרטיס פרויקט", headers:[], rows:[]};
  const incomeTotal = currentProjectIncomeRows.reduce((sum, row) => sum + Number(row.total_income_ils || 0), 0);
  const expenseTotal = currentProjectExpenseRows.reduce((sum, row) => sum + Number(row.gross_ils || 0), 0);
  const rows = [
    ["פרויקט", "", currentProjectCard.name, ""],
    ["מצב", "", currentProjectCard.is_active ? "פעיל" : "לא פעיל", ""],
    ["תיאור", "", currentProjectCard.description || "", ""],
    ["הערות", "", currentProjectCard.notes || "", ""],
    ["סיכום", "", "הכנסות", money(incomeTotal)],
    ["סיכום", "", "הוצאות", moneyAbs(expenseTotal)],
    ["סיכום", "", "רווח / הפסד", money(incomeTotal - expenseTotal)],
    ...currentProjectIncomeRows.map(row => ["הכנסה", row.report_date || "", normalizeIncomeType(row.income_type), money(row.total_income_ils || 0)]),
    ...currentProjectExpenseRows.map(row => ["הוצאה", row.document_date || "", row.supplier_name_snapshot || row.description || "הוצאה", moneyAbs(row.gross_ils || 0)]),
    ...currentProjectDocumentRows.map(row => ["מסמך פרויקט", "", row.display_name || row.original_filename, row.original_filename])
  ];
  return {
    title:`כרטיס פרויקט - ${currentProjectCard.name}`,
    filenameBase:`project-${sanitizeStorageFilename(currentProjectCard.name)}-${today()}`,
    headers:["סוג", "תאריך", "פרטים", "סכום / קובץ"],
    rows,
    filters:[],
    sortDescription:"מידע הפרויקט"
  };
}

async function ensureProjectZipLibrary(){
  if(window.JSZip) return window.JSZip;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("טעינת רכיב ZIP נכשלה"));
    document.head.appendChild(script);
  });
  if(!window.JSZip) throw new Error("רכיב ZIP אינו זמין");
  return window.JSZip;
}

function getUniqueProjectZipFilename(filename, usedNames){
  const original = String(filename || "document").trim() || "document";
  if(!usedNames.has(original)){
    usedNames.add(original);
    return original;
  }
  const dotIndex = original.lastIndexOf(".");
  const stem = dotIndex > 0 ? original.slice(0, dotIndex) : original;
  const extension = dotIndex > 0 ? original.slice(dotIndex) : "";
  let counter = 2;
  while(usedNames.has(`${stem}-${counter}${extension}`)) counter += 1;
  const uniqueName = `${stem}-${counter}${extension}`;
  usedNames.add(uniqueName);
  return uniqueName;
}

async function downloadCurrentProjectDocumentsZip(){
  if(!currentProjectCard || !currentProjectDocumentRows.length) return;
  const button = $("projectDocumentsZipButton");
  button.disabled = true;
  setStatus($("projectDocumentsZipStatus"), "יוצרת קובץ ZIP...", "");
  try {
    const JSZip = await ensureProjectZipLibrary();
    const zip = new JSZip();
    const usedNames = new Set();
    for(const documentRow of currentProjectDocumentRows){
      const signedUrl = await createSignedUrlForStoragePath(documentRow.storage_path, 300);
      const blob = await fetchBlobFromSignedUrl(signedUrl);
      zip.file(getUniqueProjectZipFilename(documentRow.original_filename, usedNames), blob);
    }
    const zipBlob = await zip.generateAsync({type:"blob", compression:"DEFLATE"});
    if(!zipBlob.size) throw new Error("יצירת קובץ ZIP נכשלה");
    downloadBlob(zipBlob, `project-${sanitizeStorageFilename(currentProjectCard.name)}-documents.zip`);
    setStatus($("projectDocumentsZipStatus"), "קובץ ה-ZIP הורד", "ok");
  } catch(error){
    console.error(error);
    setStatus($("projectDocumentsZipStatus"), error?.message || "הורדת קובץ ZIP נכשלה", "error");
  } finally {
    button.disabled = currentProjectDocumentRows.length === 0;
  }
}

const projectRelationshipLabels = {
  calendar_events:"אירועי יומן",
  daily_z_reports:"הכנסות",
  employee_work_logs:"דיווחי עבודה",
  expenses:"הוצאות",
  inventory_item_balances:"יתרות מלאי",
  inventory_items:"פריטי מלאי",
  inventory_movements:"תנועות מלאי",
  project_documents:"מסמכי פרויקט"
};

function getProjectDeletionBlockedMessage(result){
  if(result?.blocked_reason === "general_project") return "לא ניתן למחוק את הפרויקט כללי.";
  if(result?.blocked_reason === "default_project"){
    return "הפרויקט מוגדר כברירת מחדל. יש לבחור במפורש פרויקט ברירת מחדל אחר לפני המחיקה.";
  }

  const relationshipCounts = Object.entries(result?.relationship_counts || {})
    .filter(([, count]) => Number(count) > 0)
    .map(([tableName, count]) => `${projectRelationshipLabels[tableName] || tableName}: ${Number(count)}`);
  if(Number(result?.default_reference_count) > 0){
    relationshipCounts.push(`הגדרת ברירת מחדל: ${Number(result.default_reference_count)}`);
  }
  const details = relationshipCounts.length ? ` (${relationshipCounts.join(", ")})` : "";
  return `לא ניתן למחוק פרויקט שנמצא בשימוש${details}. ניתן להפוך אותו ללא פעיל במקום למחוק.`;
}

function openProjectDeleteDialog(){
  if(!currentProjectCard) return;
  if(currentProjectCard.is_general){
    showToast("הפרויקט כללי מוגן ולא ניתן למחיקה.", "warning");
    return;
  }
  $("projectDeleteSummary").textContent = "מחיקה אפשרית רק לפרויקט שאינו מקושר לשום פעילות או תוכן.";
  $("projectDeleteDefaultField").classList.add("hidden");
  $("projectDeleteDefaultProject").innerHTML = "";
  $("projectDeleteConfirmButton").classList.remove("hidden");
  $("projectDeleteConfirmButton").textContent = "מחקי את הפרויקט";
  setStatus($("projectDeleteStatus"), "", "");
  $("projectDeleteDialog")?.showModal();
}

async function executeProjectDeletion(){
  if(projectDeleteInFlight || !currentProjectCard) return;
  const requiresNewDefault = !$("projectDeleteDefaultField").classList.contains("hidden");
  const newDefaultProjectId = requiresNewDefault
    ? String($("projectDeleteDefaultProject").value || "").trim()
    : "";
  if(requiresNewDefault && !newDefaultProjectId){
    setFieldInvalid($("projectDeleteDefaultProject"), "יש לבחור פרויקט ברירת מחדל חדש");
    $("projectDeleteDefaultProject").focus();
    return;
  }

  projectDeleteInFlight = true;
  const controls = Array.from($("projectDeleteDialog")?.querySelectorAll("button,select") || []);
  setInformationActionBusy(controls, true);
  setStatus($("projectDeleteStatus"), "בודקת שהפרויקט אינו בשימוש...", "");
  try {
    const {data, error} = await sb.rpc("delete_unused_project_atomic", {
      p_project_id:currentProjectId,
      p_new_default_project_id:newDefaultProjectId || null
    });
    if(error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if(!result?.deleted){
      if(result?.blocked_reason === "default_project"){
        populateProjectSelect($("projectDeleteDefaultProject"), {mode:"assignment"});
        Array.from($("projectDeleteDefaultProject").options).forEach(option => {
          if(option.value === currentProjectId) option.remove();
        });
        $("projectDeleteDefaultProject").value = "";
        $("projectDeleteDefaultField").classList.remove("hidden");
        $("projectDeleteConfirmButton").classList.remove("hidden");
        $("projectDeleteConfirmButton").textContent = "החליפי ברירת מחדל ומחקי";
        setStatus($("projectDeleteStatus"), "יש לבחור פרויקט פעיל אחר כברירת המחדל החדשה. הפרויקט כללי זמין לבחירה.", "");
        return;
      }
      $("projectDeleteConfirmButton").classList.add("hidden");
      setStatus($("projectDeleteStatus"), getProjectDeletionBlockedMessage(result), "error");
      return;
    }
    await cleanupProjectStoragePaths([result.profile_storage_path]);
    $("projectDeleteDialog")?.close();
    currentProjectId = "";
    currentProjectCard = null;
    currentProjectIncomeRows = [];
    currentProjectExpenseRows = [];
    currentProjectDocumentRows = [];
    await loadProjectsLookup();
    await Promise.all([loadExpenses(), loadZReports(), loadDashboard()]);
    activateView("projectsView", {historyMode:"replace"});
    showToast("הפרויקט נמחק", "ok");
  } catch(error){
    console.error(error);
    setStatus($("projectDeleteStatus"), error?.message || "שגיאה במחיקת הפרויקט", "error");
  } finally {
    projectDeleteInFlight = false;
    setInformationActionBusy(controls, false);
  }
}

document.querySelectorAll("[data-entity-view]").forEach(card => {
  card.addEventListener("click", () => activateView(card.dataset.entityView));
});

document.querySelectorAll("[data-unavailable-entity]").forEach(card => {
  card.addEventListener("click", () => showToast(`${card.dataset.unavailableEntity}: זמין בהמשך`, "warning"));
});

$("projectsSearchInput")?.addEventListener("input", event => {
  projectsSearchTerm = event.target.value || "";
  renderProjectsList();
});

document.querySelectorAll("[data-project-status-filter]").forEach(button => {
  button.addEventListener("click", () => {
    projectsStatusFilter = button.dataset.projectStatusFilter || "active";
    renderProjectsList();
  });
});

$("projectCreateButton")?.addEventListener("click", () => openProjectEditor());
$("projectCardEditButton")?.addEventListener("click", () => {
  openProjectEditor(currentProjectId);
});
$("projectCardDeleteButton")?.addEventListener("click", openProjectDeleteDialog);
$("projectSetDefaultButton")?.addEventListener("click", () => void setCurrentProjectAsDefault());
$("projectCardSearchInput")?.addEventListener("input", event => {
  projectCardSearchTerm = event.target.value || "";
  renderProjectRelatedRows();
});
$("projectDocumentsManageButton")?.addEventListener("click", openProjectDocumentsManager);
$("projectDocumentsZipButton")?.addEventListener("click", () => void downloadCurrentProjectDocumentsZip());
$("projectIncomeSummary")?.addEventListener("click", () => void openCurrentProjectIncomeView());
$("projectExpenseSummary")?.addEventListener("click", () => void openCurrentProjectExpenseView());

$("projectEditorProfileBrowseButton")?.addEventListener("click", () => openFileInputPicker($("projectEditorProfileInput"), {resetValue:true}));
$("projectEditorProfileInput")?.addEventListener("change", event => {
  selectedProjectProfileFile = event.target.files?.[0] || null;
  removeCurrentProjectProfile = false;
  renderProjectEditorProfilePreview();
});
$("projectEditorProfileRemoveButton")?.addEventListener("click", () => {
  selectedProjectProfileFile = null;
  removeCurrentProjectProfile = true;
  $("projectEditorProfileInput").value = "";
  renderProjectEditorProfilePreview();
});
$("projectEditorName")?.addEventListener("input", () => {
  const project = getProjectById(currentProjectEditorId);
  if(!project?.is_general || $("projectEditorName").value === "כללי") return;
  $("projectEditorName").value = "כללי";
  setStatus($("projectEditorStatus"), "השם של הפרויקט כללי מוגן ואינו ניתן לשינוי.", "warning");
  showToast("השם של הפרויקט כללי מוגן ואינו ניתן לשינוי.", "warning");
});
$("projectEditorActive")?.addEventListener("change", () => {
  const project = getProjectById(currentProjectEditorId);
  if(!project?.is_general) return;
  $("projectEditorActive").checked = true;
  setStatus($("projectEditorStatus"), "המצב הפעיל של הפרויקט כללי מוגן ואינו ניתן לשינוי.", "warning");
  showToast("המצב הפעיל של הפרויקט כללי מוגן ואינו ניתן לשינוי.", "warning");
});
$("projectEditorForm")?.addEventListener("submit", event => void saveProjectEditor(event));
$("projectEditorDialog")?.addEventListener("close", () => {
  clearProjectEditorPreviewUrl();
  selectedProjectProfileFile = null;
  removeCurrentProjectProfile = false;
});

$("projectDocumentAddButton")?.addEventListener("click", () => openFileInputPicker($("projectDocumentAddInput"), {resetValue:true}));
$("projectDocumentAddInput")?.addEventListener("change", event => {
  stageProjectDocument(event.target.files?.[0] || null);
});
$("projectDocumentPendingForm")?.addEventListener("submit", event => void confirmProjectDocument(event));
$("projectDocumentCancelButton")?.addEventListener("click", clearPendingProjectDocument);
$("projectDocumentReplaceInput")?.addEventListener("change", event => {
  const file = event.target.files?.[0] || null;
  const documentId = pendingProjectDocumentReplacementId;
  pendingProjectDocumentReplacementId = "";
  event.target.value = "";
  if(file && documentId) void replaceProjectDocument(documentId, file);
});

$("projectDeleteConfirmButton")?.addEventListener("click", () => void executeProjectDeletion());
$("projectDeleteCancelButton")?.addEventListener("click", () => $("projectDeleteDialog")?.close());

renderProjectsList();