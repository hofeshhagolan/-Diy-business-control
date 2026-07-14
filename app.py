import base64
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
    operation_meta = {
        "id": normalized_operation_id,
        "source": normalized_operation_source,
        "document_type": normalized_document_type,
    }

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

    for upload in files:
        raw = await upload.read()
        if not raw:
            continue

        if len(raw) > 20 * 1024 * 1024:
            raise HTTPException(
                status_code=400,
                detail=f"הקובץ {upload.filename or ''} גדול מדי",
            )

        mime_type = upload.content_type or "application/octet-stream"
        encoded = base64.b64encode(raw).decode("ascii")
        data_url = f"data:{mime_type};base64,{encoded}"

        if mime_type == "application/pdf":
            content.append(
                {
                    "type": "input_file",
                    "filename": upload.filename or "invoice.pdf",
                    "file_data": data_url,
                }
            )
        elif mime_type.startswith("image/"):
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
                detail=f"סוג הקובץ {mime_type} אינו נתמך",
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
        normalized["_operation"] = operation_meta
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

