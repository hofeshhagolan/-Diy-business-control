import base64
import hashlib
import io
import json
import re
import logging
import os
from datetime import datetime
from uuid import uuid4
from pathlib import Path
from typing import List

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from openai import OpenAI
from pypdf import PdfReader
from pypdf.errors import PdfReadError

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("diy-business-control")

app = FastAPI(title="DIY Business Control")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

ALLOWED_CURRENCIES = {"ILS", "USD", "EUR", "GBP"}
CURRENT_CONTRACT_VERSION = "1"
SUPPORTED_CONTRACT_VERSIONS = {CURRENT_CONTRACT_VERSION}
ACTIVE_DOCUMENT_TYPES = {"invoice"}
SINGLE_INVOICE_DEFAULTS = {
    "multiple_invoices": False,
    "supplier": "",
    "supplier_registration_number": "",
    "document_number": "",
    "document_date": "",
    "description": "",
    "gross_original": 0,
    "currency_code": "ILS",
    "suggested_category": "",
    "suggested_accounting_type": "",
}


def _to_number(value) -> float:
    try:
        if value in (None, ""):
            return 0
        return float(value)
    except (TypeError, ValueError):
        return 0


def _to_iso_date_or_empty(value) -> str:
    text = str(value or "").strip()
    if not text:
        return ""

    try:
        datetime.strptime(text, "%Y-%m-%d")
        return text
    except ValueError:
        return ""


def _to_strict_true(value) -> bool:
    if value is True:
        return True
    if isinstance(value, str) and value.strip().lower() == "true":
        return True
    return False


def _normalize_contract_version(value: str) -> str:
    version = str(value or CURRENT_CONTRACT_VERSION).strip()
    if not version:
        return CURRENT_CONTRACT_VERSION
    return version


def _normalize_document_type(value: str) -> str:
    return str(value or "invoice").strip().lower().replace("-", "_")


def _validate_storage_metadata(payload: dict) -> dict:
    if payload.get("storage_metadata_version") != 1:
        raise HTTPException(
            status_code=400,
            detail="storage_metadata_version חייב להיות 1",
        )

    files = payload.get("files")
    if not isinstance(files, list):
        raise HTTPException(
            status_code=400,
            detail="storage_metadata_json.files חייב להיות מערך",
        )

    for idx, item in enumerate(files):
        if not isinstance(item, dict):
            raise HTTPException(
                status_code=400,
                detail=f"storage_metadata_json.files[{idx}] חייב להיות אובייקט",
            )

        if "upload_index" not in item:
            raise HTTPException(
                status_code=400,
                detail=f"storage_metadata_json.files[{idx}].upload_index חסר",
            )

        storage_path = str(item.get("storage_path") or "").strip()
        if not storage_path:
            raise HTTPException(
                status_code=400,
                detail=f"storage_metadata_json.files[{idx}].storage_path חסר",
            )

        original_filename = str(item.get("original_filename") or "").strip()
        if not original_filename:
            raise HTTPException(
                status_code=400,
                detail=f"storage_metadata_json.files[{idx}].original_filename חסר",
            )

    return payload


def _count_pdf_pages(raw_pdf: bytes, filename: str) -> int:
    try:
        reader = PdfReader(io.BytesIO(raw_pdf), strict=False)
        if reader.is_encrypted:
            decrypt_result = reader.decrypt("")
            if decrypt_result == 0:
                raise ValueError(
                    f"לא ניתן לפענח את קובץ ה-PDF {filename or ''}: הקובץ מוצפן"
                )

        page_count = len(reader.pages)
        if page_count <= 0:
            raise ValueError(
                f"לא ניתן לקרוא את קובץ ה-PDF {filename or ''}: לא נמצאו עמודים"
            )

        return page_count
    except ValueError:
        raise
    except PdfReadError as exc:
        raise ValueError(
            f"לא ניתן לקרוא את קובץ ה-PDF {filename or ''}: הקובץ פגום או לא נתמך"
        ) from exc
    except Exception as exc:
        raise ValueError(
            f"לא ניתן לקרוא את קובץ ה-PDF {filename or ''}: שגיאה בקריאת ה-PDF"
        ) from exc


def _is_pdf_upload(mime_type: str, filename: str, raw: bytes) -> bool:
    normalized_mime = str(mime_type or "").strip().lower()
    normalized_name = str(filename or "").strip().lower()

    by_mime = normalized_mime.startswith("application/pdf")
    by_name = normalized_name.endswith(".pdf")
    by_signature = b"%PDF-" in raw[:1024]

    return by_mime or by_name or by_signature


