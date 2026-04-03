import os
import sqlite3
from pathlib import Path
from passlib.context import CryptContext

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR))
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "submissions.db"

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

full_name = "AI Disclosure Admin"
email = "aidisclosure@gmail.com"
plain_password = "!0no@ghost"

password_hash = pwd_context.hash(plain_password)

conn = sqlite3.connect(str(DB_PATH))
cur = conn.cursor()

cur.execute("""
    CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
""")

existing = cur.execute(
    "SELECT id FROM admins WHERE email = ?",
    (email,)
).fetchone()

if existing:
    cur.execute("""
        UPDATE admins
        SET full_name = ?, password_hash = ?, is_active = 1
        WHERE email = ?
    """, (full_name, password_hash, email))
    conn.commit()
    print("Admin already existed. Password updated.")
else:
    cur.execute("""
        INSERT INTO admins (full_name, email, password_hash, is_active)
        VALUES (?, ?, ?, 1)
    """, (full_name, email, password_hash))
    conn.commit()
    print("Admin created successfully.")

conn.close()
print("DB PATH:", DB_PATH)