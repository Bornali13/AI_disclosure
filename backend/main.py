from fastapi import (
    FastAPI,
    HTTPException,
    Depends,
    UploadFile,
    File,
    Form,
    Query,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from model_loader import predict_text
from pydantic import BaseModel, EmailStr
from jose import jwt, JWTError
from passlib.context import CryptContext
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from typing import Optional
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from uuid import uuid4

from agent import decision_agent, explain_result
from openai_helper import generate_explanation

import textwrap
import os
import io
import csv
import random
import shutil
from pathlib import Path
import psycopg2
import psycopg2.extras

from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail

from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

# Define the path to the frontend directory
BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend-main"



SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 180

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

app = FastAPI(title="AI Disclosure App API")

origins = [
    "https://aidisclosureapp.com",
    "https://www.aidisclosureapp.com"
    "https://ai-portal-y1a1.onrender.com",
    "https://ai-admin-uka5.onrender.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def serve_home():
    return FileResponse(FRONTEND_DIR / "index.html")

# Mount the frontend directory as a static files directory
app.mount("/frontend", StaticFiles(directory=FRONTEND_DIR), name="frontend")

# =========================================================
# Paths / Config
# =========================================================
DATA_DIR = Path(os.getenv("DATA_DIR", "/var/data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
# Paths
REPORTS_DIR = DATA_DIR / "reports"
UPLOAD_DIR = DATA_DIR / "uploaded_submissions"
EXPORTS_DIR = DATA_DIR / "exports"

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set")
BASE_URL = os.getenv("BASE_URL", "https://ai-admin-uka5.onrender.com")
# Model path (keep in code directory)
MODEL_ID = "Bornali13/ai-disclosure-model"

# Ensure directories exist
for folder in [
    REPORTS_DIR,
    UPLOAD_DIR,
    EXPORTS_DIR,
]:
    folder.mkdir(parents=True, exist_ok=True)

# =========================================================
# Database Helpers
# =========================================================
def get_conn():
    return psycopg2.connect(
        DATABASE_URL,
        cursor_factory=psycopg2.extras.RealDictCursor
    )


def init_db():
    conn = get_conn()
    cur = conn.cursor()

    # ---------------- Users
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            full_name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            role TEXT NOT NULL CHECK(role IN ('student', 'teacher')),
            is_active INTEGER DEFAULT 1,
            is_verified INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # ---------------- Admins
    cur.execute("""
        CREATE TABLE IF NOT EXISTS admins (
            id SERIAL PRIMARY KEY,
            full_name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # ---------------- Students
    cur.execute("""
        CREATE TABLE IF NOT EXISTS students (
            id SERIAL PRIMARY KEY,
            student_name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            student_id TEXT UNIQUE NOT NULL
        )
    """)

    # ---------------- Teachers
    cur.execute("""
        CREATE TABLE IF NOT EXISTS teachers (
            id SERIAL PRIMARY KEY,
            teacher_name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL
        )
    """)

    # ---------------- Courses
    cur.execute("""
        CREATE TABLE IF NOT EXISTS courses (
            id SERIAL PRIMARY KEY,
            course_name TEXT NOT NULL,
            course_code TEXT UNIQUE NOT NULL
        )
    """)

    # ---------------- Semesters
    cur.execute("""
        CREATE TABLE IF NOT EXISTS semesters (
            id SERIAL PRIMARY KEY,
            semester_name TEXT UNIQUE NOT NULL
        )
    """)

    # ---------------- Semester-Course map
    cur.execute("""
        CREATE TABLE IF NOT EXISTS semester_courses (
            id SERIAL PRIMARY KEY,
            semester_id INTEGER NOT NULL REFERENCES semesters(id),
            course_code TEXT NOT NULL REFERENCES courses(course_code),
            UNIQUE(semester_id, course_code)
        )
    """)

    # ---------------- Teacher-Course map
    cur.execute("""
        CREATE TABLE IF NOT EXISTS teacher_courses (
            id SERIAL PRIMARY KEY,
            teacher_email TEXT NOT NULL,
            course_code TEXT NOT NULL,
            UNIQUE(teacher_email, course_code)
        )
    """)

    # ---------------- Student-Course map
    cur.execute("""
        CREATE TABLE IF NOT EXISTS student_courses (
            id SERIAL PRIMARY KEY,
            student_id TEXT NOT NULL,
            course_code TEXT NOT NULL,
            UNIQUE(student_id, course_code)
        )
    """)

    # ---------------- Assignments
    cur.execute("""
        CREATE TABLE IF NOT EXISTS assignments (
            id SERIAL PRIMARY KEY,
            course_code TEXT NOT NULL,
            assignment_number TEXT NOT NULL,
            assignment_title TEXT,
            UNIQUE(course_code, assignment_number)
        )
    """)

    # ---------------- Email verifications
    cur.execute("""
        CREATE TABLE IF NOT EXISTS email_verifications (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL,
            otp_code TEXT NOT NULL,
            purpose TEXT NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            is_verified INTEGER DEFAULT 0,
            is_used INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # ---------------- Submissions
    cur.execute("""
        CREATE TABLE IF NOT EXISTS submissions (
            id SERIAL PRIMARY KEY,
            submitted_at TIMESTAMP,
            semester_name TEXT,
            student_name TEXT NOT NULL,
            student_id TEXT NOT NULL,
            student_email TEXT NOT NULL,
            course_code TEXT NOT NULL,
            assignment_number TEXT NOT NULL,
            used_ai INTEGER DEFAULT 0,
            used_rewrite INTEGER DEFAULT 0,
            used_research INTEGER DEFAULT 0,
            used_complete INTEGER DEFAULT 0,
            evidence_text TEXT,
            draft_text TEXT,
            draft_file_name TEXT,
            final_text TEXT,
            stored_file_name TEXT,
            stored_file_path TEXT,
            label TEXT,
            confidence REAL,
            decision TEXT,
            explanation TEXT,
            total_words_assessed INTEGER,
            total_chunks_assessed INTEGER,
            UNIQUE(student_id, semester_name, course_code, assignment_number)
        )
    """)

    conn.commit()
    cur.close()
    conn.close()

@app.on_event("startup")
def startup_event():
    init_db()


# =========================================================
# Helpers
# =========================================================
def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not hashed_password:
        return False
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "user":
            raise HTTPException(status_code=403, detail="Unauthorized access")
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def get_current_admin(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "admin":
            raise HTTPException(status_code=403, detail="Unauthorized admin access")
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired admin token")


def require_role(current_user: dict, role: str):
    if current_user.get("role") != role:
        raise HTTPException(status_code=403, detail="Unauthorized access")


def generate_otp() -> str:
    return str(random.randint(100000, 999999))


def now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def teacher_has_course(teacher_email: str, course_code: str) -> bool:
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT 1
            FROM teacher_courses
            WHERE teacher_email = %s AND course_code = %s
        """, (teacher_email, course_code))
        row = cur.fetchone()
        return bool(row)
    finally:
        cur.close()
        conn.close()


def semester_exists(cur, semester_name: str):
    cur.execute("""
        SELECT id, semester_name
        FROM semesters
        WHERE semester_name = %s
    """, (semester_name.strip(),))
    return cur.fetchone()


def semester_course_exists(cur, semester_name: str, course_code: str) -> bool:
    cur.execute("""
        SELECT 1
        FROM semester_courses sc
        JOIN semesters s ON s.id = sc.semester_id
        WHERE s.semester_name = %s AND sc.course_code = %s
    """, (semester_name.strip(), course_code.strip()))
    row = cur.fetchone()
    return bool(row)

def wrap_text(text: str, width: int = 90):
    return textwrap.wrap(str(text or ""), width=width)

# =========================================================
# Request Models
# =========================================================
class TextRequest(BaseModel):
    text: str


class StudentRegisterRequest(BaseModel):
    full_name: str
    email: EmailStr
    student_id: str


class VerifyOtpRequest(BaseModel):
    email: EmailStr
    otp_code: str


class SetPasswordRequest(BaseModel):
    email: EmailStr
    password: str
    confirm_password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    role: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str


class ResetRequest(BaseModel):
    email: EmailStr


class ResetVerifyRequest(BaseModel):
    email: EmailStr
    otp: str


class ResetChangePasswordRequest(BaseModel):
    email: EmailStr
    new_password: str
    confirm_password: str


class AdminLoginRequest(BaseModel):
    email: EmailStr
    password: str


class AdminCreateTeacherRequest(BaseModel):
    teacher_name: str
    email: EmailStr
    password: str


class AdminCreateStudentRequest(BaseModel):
    student_name: str
    email: EmailStr
    student_id: str
    password: str
    
class AdminCreateSemesterRequest(BaseModel):
    semester_name: str


class AdminCreateCourseRequest(BaseModel):
    course_code: str
    course_name: str
    
class AdminAssignSemesterCourseRequest(BaseModel):
    semester_name: str
    course_code: str

class AdminCreateAssignmentRequest(BaseModel):
    course_code: str
    assignment_number: str
    assignment_title: str

class AdminAssignTeacherCourseRequest(BaseModel):
    teacher_email: EmailStr
    course_code: str


class TeacherAddStudentRequest(BaseModel):
    semester_name: str
    course_code: str
    student_name: str
    email: EmailStr
    student_id: str

class AdminSendResetRequest(BaseModel):
    email: EmailStr
    role: str
# =========================================================
# Analyze only
# =========================================================
@app.post("/analyze")
def analyze_text(request: TextRequest):
    try:
        if not request.text or not request.text.strip():
            raise HTTPException(status_code=400, detail="Text is empty.")

        prediction = predict_text(request.text)

        label = prediction["label"]
        score = prediction["ai_score"]

        # ✅ FIXED BLOCK (INDENTED CORRECTLY)
        raw_sections = prediction.get("suspicious_sections", [])
        suspicious_sections = []

        for sec in raw_sections:
            try:
                if isinstance(sec, str):
                    import json
                    sec = json.loads(sec)

                text = sec.get("preview", "")
                sec_score = sec.get("score", 0)

                if len(str(text).split()) < 5:
                    continue

                suspicious_sections.append({
                    "section_text": text,
                    "matches": [
                        {
                            "text": text,
                            "score": sec_score
                        }
                    ],
                    "score": sec_score
                })

            except Exception:
                continue

        total_words_assessed = prediction.get("total_words_assessed", 0)
        total_chunks_assessed = prediction.get("total_chunks_assessed", 0)

        decision = decision_agent(label, score)

        return {
            "label": label,
            "confidence": round(float(score), 4),
            "decision": decision,
            "suspicious_sections": suspicious_sections,
            "total_words_assessed": total_words_assessed,
            "total_chunks_assessed": total_chunks_assessed,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Analysis failed: {str(e)}")

# =========================================================
# Student Registration / Login / Password
# =========================================================
load_dotenv()

SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY")
SENDGRID_FROM_EMAIL = os.getenv("SENDGRID_FROM_EMAIL")

def send_email_otp(to_email: str, subject: str, plain_text: str):
    if not SENDGRID_API_KEY:
        raise HTTPException(status_code=500, detail="SENDGRID_API_KEY is not configured")
    if not SENDGRID_FROM_EMAIL:
        raise HTTPException(status_code=500, detail="SENDGRID_FROM_EMAIL is not configured")

    message = Mail(
        from_email=SENDGRID_FROM_EMAIL,
        to_emails=to_email,
        subject=subject,
        plain_text_content=plain_text,
        html_content=f"<pre>{plain_text}</pre>"
    )

    try:
        sg = SendGridAPIClient(SENDGRID_API_KEY)
        response = sg.send(message)
        print("SENDGRID STATUS:", response.status_code)
        print("SENDGRID TO:", to_email)
        print("SENDGRID BODY:", response.body)
        print("SENDGRID HEADERS:", response.headers)
        if response.status_code not in (200, 202):
            raise HTTPException(
                status_code=500,
                detail=f"SendGrid send failed with status {response.status_code}"
            )
    except HTTPException:
        raise
    except Exception as e:
        print("SENDGRID ERROR:", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to send email: {str(e)}")


@app.post("/api/register/student")
def register_student(data: StudentRegisterRequest):
    conn = get_conn()
    cur = conn.cursor()

    cur.execute(
        "SELECT * FROM users WHERE email = %s",
        (data.email.strip(),)
    )
    existing_user = cur.fetchone()

    cur.execute(
        "SELECT * FROM students WHERE email = %s OR student_id = %s",
        (data.email.strip(), data.student_id.strip())
    )
    existing_student = cur.fetchone()

    if existing_user or existing_student:
        conn.close()
        raise HTTPException(status_code=400, detail="Student email or student ID already exists")

    cur.execute("""
        INSERT INTO users (full_name, email, role, is_active, is_verified)
        VALUES (%s, %s, 'student', 1, 0)
    """, (data.full_name.strip(), data.email.strip()))

    cur.execute("""
        INSERT INTO students (student_name, email, student_id)
        VALUES (%s, %s, %s)
    """, (data.full_name.strip(), data.email.strip(), data.student_id.strip()))

    otp = generate_otp()
    expires_at = (datetime.utcnow() + timedelta(minutes=10)).isoformat()

    cur.execute("""
        INSERT INTO email_verifications (email, otp_code, purpose, expires_at, is_verified, is_used)
        VALUES (%s, %s, 'register', %s, 0, 0)
    """, (data.email.strip(), otp, expires_at))

    conn.commit()
    conn.close()

    send_email_otp(
    to_email=data.email.strip(),
    subject="AI Disclosure - Verification Code",
    plain_text=f"Your verification code is: {otp}. It will expire in 10 minutes."
)

    return {
        "message": "Registration started. Verification code sent.",
        "note": "For local testing, OTP is printed in backend terminal."
    }


@app.post("/api/register/verify-otp")
def verify_register_otp(data: VerifyOtpRequest):
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("""
        SELECT * FROM email_verifications
        WHERE email = %s AND otp_code = %s AND purpose = 'register' AND is_used = 0
        ORDER BY id DESC
        LIMIT 1
    """, (data.email.strip(), data.otp_code.strip()))
    row = cur.fetchone()
    

    if not row:
        conn.close()
        raise HTTPException(status_code=400, detail="Invalid verification code")

    expires_at = row["expires_at"]

    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)

    if datetime.utcnow() > expires_at.replace(tzinfo=None):
        conn.close()
        raise HTTPException(status_code=400, detail="Verification code expired")

    cur.execute("""
        UPDATE email_verifications
        SET is_verified = 1
        WHERE id = %s
    """, (row["id"],))

    cur.execute("""
        UPDATE users
        SET is_verified = 1
        WHERE email = %s
    """, (data.email.strip(),))

    conn.commit()
    conn.close()

    return {"message": "Email verified successfully. You can now set your password."}


@app.post("/api/register/set-password")
def set_student_password(data: SetPasswordRequest):
    if data.password != data.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")

    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    conn = get_conn()
    cur = conn.cursor()

    cur.execute("""
        SELECT * FROM users
        WHERE email = %s AND role = 'student'
    """, (data.email.strip(),))
    user = cur.fetchone()

    if not user:
        conn.close()
        raise HTTPException(status_code=404, detail="Student account not found")

    cur.execute("""
        SELECT * FROM email_verifications
        WHERE email = %s AND purpose = 'register' AND is_verified = 1 AND is_used = 0
        ORDER BY id DESC
        LIMIT 1
    """, (data.email.strip(),))
    row = cur.fetchone()

    if not row:
        conn.close()
        raise HTTPException(status_code=400, detail="Verification step not completed")

    cur.execute("""
        UPDATE users
        SET password_hash = %s, is_verified = 1
        WHERE email = %s
    """, (hash_password(data.password), data.email.strip()))

    cur.execute("""
        UPDATE email_verifications
        SET is_used = 1
        WHERE id = %s
    """, (row["id"],))

    conn.commit()
    conn.close()

    return {"message": "Password set successfully. You can now log in."}


@app.post("/api/login")
def login(data: LoginRequest):
    role = data.role.strip().lower()
    if role not in ["student", "teacher"]:
        raise HTTPException(status_code=400, detail="Invalid role")

    conn = get_conn()
    cur = conn.cursor()

    cur.execute("""
        SELECT * FROM users
        WHERE email = %s AND role = %s AND is_active = 1
    """, (data.email.strip(), role))
    user = cur.fetchone()

    conn.close()

    if not user:
        raise HTTPException(status_code=401, detail="Invalid email, password, or role")

    if role == "student" and user["is_verified"] != 1:
        raise HTTPException(status_code=403, detail="Please verify your email first")

    if not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email, password, or role")

    token = create_access_token({
        "type": "user",
        "user_id": user["id"],
        "email": user["email"],
        "role": user["role"],
    })

    return {
        "message": "Login successful",
        "access_token": token,
        "user": {
            "id": user["id"],
            "full_name": user["full_name"],
            "email": user["email"],
            "role": user["role"],
        }
    }


@app.post("/api/change-password")
def change_password(
    data: ChangePasswordRequest,
    current_user: dict = Depends(get_current_user)
):
    if data.new_password != data.confirm_password:
        raise HTTPException(status_code=400, detail="New passwords do not match")

    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    conn = get_conn()
    cur = conn.cursor()

    cur.execute("""
        SELECT * FROM users WHERE id = %s
    """, (current_user["user_id"],))
    user = cur.fetchone()

    if not user:
        conn.close()
        raise HTTPException(status_code=404, detail="User not found")

    if not verify_password(data.current_password, user["password_hash"]):
        conn.close()
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    cur.execute("""
        UPDATE users
        SET password_hash = %s,
        WHERE id = %s
    """, (hash_password(data.new_password), data.email.strip()))

    conn.commit()
    conn.close()

    return {"message": "Password changed successfully"}


@app.post("/api/reset/request-otp")
def request_reset_otp(data: ResetRequest):
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("""
        SELECT * FROM users WHERE email = %s
    """, (data.email.strip(),))
    user = cur.fetchone()

    if not user:
        conn.close()
        raise HTTPException(status_code=404, detail="Email not found")

    otp = generate_otp()
    expires_at = (datetime.utcnow() + timedelta(minutes=10)).isoformat()

    cur.execute("""
        INSERT INTO email_verifications (email, otp_code, purpose, expires_at, is_verified, is_used)
        VALUES (%s, %s, 'reset', %s, 0, 0)
    """, (data.email.strip(), otp, expires_at))

    conn.commit()
    conn.close()
    
    reset_link = f"{BASE_URL}/reset-password.html?email={data.email.strip()}&otp={otp}"
    
    send_email_otp(
        to_email=data.email.strip(),
        subject="AI Disclosure - Password Reset Code",
        plain_text=f"""You requested a password reset.

    Click the link below to reset your password:{reset_link}

    If the link does not open, use this OTP code: {otp}

    This link/code will expire in 10 minutes.
    """
    )

    return {
        "message": "OTP sent successfully.",
        "note": "For local testing, OTP is printed in backend terminal."
    }


@app.post("/api/reset/verify-otp")
def verify_reset_otp(data: ResetVerifyRequest):
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("""
        SELECT * FROM email_verifications
        WHERE email = %s AND otp_code = %s AND purpose = 'reset' AND is_used = 0
        ORDER BY id DESC
        LIMIT 1
    """, (data.email.strip(), data.otp.strip()))
    row = cur.fetchone()

    if not row:
        conn.close()
        raise HTTPException(status_code=400, detail="Invalid OTP")

    expires_at = row["expires_at"]

    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)

    if datetime.utcnow() > expires_at.replace(tzinfo=None):
        conn.close()
        raise HTTPException(status_code=400, detail="OTP expired")

    cur.execute("""
        UPDATE email_verifications
        SET is_verified = 1
        WHERE id = %s
    """, (row["id"],))

    conn.commit()
    conn.close()

    return {"message": "OTP verified successfully"}


@app.post("/api/reset/change-password")
def reset_change_password(data: ResetChangePasswordRequest):
    if data.new_password != data.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")

    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    conn = get_conn()
    cur = conn.cursor()

    cur.execute("""
        SELECT * FROM users WHERE email = %s
    """, (data.email.strip(),))
    user = cur.fetchone()

    if not user:
        conn.close()
        raise HTTPException(status_code=404, detail="User not found")

    cur.execute("""
        SELECT * FROM email_verifications
        WHERE email = %s AND purpose = 'reset' AND is_verified = 1 AND is_used = 0
        ORDER BY id DESC
        LIMIT 1
    """, (data.email.strip(),))
    row = cur.fetchone()

    if not row:
        conn.close()
        raise HTTPException(status_code=400, detail="OTP verification not completed")

    cur.execute("""
        UPDATE users
        SET password_hash = %s
        WHERE email = %s
    """, (hash_password(data.new_password), data.email.strip()))

    cur.execute("""
        UPDATE email_verifications
        SET is_used = 1
        WHERE id = %s
    """, (row["id"],))

    conn.commit()
    conn.close()

    return {"message": "Password reset successfully"}


# =========================================================
# Admin
# =========================================================
@app.post("/api/admin/login")
def admin_login(data: AdminLoginRequest):
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("""
        SELECT * FROM admins
        WHERE email = %s AND is_active = 1
    """, (data.email.strip(),))
    admin = cur.fetchone()

    conn.close()

    if not admin or not verify_password(data.password, admin["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid admin credentials")

    token = create_access_token({
        "type": "admin",
        "admin_id": admin["id"],
        "email": admin["email"],
    })

    return {
        "message": "Admin login successful",
        "access_token": token,
        "admin": {
            "id": admin["id"],
            "full_name": admin["full_name"],
            "email": admin["email"],
        }
    }


@app.get("/api/admin/teachers")
def admin_get_teachers(current_admin: dict = Depends(get_current_admin)):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT teacher_name, email
        FROM teachers
        ORDER BY teacher_name ASC
    """)
    rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/admin/courses")
def admin_get_courses(current_admin: dict = Depends(get_current_admin)):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT course_code, course_name
        FROM courses
        ORDER BY course_code ASC
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/admin/create-teacher")
def admin_create_teacher(
    data: AdminCreateTeacherRequest,
    current_admin: dict = Depends(get_current_admin)
):
    conn = get_conn()
    cur = conn.cursor()

    try:
        teacher_name = data.teacher_name.strip()
        email = data.email.strip().lower()
        password = data.password.strip()

        if len(password) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

        cur.execute("SELECT 1 FROM users WHERE email = %s", (email,))
        existing_user = cur.fetchone()

        cur.execute("SELECT 1 FROM teachers WHERE email = %s", (email,))
        existing_teacher = cur.fetchone()

        if existing_user or existing_teacher:
            raise HTTPException(status_code=400, detail="Teacher email already exists")

        reset_link = f"{BASE_URL}/reset-password.html"

        cur.execute("""
            INSERT INTO users (
                full_name,
                email,
                password_hash,
                role,
                is_active,
                is_verified,
                must_change_password
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (
            teacher_name,
            email,
            hash_password(password),
            "teacher",
            1,
            1,
            0
        ))

        cur.execute("""
            INSERT INTO teachers (teacher_name, email)
            VALUES (%s, %s)
        """, (teacher_name, email))

        send_email_otp(
            to_email=email,
            subject="AI Disclosure - Teacher Account Created",
            plain_text=f"""Dear {teacher_name},

Your teacher account has been created successfully.

Username: {teacher_name}
Email: {email}
Password: {password}

You can sign in using the above credentials.

If you want to reset your password later, please use the link below:
{reset_link}

Regards,
AI Disclosure Team
"""
        )

        conn.commit()
        return {"message": "Teacher created successfully and email sent"}

    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create teacher: {str(e)}")
    finally:
        cur.close()
        conn.close()


@app.post("/api/admin/create-student")
def admin_create_student(
    data: AdminCreateStudentRequest,
    current_admin: dict = Depends(get_current_admin)
):
    conn = get_conn()
    cur = conn.cursor()

    try:
        student_name = data.student_name.strip()
        email = data.email.strip().lower()
        student_id = data.student_id.strip()
        password = data.password.strip()

        if len(password) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

        cur.execute("SELECT 1 FROM users WHERE email = %s", (email,))
        existing_user = cur.fetchone()

        cur.execute("""
            SELECT 1 FROM students
            WHERE email = %s OR student_id = %s
        """, (email, student_id))
        existing_student = cur.fetchone()

        if existing_user or existing_student:
            raise HTTPException(status_code=400, detail="Student email or student ID already exists")

        reset_link = f"{BASE_URL}/reset-password.html"

        cur.execute("""
            INSERT INTO users (
                full_name,
                email,
                password_hash,
                role,
                is_active,
                is_verified,
                must_change_password
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (
            student_name,
            email,
            hash_password(password),
            "student",
            1,
            1,
            0
        ))

        cur.execute("""
            INSERT INTO students (student_name, email, student_id)
            VALUES (%s, %s, %s)
        """, (student_name, email, student_id))

        send_email_otp(
            to_email=email,
            subject="AI Disclosure - Student Account Created",
            plain_text=f"""Dear {student_name},

Your student account has been created successfully.

Username: {student_name}
Email: {email}
Student ID: {student_id}
Password: {password}

You can sign in using the above credentials.

If you want to reset your password later, please use the link below:
{reset_link}

Regards,
AI Disclosure Team
"""
        )

        conn.commit()
        return {"message": "Student created successfully and email sent"}

    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create student: {str(e)}")
    finally:
        cur.close()
        conn.close()




@app.post("/api/admin/create-semester")
def admin_create_semester(
    data: AdminCreateSemesterRequest,
    current_admin: dict = Depends(get_current_admin)
):
    conn = get_conn()
    cur = conn.cursor()

    try:
        cur.execute("SELECT 1 FROM semesters WHERE semester_name = %s", (data.semester_name.strip(),))
        existing = cur.fetchone()

        if existing:
            raise HTTPException(status_code=400, detail="Semester already exists")

        cur.execute("""
            INSERT INTO semesters (semester_name)
            VALUES (%s)
        """, (data.semester_name.strip(),))

        conn.commit()
        return {"message": "Semester added successfully"}
    finally:
        cur.close()
        conn.close()


@app.post("/api/admin/create-course")
def admin_create_course(
    data: AdminCreateCourseRequest,
    current_admin: dict = Depends(get_current_admin)
):
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("SELECT * FROM courses WHERE course_code = %s", (data.course_code.strip(),))
    existing = cur.fetchone()

    if existing:
        conn.close()
        raise HTTPException(status_code=400, detail="Course code already exists")

    cur.execute("""
        INSERT INTO courses (course_name, course_code)
        VALUES (%s, %s)
    """, (data.course_name.strip(), data.course_code.strip()))

    conn.commit()
    conn.close()

    return {"message": "Course added successfully"}

@app.get("/api/admin/semesters")
def admin_get_semesters(current_admin: dict = Depends(get_current_admin)):
    conn = get_conn()
    cur = conn.cursor()

    try:
        cur.execute("""
            SELECT id, semester_name
            FROM semesters
            ORDER BY id ASC
        """)
        rows = cur.fetchall()

        return {"semesters": [dict(r) for r in rows]}
    finally:
        cur.close()
        conn.close()

@app.post("/api/admin/assign-semester-course")
def admin_assign_semester_course(
    data: AdminAssignSemesterCourseRequest,
    current_admin: dict = Depends(get_current_admin)
):
    conn = get_conn()
    cur = conn.cursor()

    try:
        semester = semester_exists(cur, data.semester_name)

        if not semester:
            raise HTTPException(status_code=404, detail="Semester not found")

        cur.execute("""
            INSERT INTO semester_courses (semester_id, course_code)
            VALUES (%s, %s)
        """, (semester["id"], data.course_code.strip()))

        conn.commit()
        return {"message": "Course assigned successfully"}

    finally:
        cur.close()
        conn.close()
        
@app.post("/api/admin/create-assignment")
def admin_create_assignment(
    data: AdminCreateAssignmentRequest,
    current_admin: dict = Depends(get_current_admin)
):
    conn = get_conn()
    cur = conn.cursor()

    try:
        cur.execute("""
            INSERT INTO assignments (course_code, assignment_number, assignment_title)
            VALUES (%s, %s, %s)
        """, (
            data.course_code.strip(),
            data.assignment_number.strip(),
            data.assignment_title.strip()
        ))

        conn.commit()
        return {"message": "Assignment added successfully"}

    finally:
        cur.close()
        conn.close()

@app.post("/api/admin/assign-teacher-course")
def admin_assign_teacher_course(
    data: AdminAssignTeacherCourseRequest,
    current_admin: dict = Depends(get_current_admin)
):
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("""
        SELECT * FROM teachers WHERE email = %s
    """, (data.teacher_email.strip(),))
    teacher = cur.fetchone()

    if not teacher:
        conn.close()
        raise HTTPException(status_code=404, detail="Teacher not found")

    cur.execute("""
        SELECT * FROM courses WHERE course_code = %s
    """, (data.course_code.strip(),))
    course = cur.fetchone()

    if not course:
        conn.close()
        raise HTTPException(status_code=404, detail="Course not found")

    cur.execute("""
        SELECT * FROM teacher_courses
        WHERE teacher_email = %s AND course_code = %s
    """, (data.teacher_email.strip(), data.course_code.strip()))
    existing = cur.fetchone()

    if existing:
        conn.close()
        raise HTTPException(status_code=400, detail="Teacher is already assigned to this course")

    cur.execute("""
        INSERT INTO teacher_courses (teacher_email, course_code)
        VALUES (%s, %s)
    """, (data.teacher_email.strip(), data.course_code.strip()))

    conn.commit()
    conn.close()

    return {"message": "Teacher assigned to course successfully"}

@app.post("/api/admin/send-reset-email")
def admin_send_reset_email(
    data: AdminSendResetRequest,
    current_admin: dict = Depends(get_current_admin)
):
    conn = get_conn()
    cur = conn.cursor()

    try:
        email = data.email.strip()
        role = data.role.strip()

        cur.execute("""
            SELECT * FROM users
            WHERE email = %s AND role = %s
        """, (email, role))
        user = cur.fetchone()

        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        otp = generate_otp()
        expires_at = (datetime.utcnow() + timedelta(minutes=10)).isoformat()

        cur.execute("""
            INSERT INTO email_verifications (email, otp_code, purpose, expires_at, is_verified, is_used)
            VALUES (%s, %s, 'reset', %s, 0, 0)
        """, (email, otp, expires_at))

        conn.commit()

        reset_link = f"{BASE_URL}/reset-password.html?email={email}&otp={otp}"

        send_email_otp(
            to_email=email,
            subject="AI Disclosure - Password Reset",
            plain_text=f"""You requested a password reset.

Click the link below to reset your password:
{reset_link}

This link/code will expire in 10 minutes.

If you did not request this, please ignore this email.
"""
        )

        return {"message": "Reset email sent successfully"}

    finally:
        cur.close()
        conn.close()
# =========================================================
# Shared semester API
# =========================================================
@app.get("/api/semesters")
def get_semesters(current_user: dict = Depends(get_current_user)):
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("""
        SELECT semester_name
        FROM semesters
        ORDER BY id ASC
    """)
    rows = cur.fetchall()

    conn.close()
    return [dict(r) for r in rows]


# =========================================================
# Student APIs
# =========================================================
@app.get("/api/student/courses")
def student_get_courses(
    semester_name: str = Query(...),
    current_user: dict = Depends(get_current_user)
):
    require_role(current_user, "student")

    conn = get_conn()
    cur = conn.cursor()

    try:
        semester = semester_exists(cur, semester_name)
        if not semester:
            raise HTTPException(status_code=404, detail="Semester not found")

        cur.execute("""
                    SELECT DISTINCT c.course_code, c.course_name
                    FROM semester_courses smc
                    JOIN courses c ON c.course_code = smc.course_code
                    WHERE smc.semester_id = %s
                    ORDER BY c.course_code ASC""", (semester["id"],))
        rows = cur.fetchall()

        return {"courses": [dict(r) for r in rows]}
    finally:
        cur.close()
        conn.close()


@app.get("/api/student/assignments")
def student_get_assignments(
    course_code: str = Query(...),
    current_user: dict = Depends(get_current_user)
):
    require_role(current_user, "student")

    conn = get_conn()
    cur = conn.cursor()

    try:
        course_code = course_code.strip()

        cur.execute("""
                    SELECT 1
                    FROM courses
                    WHERE course_code = %s
                    """, (course_code,))
        course = cur.fetchone()

        if not course:
            raise HTTPException(status_code=404, detail="Course not found")

        cur.execute("""
                    SELECT assignment_number, assignment_title
                    FROM assignments
                    WHERE course_code = %s
                    ORDER BY assignment_number ASC""", (course_code,))
        rows = cur.fetchall()

        return {"assignments": [dict(r) for r in rows]}
    finally:
        cur.close()
        conn.close()

@app.get("/api/student/check-submission")
def student_check_submission(
    course_code: str = Query(...),
    assignment_number: str = Query(...),
    semester_name: str = Query(None),
    current_user: dict = Depends(get_current_user)
):
    require_role(current_user, "student")

    conn = get_conn()
    cur = conn.cursor()

    try:
        cur.execute("""
                    SELECT * FROM students
                    WHERE email = %s""", (current_user["email"],))
        student = cur.fetchone()

        if not student:
            raise HTTPException(status_code=404, detail="Student record not found")

        course_code = course_code.strip()
        assignment_number = assignment_number.strip()
        semester_name = semester_name.strip() if semester_name and semester_name.strip() else None

        if semester_name:
            semester = semester_exists(cur, semester_name)
            if not semester:
                raise HTTPException(status_code=404, detail="Semester not found")

            cur.execute("""SELECT 1
                        FROM semester_courses
                        WHERE semester_id = %s AND course_code = %s
                        """, (semester["id"], course_code))
            course_row = cur.fetchone()

            if not course_row:
                raise HTTPException(status_code=400, detail="Invalid course for selected semester")

        cur.execute("""SELECT 1
                    FROM assignments
                    WHERE course_code = %s AND assignment_number = %s
                    """, (course_code, assignment_number))
        assignment_row = cur.fetchone()

        if not assignment_row:
            raise HTTPException(status_code=400, detail="Invalid assignment for selected course")

        if semester_name:
            cur.execute("""
                        SELECT 1
                        FROM submissions
                        WHERE student_id = %s
                          AND semester_name = %s
                          AND course_code = %s
                          AND assignment_number = %s
                        LIMIT 1
                        """, (
                            student["student_id"],
                            semester_name,
                            course_code,
                            assignment_number
                            ))
            existing = cur.fetchone()
        else:
            cur.execute("""
                        SELECT 1
                        FROM submissions
                        WHERE student_id = %s
                          AND course_code = %s
                          AND assignment_number = %s
                        LIMIT 1
                        """, (
                            student["student_id"],
                            course_code,
                            assignment_number
                        ))
            existing = cur.fetchone()

        return {
            "already_submitted": bool(existing),
            "message": "Already submitted" if existing else "Submission allowed"
        }
    finally:
        cur.close()
        conn.close()
        
@app.get("/api/student/profile")
def get_student_profile(current_user: dict = Depends(get_current_user)):
    require_role(current_user, "student")

    conn = get_conn()
    cur = conn.cursor()

    try:
        cur.execute("""
                   SELECT student_name, student_id, email
                   FROM students
                   WHERE email = %s
                   """, (current_user["email"],))

        student = cur.fetchone()

        if not student:
            raise HTTPException(status_code=404, detail="Student not found")

        return {
            "student_name": student["student_name"],
            "student_id": student["student_id"],
            "email": student["email"]
        }

    finally:
        cur.close()
        conn.close()

@app.post("/api/submit")
async def student_submit_assignment(
    semester_name: str = Form(...),
    course_code: str = Form(...),
    assignment_number: str = Form(...),
    used_ai: bool = Form(...),
    used_rewrite: bool = Form(False),
    used_research: bool = Form(False),
    used_complete: bool = Form(False),
    evidence_text: str = Form(""),
    final_text: str = Form(...),
    draft_text: str = Form(""),
    draft_file: UploadFile | None = File(None),
    final_file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    require_role(current_user, "student")

    if not final_text or not final_text.strip():
        raise HTTPException(status_code=400, detail="Final text is empty.")

    conn = get_conn()
    cur = conn.cursor()

    try:
        # -------------------------
        # Student validation
        # -------------------------
        cur.execute("""
            SELECT *
            FROM students
            WHERE email = %s
        """, (current_user["email"],))
        student = cur.fetchone()

        if not student:
            raise HTTPException(status_code=404, detail="Student record not found")

        course_code = course_code.strip()
        assignment_number = assignment_number.strip()
        semester_name = semester_name.strip()

        # -------------------------
        # Semester validation
        # -------------------------
        semester = semester_exists(cur, semester_name)
        if not semester:
            raise HTTPException(status_code=404, detail="Semester not found")

        # -------------------------
        # Course belongs to semester (IMPORTANT)
        # -------------------------
        cur.execute("""
            SELECT 1
            FROM semester_courses
            WHERE semester_id = %s AND course_code = %s
        """, (semester["id"], course_code))
        course_row = cur.fetchone()

        if not course_row:
            raise HTTPException(
                status_code=400,
                detail="Invalid course for selected semester"
            )

        # -------------------------
        # Assignment validation
        # -------------------------
        cur.execute("""
            SELECT 1
            FROM assignments
            WHERE course_code = %s AND assignment_number = %s
        """, (course_code, assignment_number))
        assignment = cur.fetchone()

        if not assignment:
            raise HTTPException(status_code=404, detail="Assignment not found")

        # -------------------------
        # Duplicate submission check
        # -------------------------
        cur.execute("""
            SELECT 1
            FROM submissions
            WHERE student_id = %s
              AND semester_name = %s
              AND course_code = %s
              AND assignment_number = %s
        """, (
            student["student_id"],
            semester_name,
            course_code,
            assignment_number
        ))
        existing = cur.fetchone()

        if existing:
            raise HTTPException(
                status_code=400,
                detail="You have already submitted this assignment for this semester."
            )

        # -------------------------
        # File validation
        # -------------------------
        if not final_file.filename or not final_file.filename.lower().endswith(".docx"):
            raise HTTPException(status_code=400, detail="Final submission must be a .docx file")

        if draft_file and draft_file.filename and not draft_file.filename.lower().endswith((".doc", ".docx")):
            raise HTTPException(status_code=400, detail="Draft file must be .doc or .docx")
        
        # -------------------------
        # Save draft file (if exists)
        # -------------------------
        safe_draft_name = None
        
        if draft_file and draft_file.filename:
            safe_draft_name = (
                f"{student['student_id']}_{course_code}_{assignment_number}_DRAFT_{uuid4().hex}.docx"
            )

            draft_path = UPLOAD_DIR / safe_draft_name

            with open(draft_path, "wb") as buffer:
                shutil.copyfileobj(draft_file.file, buffer)

        # -------------------------
        # Save file
        # -------------------------
        safe_final_name = (
            f"{student['student_id']}_{course_code}_{assignment_number}_{uuid4().hex}.docx"
        )
        stored_final_path = UPLOAD_DIR / safe_final_name
        with open(stored_final_path, "wb") as buffer:
            shutil.copyfileobj(final_file.file, buffer)

        # -------------------------
        # AI Processing
        # -------------------------
        prediction = predict_text(final_text)
        label = prediction["label"]
        score = float(prediction["ai_score"])
        
        raw_sections = prediction.get("suspicious_sections", [])
        suspicious_sections = []

        for sec in raw_sections:
            try:
                if isinstance(sec, str):
                    import json
                    sec = json.loads(sec)

                text = sec.get("preview", "")
                sec_score = sec.get("score", 0)

                if len(str(text).split()) < 5:
                    continue

                suspicious_sections.append({
                    "section_text": text,
                    "matches": [
                        {
                            "text": text,
                            "score": sec_score
                        }
                    ]   ,
                    "score": sec_score
                })
            
            except Exception: 
                continue
        
        total_words_assessed = prediction.get("total_words_assessed", 0)
        total_chunks_assessed = prediction.get("total_chunks_assessed", 0)

        decision = decision_agent(label, score)
        explanation = explain_result(final_text, label, score)

        submitted_at = now_utc_iso()

        # -------------------------
        # Store submission
        # -------------------------
                # -------------------------
        # Store submission
        # -------------------------
        cur.execute("""
            INSERT INTO submissions (
                submitted_at,
                semester_name,
                student_name,
                student_id,
                student_email,
                course_code,
                assignment_number,
                used_ai,
                used_rewrite,
                used_research,
                used_complete,
                evidence_text,
                draft_text,
                draft_file_name,
                final_text,
                stored_file_name,
                stored_file_path,
                label,
                confidence,
                decision,
                explanation,
                total_words_assessed,
                total_chunks_assessed
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
            RETURNING id
        """, (
            submitted_at,
            semester_name,
            student["student_name"],
            student["student_id"],
            student["email"],
            course_code,
            assignment_number,
            int(used_ai),
            int(used_rewrite),
            int(used_research),
            int(used_complete),
            evidence_text.strip() if evidence_text else "",
            draft_text.strip() if draft_text else "",
            safe_draft_name,
            final_text,
            safe_final_name,
            str(stored_final_path),
            label,
            score,
            decision,
            explanation,
            total_words_assessed,
            total_chunks_assessed,
        ))

        row = cur.fetchone()
        submission_id = row["id"] if row else None

        conn.commit()

        return {
            "message": "Submission stored successfully",
            "submission_id": submission_id,
            "submitted_at": submitted_at,
            "semester_name": semester_name,
            "course_code": course_code,
            "assignment_number": assignment_number,
            "label": label,
            "confidence": round(float(score), 4),
            "decision": decision,
            "explanation": explanation,
            "total_words_assessed": total_words_assessed,
            "total_chunks_assessed": total_chunks_assessed,
            "used_ai": bool(used_ai),
            "used_rewrite": bool(used_rewrite),
            "used_research": bool(used_research),
            "used_complete": bool(used_complete),
        }
    finally:
        cur.close()
        conn.close()
        

@app.get("/api/teacher/submissions/{submission_id}/download-draft")
def teacher_download_draft(
    submission_id: int,
    current_user: dict = Depends(get_current_user)
):
    require_role(current_user, "teacher")

    conn = get_conn()
    cur = conn.cursor()

    try:
        cur.execute("""
            SELECT *
            FROM submissions
            WHERE id = %s
        """, (submission_id,))
        row = cur.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Submission not found")

        data = dict(row)

        if not teacher_has_course(current_user["email"], data["course_code"]):
            raise HTTPException(status_code=403, detail="Unauthorized access")

        draft_name = data.get("draft_file_name")

        if not draft_name:
            raise HTTPException(status_code=404, detail="No draft uploaded")

        draft_path = UPLOAD_DIR / draft_name

        if not draft_path.exists():
            raise HTTPException(status_code=404, detail="Draft file not found")

        return FileResponse(
            str(draft_path),
            filename=draft_name,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )

    finally:
        cur.close()
        conn.close()


@app.get("/api/teacher/submissions/{submission_id}/download-report")
def teacher_download_ai_report(
    submission_id: int,
    current_user: dict = Depends(get_current_user)
):
    require_role(current_user, "teacher")

    conn = get_conn()
    cur = conn.cursor()

    try:
        cur.execute("""
            SELECT *
            FROM submissions
            WHERE id = %s
        """, (submission_id,))
        row = cur.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Submission not found")

        data = dict(row)

        if not teacher_has_course(current_user["email"], data["course_code"]):
            raise HTTPException(status_code=403, detail="Unauthorized access")

        student_id = data.get("student_id", f"submission_{submission_id}")
        pdf_path = REPORTS_DIR / f"{student_id}_ai_report.pdf"

        c = canvas.Canvas(str(pdf_path), pagesize=A4)
        width, height = A4

        margin_x = 50
        y = height - 60

        confidence_raw = data.get("confidence")
        ai_score_pct = f"{float(confidence_raw) * 100:.2f}%" if confidence_raw is not None else "N/A"

        label_text = str(data.get("label", "")).strip().lower()
        if label_text == "ai":
            pretty_label = "AI"
        elif label_text == "human":
            pretty_label = "Human"
        elif label_text == "mixed":
            pretty_label = "Mixed"
        else:
            pretty_label = str(data.get("label", "") or "-")

        def yes_no(value):
            return "Yes" if int(value or 0) == 1 else "No"

        # Title
        c.setFont("Helvetica-Bold", 22)
        c.drawString(margin_x, y, "AI Disclosure")

        y -= 28
        c.setFont("Helvetica", 13)
        c.drawString(margin_x, y, "Teacher AI Report")

        y -= 25
        c.line(margin_x, y, width - margin_x, y)

        # Submission details
        y -= 35
        c.setFont("Helvetica-Bold", 14)
        c.drawString(margin_x, y, "Submission Details")

        y -= 22
        details = [
            ("Submission ID", data.get("id", "")),
            ("Student Name", data.get("student_name", "")),
            ("Student ID", data.get("student_id", "")),
            ("Student Email", data.get("student_email", "")),
            ("Semester", data.get("semester_name", "")),
            ("Course Code", data.get("course_code", "")),
            ("Assignment", data.get("assignment_number", "")),
            ("Submitted At", data.get("submitted_at", "")),
        ]

        for label, value in details:
            c.setFont("Helvetica-Bold", 11)
            c.drawString(margin_x, y, f"{label}:")
            c.setFont("Helvetica", 11)
            c.drawString(margin_x + 130, y, str(value))
            y -= 20

        # Disclosure details
        y -= 10
        c.setFont("Helvetica-Bold", 14)
        c.drawString(margin_x, y, "AI Disclosure Details")

        y -= 22
        disclosure_lines = [
            ("Used AI", yes_no(data.get("used_ai"))),
            ("Used Rewrite", yes_no(data.get("used_rewrite"))),
            ("Used Research", yes_no(data.get("used_research"))),
            ("Used Complete", yes_no(data.get("used_complete"))),
        ]

        for label, value in disclosure_lines:
            c.setFont("Helvetica-Bold", 11)
            c.drawString(margin_x, y, f"{label}:")
            c.setFont("Helvetica", 11)
            c.drawString(margin_x + 130, y, str(value))
            y -= 20

        # Evidence text
        evidence_text = str(data.get("evidence_text", "") or "").strip()
        if evidence_text:
            y -= 10
            c.setFont("Helvetica-Bold", 14)
            c.drawString(margin_x, y, "Disclosure Note")

            y -= 20
            c.setFont("Helvetica", 11)
            for line in wrap_text(evidence_text, 90):
                if y < 70:
                    c.showPage()
                    y = height - 60
                    c.setFont("Helvetica", 11)
                c.drawString(margin_x, y, line)
                y -= 16

        # AI result
        y -= 10
        if y < 100:
            c.showPage()
            y = height - 60

        c.setFont("Helvetica-Bold", 14)
        c.drawString(margin_x, y, "AI Result")

        y -= 24
        result_lines = [
            ("AI Score", ai_score_pct),
            ("Classification", pretty_label),
            ("Decision", data.get("decision", "")),
            ("Total Words Assessed", data.get("total_words_assessed", "")),
            ("Total Chunks Assessed", data.get("total_chunks_assessed", "")),
        ]

        for label, value in result_lines:
            c.setFont("Helvetica-Bold", 11)
            c.drawString(margin_x, y, f"{label}:")
            c.setFont("Helvetica", 11)
            c.drawString(margin_x + 130, y, str(value))
            y -= 20

        # Explanation
        y -= 10
        c.setFont("Helvetica-Bold", 14)
        c.drawString(margin_x, y, "Explanation")

        y -= 22
        c.setFont("Helvetica", 11)
        explanation = str(data.get("explanation", "No explanation available"))

        for line in wrap_text(explanation, 90):
            if y < 70:
                c.showPage()
                y = height - 60
                c.setFont("Helvetica", 11)
            c.drawString(margin_x, y, line)
            y -= 16

        # Footer
        y -= 15
        if y < 60:
            c.showPage()
            y = height - 60

        c.setFont("Helvetica-Oblique", 9)
        c.drawString(
            margin_x,
            y,
            "This report summarizes the automated AI assessment recorded at the time of submission."
        )

        c.save()

        return FileResponse(
            str(pdf_path),
            filename=f"{student_id}_AI_Report.pdf",
            media_type="application/pdf"
        )
    finally:
        cur.close()
        conn.close()

@app.get("/api/student/submissions/{submission_id}/receipt-pdf")
def export_student_receipt_pdf(
    submission_id: int,
    current_user: dict = Depends(get_current_user)
):
    require_role(current_user, "student")

    conn = get_conn()
    cur = conn.cursor()

    cur.execute("""
        SELECT *
        FROM submissions
        WHERE id = %s
          AND student_email = %s
    """, (submission_id, current_user["email"]))
    row = cur.fetchone()

    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Submission not found")

    data = dict(row)
    pdf_path = REPORTS_DIR / f"student_receipt_{submission_id}.pdf"
    c = canvas.Canvas(str(pdf_path), pagesize=A4)
    width, height = A4

    margin_x = 50
    y = height - 60

    ai_score_raw = data.get("confidence")
    ai_score_pct = f"{float(ai_score_raw) * 100:.2f}%" if ai_score_raw is not None else "N/A"

    # Title
    c.setFont("Helvetica-Bold", 22)
    c.drawString(margin_x, y, "AI Disclosure")

    y -= 28
    c.setFont("Helvetica", 13)
    c.drawString(margin_x, y, "Student AI Report")

    y -= 25
    c.line(margin_x, y, width - margin_x, y)

    # Submission details
    y -= 35
    c.setFont("Helvetica-Bold", 14)
    c.drawString(margin_x, y, "Submission Details")

    y -= 22
    c.setFont("Helvetica", 11)

    details = [
        ("Submission ID", data.get("id", "")),
        ("Student Name", data.get("student_name", "")),
        ("Student ID", data.get("student_id", "")),
        ("Course Code", data.get("course_code", "")),
        ("Assignment", data.get("assignment_number", "")),
        ("Semester", data.get("semester_name", "")),
        ("Submitted At", data.get("submitted_at", "")),
    ]

    for label, value in details:
        c.setFont("Helvetica-Bold", 11)
        c.drawString(margin_x, y, f"{label}:")
        c.setFont("Helvetica", 11)
        c.drawString(margin_x + 120, y, str(value))
        y -= 20

    # AI result section
    y -= 10
    c.setFont("Helvetica-Bold", 14)
    c.drawString(margin_x, y, "AI Result")

    y -= 24
    ai_result_lines = [
        ("AI Score", ai_score_pct),
        ("Classification", str(data.get("label", "")).upper()),
        ("Decision", data.get("decision", "")),
    ]

    for label, value in ai_result_lines:
        c.setFont("Helvetica-Bold", 11)
        c.drawString(margin_x, y, f"{label}:")
        c.setFont("Helvetica", 11)
        c.drawString(margin_x + 120, y, str(value))
        y -= 20

    # Explanation
    y -= 10
    c.setFont("Helvetica-Bold", 14)
    c.drawString(margin_x, y, "Explanation")

    y -= 22
    c.setFont("Helvetica", 11)
    explanation = str(data.get("explanation", "No explanation available"))

    for line in wrap_text(explanation, 90):
        if y < 70:
            c.showPage()
            y = height - 60
            c.setFont("Helvetica", 11)
        c.drawString(margin_x, y, line)
        y -= 16

    # Footer note
    y -= 15
    if y < 60:
        c.showPage()
        y = height - 60

    c.setFont("Helvetica-Oblique", 9)
    c.drawString(
        margin_x,
        y,
        "This report summarizes the automated AI assessment recorded at the time of submission."
    )

    c.save()

    return FileResponse(
        str(pdf_path),
        media_type="application/pdf",
        filename=f"AI_Report_{submission_id}.pdf"
    )


# =========================================================
# Teacher APIs
# =========================================================
@app.get("/api/teacher/courses")
def teacher_get_courses(
    semester_name: str = Query(...),
    current_user: dict = Depends(get_current_user)
):
    require_role(current_user, "teacher")

    conn = get_conn()
    cur = conn.cursor()

    try:
        semester = semester_exists(cur, semester_name)
        if not semester:
            raise HTTPException(status_code=404, detail="Semester not found")

        cur.execute("""
            SELECT c.course_code, c.course_name
            FROM teacher_courses tc
            JOIN semester_courses sc ON sc.course_code = tc.course_code
            JOIN courses c ON c.course_code = tc.course_code
            WHERE tc.teacher_email = %s AND sc.semester_id = %s
            ORDER BY c.course_code ASC
        """, (current_user["email"], semester["id"]))
        rows = cur.fetchall()
        return {"courses": [dict(r) for r in rows]}
    finally:
        cur.close()
        conn.close()


@app.get("/api/teacher/assignments")
def teacher_get_assignments(
    course_code: str = Query(...),
    current_user: dict = Depends(get_current_user)
):
    require_role(current_user, "teacher")

    if not teacher_has_course(current_user["email"], course_code.strip()):
        raise HTTPException(status_code=403, detail="You are not assigned to this course")

    conn = get_conn()
    cur = conn.cursor()

    try:
        cur.execute("""
            SELECT assignment_number, assignment_title
            FROM assignments
            WHERE course_code = %s
            ORDER BY assignment_number ASC
        """, (course_code.strip(),))
        rows = cur.fetchall()

        return {"assignments": [dict(r) for r in rows]}
    finally:
        cur.close()
        conn.close()


@app.get("/api/teacher/submissions")
def teacher_get_submissions(
    semester_name: str = Query(...),
    course_code: str = Query(...),
    assignment_number: str = Query(...),
    student_search: str = Query(""),
    current_user: dict = Depends(get_current_user)
):
    require_role(current_user, "teacher")

    if not teacher_has_course(current_user["email"], course_code.strip()):
        raise HTTPException(status_code=403, detail="You are not assigned to this course")

    conn = get_conn()
    cur = conn.cursor()

    try:
        search_term = f"%{student_search.strip()}%"
        cur.execute("""
            SELECT
                id,
                submitted_at,
                semester_name,
                student_name,
                student_id,
                student_email,
                course_code,
                assignment_number,
                used_ai,
                confidence,
                label,
                decision,
                explanation,
                total_words_assessed,
                total_chunks_assessed
            FROM submissions
            WHERE semester_name = %s
              AND course_code = %s
              AND assignment_number = %s
              AND (
                    %s = '%%'
                    OR student_name LIKE %s
                    OR student_id LIKE %s
                    OR student_email LIKE %s
                  )
            ORDER BY submitted_at DESC
        """, (
            semester_name.strip(),
            course_code.strip(),
            assignment_number.strip(),
            search_term,
            search_term,
            search_term,
            search_term,
        ))
        rows = cur.fetchall()

        return {"submissions": [dict(r) for r in rows]}
    finally:
        cur.close()
        conn.close()


@app.get("/api/teacher/submissions/{submission_id}/download-file")
def teacher_download_original_file(
    submission_id: int,
    current_user: dict = Depends(get_current_user)
):
    require_role(current_user, "teacher")

    conn = get_conn()
    cur = conn.cursor()

    try:
        cur.execute("""
            SELECT *
            FROM submissions
            WHERE id = %s
        """, (submission_id,))
        row = cur.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Submission not found")

        data = dict(row)

        if not teacher_has_course(current_user["email"], data["course_code"]):
            raise HTTPException(status_code=403, detail="Unauthorized access")

        file_name = data.get("stored_file_name")
        
        file_path_obj = UPLOAD_DIR / file_name if file_name else None

        if not file_path_obj or not file_path_obj.exists():
            raise HTTPException(status_code=404, detail="Submitted original file is not available")

        return FileResponse(
            path=str(file_path_obj),
            filename=file_name,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            )
    finally:
        cur.close()
        conn.close()
        
@app.post("/api/teacher/add-student")
def teacher_add_student(
    data: TeacherAddStudentRequest,
    current_user: dict = Depends(get_current_user)
):
    require_role(current_user, "teacher")

    if not teacher_has_course(current_user["email"], data.course_code.strip()):
        raise HTTPException(status_code=403, detail="You are not allowed to manage this course")

    conn = get_conn()
    cur = conn.cursor()

    try:
        semester = semester_exists(cur, data.semester_name)
        if not semester:
            raise HTTPException(status_code=404, detail="Semester not found")

        if not semester_course_exists(cur, data.semester_name, data.course_code):
            raise HTTPException(status_code=400, detail="This course is not available in the selected semester")

        cur.execute("""
            SELECT *
            FROM students
            WHERE email = %s OR student_id = %s
        """, (data.email.strip(), data.student_id.strip()))
        existing_student = cur.fetchone()

        if existing_student:
            student_id_value = existing_student["student_id"]
        else:
            cur.execute("""
                SELECT *
                FROM users
                WHERE email = %s
            """, (data.email.strip(),))
            existing_user = cur.fetchone()

            if not existing_user:
                cur.execute("""
                    INSERT INTO users (full_name, email, role, is_active, is_verified)
                    VALUES (%s, %s, 'student', 1, 0)
                """, (data.student_name.strip(), data.email.strip()))

            cur.execute("""
                INSERT INTO students (student_name, email, student_id)
                VALUES (%s, %s, %s)
            """, (data.student_name.strip(), data.email.strip(), data.student_id.strip()))

            student_id_value = data.student_id.strip()

        cur.execute("""
            SELECT 1
            FROM student_courses
            WHERE student_id = %s AND course_code = %s
        """, (student_id_value, data.course_code.strip()))
        existing_enrollment = cur.fetchone()

        if existing_enrollment:
            raise HTTPException(status_code=400, detail="Student is already enrolled in this course")

        cur.execute("""
            INSERT INTO student_courses (student_id, course_code)
            VALUES (%s, %s)
        """, (student_id_value, data.course_code.strip()))

        conn.commit()
        return {"message": "Student added to course successfully"}
    finally:
        cur.close()
        conn.close()


@app.get("/api/teacher/export-csv")
def teacher_export_csv(
    semester_name: str = Query(...),
    course_code: str = Query(...),
    assignment_number: str = Query(...),
    student_search: str = Query(""),
    current_user: dict = Depends(get_current_user)
):
    require_role(current_user, "teacher")

    if not teacher_has_course(current_user["email"], course_code.strip()):
        raise HTTPException(status_code=403, detail="You are not assigned to this course")

    conn = get_conn()
    cur = conn.cursor()

    try:
        search_term = f"%{student_search.strip()}%"
        cur.execute("""
            SELECT
                semester_name,
                student_name,
                student_id,
                student_email,
                course_code,
                assignment_number,
                submitted_at,
                confidence,
                label,
                decision,
                total_words_assessed
            FROM submissions
            WHERE semester_name = %s
              AND course_code = %s
              AND assignment_number = %s
              AND (
                    %s = '%%'
                    OR student_name LIKE %s
                    OR student_id LIKE %s
                    OR student_email LIKE %s
                  )
            ORDER BY submitted_at DESC
        """, (
            semester_name.strip(),
            course_code.strip(),
            assignment_number.strip(),
            search_term,
            search_term,
            search_term,
            search_term,
        ))
        rows = cur.fetchall()

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "semester_name",
            "student_name",
            "student_id",
            "student_email",
            "course_code",
            "assignment_number",
            "submitted_at",
            "ai_score",
            "label",
            "decision",
            "total_words_assessed",
        ])

        for row in rows:
            writer.writerow([
                row["semester_name"],
                row["student_name"],
                row["student_id"],
                row["student_email"],
                row["course_code"],
                row["assignment_number"],
                row["submitted_at"],
                row["confidence"],
                row["label"],
                row["decision"],
                row["total_words_assessed"],
            ])

        output.seek(0)
        filename = f"{course_code.strip()}_{assignment_number.strip()}_{semester_name.strip().replace(',','')}_ai_results.csv"

        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    finally:
        cur.close()
        conn.close()


@app.post("/api/teacher/submissions/{submission_id}/allow-resubmission")
def teacher_allow_resubmission(
    submission_id: int,
    current_user: dict = Depends(get_current_user)
):
    require_role(current_user, "teacher")

    conn = get_conn()
    cur = conn.cursor()

    try:
        cur.execute("""
            SELECT *
            FROM submissions
            WHERE id = %s
        """, (submission_id,))
        row = cur.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Submission not found")

        data = dict(row)

        if not teacher_has_course(current_user["email"], data["course_code"]):
            raise HTTPException(status_code=403, detail="You are not allowed to modify this submission")

        file_name = data.get("stored_file_name")
        file_path_obj = UPLOAD_DIR / file_name if file_name else None

        if file_path_obj and file_path_obj.exists():
            try:
                file_path_obj.unlink()
            except Exception:
                pass

        cur.execute("""
            DELETE FROM submissions
            WHERE id = %s
        """, (submission_id,))

        conn.commit()
        return {"message": "Resubmission allowed successfully"}
    finally:
        cur.close()
        conn.close()
        
#--------------------------------

@app.get("/debug/db")
def debug_db():
    return {"database_url": DATABASE_URL}

#---------------------------------------
@app.get("/debug/admins")
def debug_admins():
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT id, full_name, email, is_active
            FROM admins
            ORDER BY id ASC
        """)
        return cur.fetchall()
    except Exception as e:
        return {"error": str(e)}
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()

#--------------------------------