def _normalize_extraction_payload(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("Extraction payload must be a JSON object")

    if _to_strict_true(payload.get("multiple_invoices")):
        return {"multiple_invoices": True}

    normalized = dict(SINGLE_INVOICE_DEFAULTS)
    normalized["supplier"] = str(payload.get("supplier") or "").strip()
    normalized["supplier_registration_number"] = str(
        payload.get("supplier_registration_number") or ""
    ).strip()
    normalized["document_number"] = str(payload.get("document_number") or "").strip()
    normalized["document_date"] = _to_iso_date_or_empty(payload.get("document_date"))
    normalized["description"] = str(payload.get("description") or "").strip()
    normalized["gross_original"] = _to_number(payload.get("gross_original"))

    currency = str(payload.get("currency_code") or "").strip().upper()
    normalized["currency_code"] = currency if currency in ALLOWED_CURRENCIES else "ILS"

    normalized["suggested_category"] = str(
        payload.get("suggested_category") or ""
    ).strip()
    normalized["suggested_accounting_type"] = str(
        payload.get("suggested_accounting_type") or ""
    ).strip()

    return normalized


def _build_extraction_result(payload: dict, document_type: str) -> dict:
    multiple = _to_strict_true(payload.get("multiple_invoices"))
    return {
        "extraction_result_version": 1,
        "document_type": document_type,
        "extraction_mode": "multiple_detected" if multiple else "single",
        "normalization": {
            # Architectural rule: this internal block is always derived from
            # canonical top-level business fields and is never authoritative.
            "derived_from_top_level": True,
            "canonical_business_contract": "top_level_invoice_fields",
            "top_level_fields": [
                "multiple_invoices",
                "supplier",
                "supplier_registration_number",
                "document_number",
                "document_date",
                "description",
                "gross_original",
                "currency_code",
                "suggested_category",
                "suggested_accounting_type",
            ],
            "normalization_version": 1,
        },
    }


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return (STATIC_DIR / "index.html").read_text(encoding="utf-8")


@app.get("/manifest.webmanifest")
def manifest() -> JSONResponse:
    data = json.loads(
        (STATIC_DIR / "manifest.webmanifest").read_text(encoding="utf-8")
    )
    return JSONResponse(data, media_type="application/manifest+json")


@app.get("/service-worker.js")
def service_worker() -> Response:
    content = (STATIC_DIR / "service-worker.js").read_text(encoding="utf-8")
    return Response(content=content, media_type="application/javascript")


@app.get("/api/config")
def config() -> dict:
    url = os.getenv("SUPABASE_URL", "").strip()
    anon = os.getenv("SUPABASE_ANON_KEY", "").strip()

    if not url or not anon:
        raise HTTPException(
            status_code=500,
            detail="חסרות הגדרות SUPABASE_URL או SUPABASE_ANON_KEY ב-Render",
        )

    return {
        "supabase_url": url,
        "supabase_anon_key": anon,
    }


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "supabase_configured": bool(
            os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_ANON_KEY")
        ),
        "openai_configured": bool(os.getenv("OPENAI_API_KEY")),
    }


