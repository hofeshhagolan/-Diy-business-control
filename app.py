import base64
import json
import logging
import os
from pathlib import Path
from typing import List

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from openai import OpenAI

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("diy-business-control")

app = FastAPI(title="DIY Business Control")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


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
async def analyze_invoice(files: List[UploadFile] = File(...)) -> dict:
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
        return json.loads(response.output_text or "{}")
    except json.JSONDecodeError as exc:
        logger.exception("Invalid JSON from extraction model")
        raise HTTPException(
            status_code=502,
            detail="התקבלה תשובה לא תקינה ממנוע החילוץ",
        ) from exc
    except Exception as exc:
        logger.exception("Invoice extraction failed")
        raise HTTPException(
            status_code=502,
            detail=f"שגיאה בחילוץ הנתונים: {str(exc)[:220]}",
        ) from exc

