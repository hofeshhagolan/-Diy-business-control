const $ = id => document.getElementById(id);
let sb, session, userId, business = {}, selectedFiles = [];

const money = n => new Intl.NumberFormat("he-IL", {
  style:"currency", currency:"ILS", maximumFractionDigits:0
}).format(Number(n || 0));

const today = () => new Date().toISOString().slice(0,10);
const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`;
};

function setStatus(el,msg,type=""){ el.textContent = msg || ""; el.className = `status ${type}`; }

async function init(){
  try{
    const response = await fetch("/api/config");
    const config = await response.json();
    if(!response.ok) throw new Error(config.detail || "שגיאת הגדרה");

    sb = window.supabase.createClient(config.supabase_url, config.supabase_anon_key);

    const {data:{session:current}} = await sb.auth.getSession();
    session = current;

    sb.auth.onAuthStateChange(async(_,next)=>{
      session = next;
      if(next) await enterApp(); else showAuth();
    });

    if(session) await enterApp(); else showAuth();

    if("serviceWorker" in navigator){
      navigator.serviceWorker.register("/service-worker.js").catch(console.error);
    }
  }catch(error){
    setStatus($("loginStatus"), error.message, "error");
  }
}

function showAuth(){
  $("authScreen").classList.remove("hidden");
  $("appShell").classList.add("hidden");
}

async function enterApp(){
  userId = session.user.id;
  $("authScreen").classList.add("hidden");
  $("appShell").classList.remove("hidden");

  await loadBusiness();
  await loadLookups();
  await Promise.all([loadDashboard(), loadExpenses(), loadZReports(), loadEmployees()]);
}

$("loginTab").onclick = () => {
  $("loginForm").classList.remove("hidden");
  $("signupForm").classList.add("hidden");
  $("loginTab").classList.add("active");
  $("signupTab").classList.remove("active");
};

$("signupTab").onclick = () => {
  $("signupForm").classList.remove("hidden");
  $("loginForm").classList.add("hidden");
  $("signupTab").classList.add("active");
  $("loginTab").classList.remove("active");
};

$("loginForm").onsubmit = async event => {
  event.preventDefault();
  const {error} = await sb.auth.signInWithPassword({
    email:$("loginEmail").value.trim(),
    password:$("loginPassword").value
  });
  if(error) setStatus($("loginStatus"), error.message, "error");
};

$("signupForm").onsubmit = async event => {
  event.preventDefault();
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
  const email = $("loginEmail").value.trim();
  if(!email) return setStatus($("loginStatus"), "הזיני מייל", "error");

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
    const {data} = await sb.from(table)
      .select("id,name")
      .eq("user_id",userId)
      .eq("is_active",true)
      .order("sort_order");

    $(id).innerHTML =
      '<option value="">ללא בחירה</option>' +
      (data || []).map(x => `<option value="${x.id}">${x.name}</option>`).join("");
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
  const from = monthStart();

  const [{data:expenses},{data:income}] = await Promise.all([
    sb.from("expenses").select("gross_ils").eq("user_id",userId).gte("document_date",from),
    sb.from("daily_z_reports").select("total_income_ils").eq("user_id",userId).gte("report_date",from)
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
    <table>
      <tr>
        <th>👁</th>
        <th>תאריך</th>
        <th>סכום</th>
        <th>ספק</th>
        <th>סוג חשבונאי</th>
        <th>מקור תשלום</th>
      </tr>
      ${(data || []).map(row => `
        <tr>
          <td><button class="eye" data-expense="${row.id}">👁</button></td>
          <td>${row.document_date || ""}</td>
          <td>${money(row.gross_ils)}</td>
          <td>${row.supplier_name_snapshot || ""}</td>
          <td>${row.accounting_types?.name || ""}</td>
          <td>${row.payment_sources?.name || ""}</td>
        </tr>
      `).join("")}
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
    <table>
      <tr><th>תאריך</th><th>הכנסות</th><th>פרויקט</th></tr>
      ${(data || []).map(row => `
        <tr>
          <td>${row.report_date}</td>
          <td>${money(row.total_income_ils)}</td>
          <td>${row.projects?.name || ""}</td>
        </tr>
      `).join("")}
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
    <table>
      <tr><th>שם</th><th>סוג העסקה</th><th>שכר</th><th>פעילה</th></tr>
      ${(data || []).map(row => `
        <tr>
          <td>${row.full_name}</td>
          <td>${row.employment_type === "hourly" ? "שעתי" : "חודשי"}</td>
          <td>${row.employment_type === "hourly" ? money(row.hourly_rate)+"/שעה" : money(row.monthly_salary)}</td>
          <td>${row.is_active ? "כן" : "לא"}</td>
        </tr>
      `).join("")}
    </table>
  ` : "אין עדיין עובדות";
}

