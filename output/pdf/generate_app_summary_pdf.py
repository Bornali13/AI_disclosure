from pathlib import Path


PAGE_WIDTH = 595.28
PAGE_HEIGHT = 841.89
MARGIN = 36
GUTTER = 20
COLUMN_WIDTH = (PAGE_WIDTH - (MARGIN * 2) - GUTTER) / 2


def escape_pdf_text(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


class PDFBuilder:
    def __init__(self) -> None:
        self.stream = []
        self.current_font = None
        self.current_size = None

    def set_font(self, name: str, size: int) -> None:
        font_map = {
            "Helvetica": "/F1",
            "Helvetica-Bold": "/F2",
            "Courier": "/F3",
        }
        key = (name, size)
        if self.current_font == key:
            return
        self.current_font = key
        self.current_size = size
        self.stream.append(f"{font_map[name]} {size} Tf")

    def set_fill(self, r: float, g: float, b: float) -> None:
        self.stream.append(f"{r:.3f} {g:.3f} {b:.3f} rg")

    def text(self, x: float, y: float, text: str) -> None:
        safe = escape_pdf_text(text)
        self.stream.append(f"1 0 0 1 {x:.2f} {y:.2f} Tm ({safe}) Tj")

    def rect_fill(self, x: float, y: float, w: float, h: float, color) -> None:
        r, g, b = color
        self.stream.append(f"{r:.3f} {g:.3f} {b:.3f} rg")
        self.stream.append(f"{x:.2f} {y:.2f} {w:.2f} {h:.2f} re f")

    def line(self, x1: float, y1: float, x2: float, y2: float, color, width: float = 1) -> None:
        r, g, b = color
        self.stream.append(f"{width:.2f} w")
        self.stream.append(f"{r:.3f} {g:.3f} {b:.3f} RG")
        self.stream.append(f"{x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S")

    def build(self) -> bytes:
        content = "BT\n" + "\n".join(self.stream) + "\nET\n"
        content_bytes = content.encode("latin-1", errors="replace")

        objects = []
        objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
        objects.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
        objects.append(
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_WIDTH:.2f} {PAGE_HEIGHT:.2f}] "
                f"/Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> "
                f"/Contents 7 0 R >>"
            ).encode("latin-1")
        )
        objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
        objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
        objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>")
        objects.append(
            f"<< /Length {len(content_bytes)} >>\nstream\n".encode("latin-1")
            + content_bytes
            + b"endstream"
        )

        pdf = bytearray(b"%PDF-1.4\n")
        offsets = [0]
        for index, obj in enumerate(objects, start=1):
            offsets.append(len(pdf))
            pdf.extend(f"{index} 0 obj\n".encode("latin-1"))
            pdf.extend(obj)
            pdf.extend(b"\nendobj\n")

        xref_pos = len(pdf)
        pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
        pdf.extend(b"0000000000 65535 f \n")
        for off in offsets[1:]:
            pdf.extend(f"{off:010d} 00000 n \n".encode("latin-1"))
        pdf.extend(
            (
                f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
                f"startxref\n{xref_pos}\n%%EOF"
            ).encode("latin-1")
        )
        return bytes(pdf)


def wrap_text(text: str, max_chars: int):
    words = text.split()
    lines = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if len(candidate) <= max_chars:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def draw_wrapped(builder: PDFBuilder, x: float, y: float, text: str, font: str, size: int, color, max_chars: int, leading: float):
    builder.set_font(font, size)
    builder.set_fill(*color)
    lines = wrap_text(text, max_chars)
    for line in lines:
        builder.text(x, y, line)
        y -= leading
    return y


def bullet_block(builder: PDFBuilder, x: float, y: float, items, max_chars: int, bullet_color, text_color, size=9, leading=12):
    for item in items:
        builder.set_font("Helvetica-Bold", size)
        builder.set_fill(*bullet_color)
        builder.text(x, y, "-")
        builder.set_font("Helvetica", size)
        builder.set_fill(*text_color)
        wrapped = wrap_text(item, max_chars)
        first = True
        for line in wrapped:
            builder.text(x + 10, y, line if first else line)
            first = False
            y -= leading
        y -= 2
    return y


def section_heading(builder: PDFBuilder, x: float, y: float, title: str, accent, dark):
    builder.set_font("Helvetica-Bold", 11)
    builder.set_fill(*accent)
    builder.text(x, y, title.upper())
    builder.line(x, y - 4, x + 84, y - 4, accent, width=1.2)
    return y - 18