@app.post("/api/analyze-invoice")
async def analyze_invoice(
    files: List[UploadFile] = File(...),
    document_type: str = Form("invoice"),
    contract_version: str = Form(CURRENT_CONTRACT_VERSION),
    operation_id: str | None = Form(None),
    operation_source: str = Form("web"),
    storage_metadata_json: str | None = Form(None),
) -> dict:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY לא הוגדר ב-Render",
        )

    if not files:
        raise HTTPException(status_code=400, detail="לא התקבל קובץ")

    if len(files) > 12:
        raise HTTPException(
            status_code=400,
            detail="ניתן להעלות עד 12 עמודים לחשבונית אחת",
        )

    normalized_document_type = _normalize_document_type(document_type)
    if normalized_document_type not in ACTIVE_DOCUMENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail="סוג מסמך לא נתמך",
        )

    normalized_contract_version = _normalize_contract_version(contract_version)
    if normalized_contract_version not in SUPPORTED_CONTRACT_VERSIONS:
        raise HTTPException(
            status_code=400,
            detail="גרסת חוזה בקשה לא נתמכת",
        )

    normalized_operation_source = str(operation_source or "web").strip() or "web"
    normalized_operation_id = str(operation_id or "").strip() or str(uuid4())

    storage_metadata = None
    if storage_metadata_json and storage_metadata_json.strip():
        try:
            parsed_storage_metadata = json.loads(storage_metadata_json)
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=400,
                detail="storage_metadata_json אינו JSON תקין",
            ) from exc

        if not isinstance(parsed_storage_metadata, dict):
            raise HTTPException(
                status_code=400,
                detail="storage_metadata_json חייב להיות אובייקט JSON",
            )

        storage_metadata = _validate_storage_metadata(parsed_storage_metadata)

    page_manifest_uploads = []
    page_manifest_pages = []
    global_page_index = 0

    operation_meta = {
        "id": normalized_operation_id,
        "source": normalized_operation_source,
        "document_type": normalized_document_type,
    }
    if storage_metadata is not None:
        operation_meta["storage_metadata"] = storage_metadata

    content = [
        {
            "type": "input_text",
            "text": '''
את מחלצת נתונים מחשבונית אחת בלבד, ישראלית או זרה.
אם מופיעות כמה חשבוניות שונות באותם קבצים, החזירי multiple_invoices=true.
קראי את כל העמודים יחד. הסכום הסופי יכול להופיע בעמוד האחרון.
אין להמציא נתונים.

החזירי JSON בלבד במבנה:
{
  "multiple_invoices": false,
  "supplier": "",
  "supplier_registration_number": "",
  "document_number": "",
  "document_date": "",
  "description": "",
  "gross_original": 0,
  "currency_code": "ILS",
  "suggested_category": "",
  "suggested_accounting_type": ""
}

document_date חייב להיות YYYY-MM-DD או מחרוזת ריקה.
currency_code חייב להיות אחד: ILS, USD, EUR, GBP.
''',
        }
    ]

    for upload_index, upload in enumerate(files):
        raw = await upload.read()
        if not raw:
            continue

        if len(raw) > 20 * 1024 * 1024:
            raise HTTPException(
                status_code=400,
                detail=f"הקובץ {upload.filename or ''} גדול מדי",
            )

        mime_type = upload.content_type or "application/octet-stream"
        is_pdf_upload = _is_pdf_upload(mime_type, upload.filename or "", raw)
        effective_mime_type = "application/pdf" if is_pdf_upload else mime_type
        digest = hashlib.sha256(raw).hexdigest()
        upload_identity = f"upload_{upload_index + 1:03d}_{digest[:12]}"
        if is_pdf_upload:
            try:
                page_count = _count_pdf_pages(raw, upload.filename or "invoice.pdf")
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
        else:
            page_count = 1

        page_manifest_uploads.append(
            {
                "upload_index": upload_index,
                "upload_id": upload_identity,
                "filename": upload.filename or "",
                "mime_type": effective_mime_type,
                "sha256": digest,
                "page_count": page_count,
            }
        )

        for page_number_in_upload in range(1, page_count + 1):
            global_page_index += 1
            page_manifest_pages.append(
                {
                    "page_id": f"{upload_identity}_page_{page_number_in_upload:04d}",
                    "global_page_index": global_page_index,
                    "upload_index": upload_index,
                    "upload_id": upload_identity,
                    "page_number_in_upload": page_number_in_upload,
                }
            )

        encoded = base64.b64encode(raw).decode("ascii")
        data_url = f"data:{effective_mime_type};base64,{encoded}"

        if is_pdf_upload:
            content.append(
                {
                    "type": "input_file",
                    "filename": upload.filename or "invoice.pdf",
                    "file_data": data_url,
                }
            )
        elif effective_mime_type.startswith("image/"):
            content.append(
                {
                    "type": "input_image",
                    "image_url": data_url,
                    "detail": "high",
                }
            )
        else:
            raise HTTPException(
                status_code=400,
                detail=f"סוג הקובץ {effective_mime_type} אינו נתמך",
            )

    try:
        client = OpenAI(api_key=api_key)
        response = client.responses.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
            input=[{"role": "user", "content": content}],
        )
        raw_output = (response.output_text or "").strip()
        logger.info("Raw extraction response: %s", raw_output[:2000])

        if raw_output.startswith("```"):
            raw_output = re.sub(
                r"^```(?:json)?\\s*",
                "",
                raw_output,
                flags=re.IGNORECASE,
            )
            raw_output = re.sub(r"\\s*```$", "", raw_output)

        start = raw_output.find("{")
        end = raw_output.rfind("}")

        if start == -1 or end == -1 or end < start:
            raise json.JSONDecodeError(
                "No JSON object found",
                raw_output,
                0,
            )

        parsed = json.loads(raw_output[start:end + 1])
        normalized = _normalize_extraction_payload(parsed)
        normalized["_contract_version"] = normalized_contract_version
        operation_meta["page_manifest"] = {
            "uploads": page_manifest_uploads,
            "pages": page_manifest_pages,
            "total_pages": len(page_manifest_pages),
        }
        normalized["_operation"] = operation_meta
        normalized["_extraction_result"] = _build_extraction_result(
            normalized,
            normalized_document_type,
        )
        return normalized
    except json.JSONDecodeError as exc:
        logger.exception("Invalid JSON from extraction model")
        raise HTTPException(
            status_code=502,
            detail="התקבלה תשובה לא תקינה ממנוע החילוץ",
        ) from exc
    except ValueError as exc:
        logger.exception("Invalid extraction payload format")
        raise HTTPException(
            status_code=502,
            detail=f"מבנה תשובת חילוץ לא תקין: {str(exc)[:220]}",
        ) from exc
    except Exception as exc:
        logger.exception("Invoice extraction failed")
        raise HTTPException(
            status_code=502,
            detail=f"שגיאה בחילוץ הנתונים: {str(exc)[:220]}",
        ) from exc