document.querySelectorAll(".bottom-nav button").forEach(button => {
  button.onclick = () => {
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    $(button.dataset.view).classList.add("active");

    document.querySelectorAll(".bottom-nav button").forEach(b => b.classList.remove("active"));
    button.classList.add("active");
  };
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

  if(action === "expense") $("expenseDialog").showModal();
  else if(action === "z"){
    $("zDate").value = today();
    $("zDialog").showModal();
  }else{
    alert("הפעולה תתווסף בעדכון הבא.");
  }
}

$("profileButton").onclick = () => $("businessDialog").showModal();

function updateFiles(input){
  selectedFiles = [...input.files];
  setStatus($("expenseStatus"), `${selectedFiles.length} קבצים נבחרו`, "ok");
}

$("cameraInput").onchange = event => updateFiles(event.target);
$("browseInput").onchange = event => updateFiles(event.target);

$("analyzeButton").onclick = async () => {
  if(!selectedFiles.length){
    setStatus($("expenseStatus"), "בחרי תמונה או PDF", "error");
    return;
  }

  setStatus($("expenseStatus"), "קוראת את החשבונית…");

  const formData = new FormData();
  selectedFiles.forEach(file => formData.append("files",file));

  const response = await fetch("/api/analyze-invoice",{
    method:"POST",
    body:formData
  });

  const result = await response.json();

  if(!response.ok){
    setStatus($("expenseStatus"), result.detail || "שגיאה בחילוץ", "error");
    return;
  }

  if(result.multiple_invoices){
    setStatus(
      $("expenseStatus"),
      "נמצאה יותר מחשבונית אחת. צלמי כל חשבונית בנפרד.",
      "error"
    );
    return;
  }

  $("expenseSupplier").value = result.supplier || "";
  $("expenseSupplierReg").value = result.supplier_registration_number || "";
  $("expenseDocumentNumber").value = result.document_number || "";
  $("expenseDate").value = result.document_date || "";
  $("expenseDescription").value = result.description || "";

  if(result.currency_code === "ILS"){
    $("expenseGross").value = result.gross_original || "";
  }

  setStatus($("expenseStatus"), "הנתונים חולצו. בדקי לפני שמירה.", "ok");
};

$("expenseForm").onsubmit = async event => {
  event.preventDefault();

  if(!$("expenseAccountingType").value){
    setStatus($("expenseStatus"), "סוג חשבונאי הוא שדה חובה", "error");
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

  const {data:expense,error} = await sb.from("expenses")
    .insert(payload)
    .select("id")
    .single();

  if(error){
    setStatus($("expenseStatus"), error.message, "error");
    return;
  }

  for(let i=0;i<selectedFiles.length;i++){
    const file = selectedFiles[i];
    const path = `${userId}/${expense.id}/${String(i+1).padStart(3,"0")}-${file.name}`;

    const upload = await sb.storage
      .from("invoice-documents")
      .upload(path,file,{contentType:file.type,upsert:false});

    if(!upload.error){
      await sb.from("expense_documents").insert({
        user_id:userId,
        expense_id:expense.id,
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
  setStatus($("expenseStatus"), "החשבונית נשמרה", "ok");

  await Promise.all([loadExpenses(),loadDashboard()]);
  setTimeout(() => $("expenseDialog").close(),650);
};

$("zForm").onsubmit = async event => {
  event.preventDefault();

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

$("insightsTab").onclick = () => {
  $("insightsPane").classList.remove("hidden");
  $("chatPane").classList.add("hidden");
  $("insightsTab").classList.add("active");
  $("chatTab").classList.remove("active");
};

$("chatTab").onclick = () => {
  $("chatPane").classList.remove("hidden");
  $("insightsPane").classList.add("hidden");
  $("chatTab").classList.add("active");
  $("insightsTab").classList.remove("active");
};

init();