def main():
    out_dir = Path("output/pdf")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "app-summary-one-page.pdf"

    dark = (0.10, 0.16, 0.25)
    accent = (0.07, 0.42, 0.68)
    muted = (0.34, 0.39, 0.47)
    panel = (0.93, 0.96, 0.99)
    builder = PDFBuilder()

    builder.rect_fill(0, 0, PAGE_WIDTH, PAGE_HEIGHT, (1, 1, 1))
    builder.rect_fill(0, PAGE_HEIGHT - 126, PAGE_WIDTH, 126, panel)

    left_x = MARGIN
    right_x = MARGIN + COLUMN_WIDTH + GUTTER

    y = PAGE_HEIGHT - 54
    builder.set_font("Helvetica-Bold", 20)
    builder.set_fill(*dark)
    builder.text(left_x, y, "AI Disclosure App")

    builder.set_font("Helvetica", 10)
    builder.set_fill(*muted)
    builder.text(left_x, y - 18, "One-page repo-based summary")

    builder.set_font("Helvetica-Bold", 9)
    builder.set_fill(*accent)
    builder.text(right_x, y - 4, "Evidence scope")
    builder.set_font("Helvetica", 8)
    builder.set_fill(*muted)
    builder.text(right_x, y - 18, "Based only on files in this repository.")
    builder.text(right_x, y - 30, "Missing details are labeled Not found in repo.")

    left_y = PAGE_HEIGHT - 150
    left_y = section_heading(builder, left_x, left_y, "What It Is", accent, dark)
    what_it_is = (
        "A FastAPI-based academic integrity portal for collecting AI disclosure details alongside student assignment uploads and AI-risk analysis. "
        "The repo shows separate student, teacher, and admin web interfaces, plus generated PDF receipts and teacher reports."
    )
    left_y = draw_wrapped(builder, left_x, left_y, what_it_is, "Helvetica", 9, dark, 48, 12)

    left_y -= 8
    left_y = section_heading(builder, left_x, left_y, "Who It's For", accent, dark)
    who = (
        "Primary persona: university students submitting assignments with AI-use disclosure, and teachers reviewing those submissions for their assigned courses. "
        "An admin portal supports setup and user/course management."
    )
    left_y = draw_wrapped(builder, left_x, left_y, who, "Helvetica", 9, dark, 48, 12)

    left_y -= 8
    left_y = section_heading(builder, left_x, left_y, "What It Does", accent, dark)
    feature_items = [
        "Student registration, OTP verification, login, password reset, and profile lookup.",
        "Checks whether a submission slot is available before a student uploads work.",
        "Captures AI disclosure choices such as rewrite, research, or complete-generation use.",
        "Uploads draft and final files, extracts text, and scores content with an AI-detection model.",
        "Shows risk level, confidence, suspicious sections, and short explanatory guidance.",
        "Lets teachers filter submissions, review files and reports, run ad hoc analysis, and export CSV.",
        "Lets admins create users, semesters, courses, assignments, and teacher-course mappings."
    ]
    left_y = bullet_block(builder, left_x, left_y, feature_items, 46, accent, dark)

    right_y = PAGE_HEIGHT - 150
    right_y = section_heading(builder, right_x, right_y, "How It Works", accent, dark)
    architecture_items = [
        "Backend: `backend/main.py` defines a FastAPI app, mounts `frontend-main`, and exposes student, teacher, and admin API routes.",
        "Storage: PostgreSQL via `psycopg2`; `init_db()` creates tables for users, admins, courses, assignments, mappings, OTPs, and submissions.",
        "Files: uploaded drafts/finals, exports, and generated PDFs are written under `DATA_DIR` subfolders (`reports`, `uploaded_submissions`, `exports`).",
        "Modeling: `backend/model_loader.py` loads the Hugging Face model `Bornali13/ai-disclosure-model` and scores text in chunks.",
        "Reasoning text: `backend/agent.py` maps scores to risk labels; `backend/openai_helper.py` calls OpenAI for a short teacher-facing explanation.",
        "Frontend flow: browser pages in `frontend-main` and `frontend-admin` call JSON APIs, store auth tokens in localStorage, and download reports/receipts.",
        "Serving for admin UI: separate admin HTML/JS files exist in repo, but the exact local serving path is Not found in repo."
    ]
    right_y = bullet_block(builder, right_x, right_y, architecture_items, 45, accent, dark)

    right_y -= 4
    right_y = section_heading(builder, right_x, right_y, "How To Run", accent, dark)
    run_items = [
        "Install backend dependencies from `backend/requirements.txt`.",
        "Provide env vars referenced in code: `DATABASE_URL` is required; `SECRET_KEY`, `DATA_DIR`, `BASE_URL`, `OPENAI_API_KEY`, `HF_TOKEN`, `SENDGRID_API_KEY`, and `SENDGRID_FROM_EMAIL` are also used.",
        "Start the FastAPI app from `backend/main.py` with Uvicorn or an equivalent ASGI runner. Exact command: Not found in repo.",
        "Open the app root for the student/teacher UI. Admin static files are present in `backend/frontend-admin`; exact local hosting instructions are Not found in repo."
    ]
    right_y = bullet_block(builder, right_x, right_y, run_items, 45, accent, dark)

    builder.line(MARGIN, 28, PAGE_WIDTH - MARGIN, 28, (0.82, 0.86, 0.92), width=0.8)
    builder.set_font("Helvetica", 8)
    builder.set_fill(*muted)
    builder.text(MARGIN, 16, "Repo scanned on 2026-04-10. Summary limited to observable code and files.")

    out_path.write_bytes(builder.build())
    print(out_path.resolve())


if __name__ == "__main__":
    main()
