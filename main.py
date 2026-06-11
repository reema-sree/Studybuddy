from pathlib import Path
from datetime import datetime, timedelta
import asyncio
import json
import os
import random
import sqlite3
import string
import uuid
import smtplib
import ssl
from email.message import EmailMessage

import bcrypt

# Global lock — prevents two simultaneous polls from creating two separate rooms
_match_lock = asyncio.Lock()

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import socketio

try:
    from google import genai
except Exception:
    genai = None

BASE_DIR = Path(__file__).resolve().parent
TEMPLATE_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"
DB_PATH = BASE_DIR / "studybuddy.db"

load_dotenv(BASE_DIR / ".env")

def env_value(*names, default=""):
    for name in names:
        value = os.getenv(name)
        if value:
            return value.strip()
    return default


def env_int(name, default):
    try:
        return int(os.getenv(name, str(default)) or default)
    except ValueError:
        return default


def env_bool(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


gmail_user = env_value("GMAIL_USER", "EMAIL_USER", "SMTP_USER")
# FIX: strip spaces from App Password — Google formats it with spaces but smtplib needs none
gmail_password = env_value("GMAIL_APP_PASSWORD", "GMAIL_PASSWORD", "EMAIL_PASSWORD", "SMTP_PASSWORD").replace(" ", "")
smtp_host = env_value("SMTP_HOST", default="smtp.gmail.com")
smtp_port = env_int("SMTP_PORT", 587)
smtp_from_name = env_value("SMTP_FROM_NAME", default="Study Buddy")
smtp_use_ssl = env_bool("SMTP_SSL", smtp_port == 465)
smtp_starttls = env_bool("SMTP_STARTTLS", not smtp_use_ssl)

resend_api_key = env_value("RESEND_API_KEY")
resend_from = env_value("RESEND_FROM", default="onboarding@resend.dev")

brevo_api_key = env_value("BREVO_API_KEY")
brevo_sender = env_value("BREVO_SENDER", default=gmail_user)

gemini_key = os.getenv("GEMINI_KEY")
gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

if genai and gemini_key:
    try:
        ai_client = genai.Client(api_key=gemini_key)
        print("Gemini ready")
    except Exception as exc:
        print(f"Gemini setup failed: {exc}")
        ai_client = None
else:
    ai_client = None
    print("Gemini not configured")

# TURN server config from env (optional — falls back to public STUN only)
turn_url      = env_value("TURN_URL")
turn_username = env_value("TURN_USERNAME")
turn_password = env_value("TURN_PASSWORD", "TURN_CREDENTIAL")

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    max_http_buffer_size=20_000_000,
    logger=False,
    engineio_logger=False,
)

app = FastAPI(title="Study Buddy")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
socket_app = socketio.ASGIApp(sio, app)

room_connections = {}
sid_index = {}



def make_code(length=6):
    return "".join(random.choices(string.digits, k=length))


def send_email(to_email, subject, html_body):
    if not email_configured():
        print("Email not configured - set BREVO_API_KEY, RESEND_API_KEY, or GMAIL_USER/GMAIL_APP_PASSWORD.")
        return False

    if brevo_api_key:
        try:
            import requests
            url = "https://api.brevo.com/v3/smtp/email"
            headers = {
                "api-key": brevo_api_key,
                "Content-Type": "application/json"
            }
            payload = {
                "sender": { "name": smtp_from_name, "email": brevo_sender },
                "to": [ { "email": to_email } ],
                "subject": subject,
                "htmlContent": html_body
            }
            response = requests.post(url, json=payload, headers=headers, timeout=20)
            if response.status_code in {200, 201}:
                print(f"Email sent via Brevo to {to_email}")
                return True
            else:
                print(f"Brevo email send failed: {response.status_code} - {response.text}")
                return False
        except Exception as exc:
            print(f"Brevo email send failed: {exc}")
            return False
    elif resend_api_key:
        try:
            import requests
            url = "https://api.resend.com/emails"
            headers = {
                "Authorization": f"Bearer {resend_api_key}",
                "Content-Type": "application/json"
            }
            # Prepend name to from address if it doesn't already contain a brackets layout
            from_str = f"{smtp_from_name} <{resend_from}>" if "<" not in resend_from else resend_from
            payload = {
                "from": from_str,
                "to": [to_email],
                "subject": subject,
                "html": html_body
            }
            response = requests.post(url, json=payload, headers=headers, timeout=20)
            if response.status_code in {200, 201}:
                print(f"Email sent via Resend to {to_email}")
                return True
            else:
                print(f"Resend email send failed: {response.status_code} - {response.text}")
                return False
        except Exception as exc:
            print(f"Resend email send failed: {exc}")
            return False
    else:
        try:
            msg = EmailMessage()
            msg["Subject"] = subject
            msg["From"]    = f"{smtp_from_name} <{gmail_user}>"
            msg["To"]      = to_email
            msg.set_content("Open this email in an HTML-capable client to view your Study Buddy code.")
            msg.add_alternative(html_body, subtype="html")

            context = ssl.create_default_context()
            if smtp_use_ssl:
                with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=20, context=context) as server:
                    server.login(gmail_user, gmail_password)
                    server.send_message(msg)
            else:
                with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as server:
                    server.ehlo()
                    if smtp_starttls:
                        server.starttls(context=context)
                        server.ehlo()
                    server.login(gmail_user, gmail_password)
                    server.send_message(msg)
            print(f"Email sent via SMTP to {to_email}")
            return True
        except smtplib.SMTPAuthenticationError as exc:
            print(f"Email send failed: SMTP authentication rejected — {exc}. For Gmail, use an App Password (no spaces).")
            return False
        except Exception as exc:
            print(f"Email send failed: {exc}")
            return False


def email_configured():
    return bool(brevo_api_key) or bool(resend_api_key) or bool(gmail_user and gmail_password)


EMAIL_SEND_ERROR = "Could not send the email. Check SMTP variables in the deployed environment."


def send_verification_email(to_email, name, code):
    return send_email(to_email, "Study Buddy - Verify your email", _verification_email(name, code))


def send_reset_email(to_email, name, code):
    return send_email(to_email, "Study Buddy - Password Reset", _reset_email(name, code))


def connect_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def make_room_code():
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


def init_db():
    conn = connect_db()
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            email               TEXT PRIMARY KEY,
            name                TEXT NOT NULL,
            password_hash       BLOB NOT NULL,
            auth_token          TEXT,
            email_verified      INTEGER DEFAULT 0,
            verification_code   TEXT,
            verification_expires TEXT,
            reset_code          TEXT,
            reset_expires       TEXT,
            stats               TEXT DEFAULT '{}',
            notes               TEXT DEFAULT '[]',
            created_at          TEXT,
            last_login          TEXT
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS rooms (
            code TEXT PRIMARY KEY,
            host TEXT,
            subject TEXT,
            members TEXT,
            messages TEXT,
            created_at TEXT,
            active INTEGER DEFAULT 1
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS waiting_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_name TEXT,
            user_email TEXT,
            subject TEXT,
            joined_at TEXT
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS match_results (
            user_email TEXT PRIMARY KEY,
            room_code TEXT,
            subject TEXT,
            members TEXT,
            created_at TEXT
        )
    """)

    conn.commit()
    conn.close()


def create_unique_room(cur):
    for _ in range(20):
        code = make_room_code()
        cur.execute("SELECT code FROM rooms WHERE code = ?", (code,))
        if not cur.fetchone():
            return code
    raise RuntimeError("Could not create unique room code")


def clean_user(data):
    name = (data.get("user_name") or data.get("name") or "Student").strip()
    email = (data.get("user_email") or data.get("email") or "").strip().lower()
    subject = (data.get("subject") or "Other").strip()

    if not email:
        safe_name = "".join(ch for ch in name.lower() if ch.isalnum()) or "guest"
        email = f"{safe_name}-{random.randint(1000, 9999)}@guest.local"

    return name, email, subject


def template(name):
    return FileResponse(TEMPLATE_DIR / name)


# FIX: proper datetime comparison using fromisoformat instead of string comparison
def is_expired(iso_string: str) -> bool:
    """Returns True if the ISO datetime string is in the past."""
    if not iso_string:
        return True
    try:
        return datetime.now() > datetime.fromisoformat(iso_string)
    except ValueError:
        return True


init_db()
print("Database ready")
print(f"Email configured: {email_configured()} (user={gmail_user!r})")


async def emit_room_users(room_code):
    users = []
    for email, info in room_connections.get(room_code, {}).items():
        users.append({"email": email, "name": info.get("name") or email.split("@")[0]})

    await sio.emit("room-users", {"users": users, "total": len(users)}, room=room_code)


@sio.event
async def connect(sid, environ):
    print(f"Socket connected: {sid}")


@sio.event
async def disconnect(sid):
    old = sid_index.pop(sid, None)
    if not old:
        print(f"Socket disconnected: {sid}")
        return

    room_code, email = old
    entry = room_connections.get(room_code, {}).get(email)

    if entry and entry.get("sid") == sid:
        del room_connections[room_code][email]

    if room_code in room_connections and not room_connections[room_code]:
        del room_connections[room_code]

    await emit_room_users(room_code)
    await sio.emit("user-left", {"email": email}, room=room_code)
    print(f"Socket disconnected: {sid}")


@sio.event
async def join_room_signal(sid, data):
    room_code = (data.get("room_code") or "").upper().strip()
    user_name = (data.get("user_name") or "Student").strip()
    user_email = (data.get("user_email") or "").lower().strip()

    if not room_code or not user_email:
        return

    await sio.enter_room(sid, room_code)

    room_connections.setdefault(room_code, {})
    room_connections[room_code][user_email] = {"sid": sid, "name": user_name}
    sid_index[sid] = (room_code, user_email)

    await emit_room_users(room_code)


@sio.event
async def leave_room_signal(sid, data):
    room_code = (data.get("room_code") or "").upper().strip()
    user_email = (data.get("user_email") or "").lower().strip()

    if room_code:
        await sio.leave_room(sid, room_code)

    if room_code in room_connections and user_email in room_connections[room_code]:
        del room_connections[room_code][user_email]

    sid_index.pop(sid, None)
    await emit_room_users(room_code)
    await sio.emit("user-left", {"email": user_email}, room=room_code)


@sio.event
async def webrtc_offer(sid, data):
    room_code = (data.get("room_code") or "").upper().strip()
    target = (data.get("target") or "").lower().strip()

    target_info = room_connections.get(room_code, {}).get(target)
    if not target_info:
        return

    await sio.emit(
        "webrtc_offer",
        {
            "offer": data.get("offer"),
            "from_name": data.get("from_name"),
            "from_email": data.get("from_email"),
        },
        to=target_info["sid"],
    )


@sio.event
async def webrtc_answer(sid, data):
    room_code = (data.get("room_code") or "").upper().strip()
    target = (data.get("target") or "").lower().strip()

    target_info = room_connections.get(room_code, {}).get(target)
    if not target_info:
        return

    await sio.emit(
        "webrtc_answer",
        {
            "answer": data.get("answer"),
            "from_name": data.get("from_name"),
            "from_email": data.get("from_email"),
        },
        to=target_info["sid"],
    )


@sio.event
async def webrtc_ice_candidate(sid, data):
    room_code = (data.get("room_code") or "").upper().strip()
    target = (data.get("target") or "").lower().strip()

    target_info = room_connections.get(room_code, {}).get(target)
    if not target_info:
        return

    await sio.emit(
        "webrtc_ice_candidate",
        {
            "candidate": data.get("candidate"),
            "from_name": data.get("from_name"),
            "from_email": data.get("from_email"),
        },
        to=target_info["sid"],
    )


import base64
import re

UPLOAD_DIR = STATIC_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

def save_uploaded_file(base64_data: str, filename: str) -> str:
    """
    Saves a base64 data URL to the static/uploads directory.
    Returns the relative path to the saved file (e.g. /static/uploads/uuid_filename.ext).
    """
    try:
        if not base64_data or not base64_data.startswith("data:"):
            return ""
        
        parts = base64_data.split(",", 1)
        if len(parts) != 2:
            return ""
        
        encoded_data = parts[1]
        file_bytes = base64.b64decode(encoded_data)
        
        # Clean and construct a unique filename
        # Strip path traversal attempts and only keep safe chars
        safe_filename = "".join(c for c in filename if c.isalnum() or c in "._-")
        if not safe_filename:
            safe_filename = "file.bin"
            
        unique_name = f"{uuid.uuid4().hex}_{safe_filename}"
        file_path = UPLOAD_DIR / unique_name
        
        with open(file_path, "wb") as f:
            f.write(file_bytes)
            
        return f"/static/uploads/{unique_name}"
    except Exception as e:
        print(f"Failed to save uploaded file: {e}")
        return ""


@sio.event
async def chat_message_socket(sid, data):
    room_code = (data.get("room_code") or "").upper().strip()
    if not room_code:
        return

    msg_type  = data.get("type") or "message"
    file_name = data.get("file_name") or ""
    text      = data.get("text") or ""

    # The full message is broadcast to live room members
    broadcast_msg = {
        "user":      data.get("user_name") or "Student",
        "text":      text,
        "type":      msg_type,
        "fileName":  file_name,
        "timestamp": datetime.now().isoformat(),
    }

    # For file messages, save the file to disk and store the relative URL
    if msg_type == "file":
        file_url = save_uploaded_file(text, file_name)
        if file_url:
            db_msg = {
                "user":      broadcast_msg["user"],
                "text":      file_url,   # Store the URL instead of empty/base64
                "type":      "file",     # Keep type as file!
                "fileName":  file_name,
                "timestamp": broadcast_msg["timestamp"],
            }
            # Update broadcast_msg so it broadcasts the URL too, saving bandwidth
            broadcast_msg["text"] = file_url
        else:
            # Fallback if saving failed
            db_msg = {
                "user":      broadcast_msg["user"],
                "text":      "",
                "type":      "file_stub",
                "fileName":  file_name,
                "timestamp": broadcast_msg["timestamp"],
            }
    else:
        db_msg = broadcast_msg

    conn = connect_db()
    cur = conn.cursor()

    try:
        cur.execute("SELECT messages FROM rooms WHERE code = ?", (room_code,))
        room = cur.fetchone()
        if room:
            messages = json.loads(room["messages"] or "[]")
            messages.append(db_msg)
            messages = messages[-200:]
            cur.execute(
                "UPDATE rooms SET messages = ? WHERE code = ?",
                (json.dumps(messages), room_code),
            )
            conn.commit()
    finally:
        conn.close()

    await sio.emit("new-message", broadcast_msg, room=room_code)



def _verification_email(name, code):
    return f"""
    <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#0b0f1a;color:#dce6f5;border-radius:16px;">
        <h2 style="color:#f0a030;margin-bottom:8px;">Study Buddy</h2>
        <p>Hi {name},</p>
        <p>Your email verification code is:</p>
        <div style="font-size:36px;font-weight:900;letter-spacing:12px;color:#f0a030;background:#18202f;padding:20px;border-radius:12px;text-align:center;margin:24px 0;">
            {code}
        </div>
        <p style="color:#5a6a85;font-size:13px;">This code expires in 15 minutes. If you didn't register, ignore this email.</p>
    </div>
    """


def _reset_email(name, code):
    return f"""
    <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#0b0f1a;color:#dce6f5;border-radius:16px;">
        <h2 style="color:#f0a030;margin-bottom:8px;">Study Buddy</h2>
        <p>Hi {name},</p>
        <p>Your password reset code is:</p>
        <div style="font-size:36px;font-weight:900;letter-spacing:12px;color:#f87171;background:#18202f;padding:20px;border-radius:12px;text-align:center;margin:24px 0;">
            {code}
        </div>
        <p style="color:#5a6a85;font-size:13px;">This code expires in 15 minutes. If you didn't request this, ignore this email.</p>
    </div>
    """


EDU_MARKERS = [".edu", ".ac.uk", ".edu.in", "student.", "university.", "college.", ".ac."]


def is_verified(email: str) -> bool:
    return any(marker in email for marker in EDU_MARKERS)


def check_auth(cur, email: str, auth_token: str):
    """Returns user row if token is valid, else None."""
    if not email or not auth_token:
        return None

    cur.execute("SELECT * FROM users WHERE email = ?", (email,))
    user = cur.fetchone()
    if not user or user["auth_token"] != auth_token:
        return None
    return user


@app.post("/auth/register")
async def register(request: Request):
    data = await request.json()
    name     = (data.get("name") or "").strip()
    email    = (data.get("email") or "").lower().strip()
    password = (data.get("password") or "")

    if not name or not email or not password:
        return {"success": False, "error": "Name, email and password are all required."}
    if len(password) < 6:
        return {"success": False, "error": "Password must be at least 6 characters."}

    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt())
    now  = datetime.now().isoformat()
    code = make_code()
    expires = (datetime.now() + timedelta(minutes=15)).isoformat()

    conn = connect_db()
    cur  = conn.cursor()
    try:
        cur.execute("SELECT email, email_verified FROM users WHERE email = ?", (email,))
        existing = cur.fetchone()

        if existing:
            if existing["email_verified"]:
                return {"success": False, "error": "Account already exists. Please sign in."}
            else:
                # FIX: also update password_hash so the new password takes effect
                cur.execute(
                    "UPDATE users SET name=?, password_hash=?, verification_code=?, verification_expires=? WHERE email=?",
                    (name, password_hash, code, expires, email)
                )
                conn.commit()
                if not send_verification_email(email, name, code):
                    return {"success": False, "error": EMAIL_SEND_ERROR}
                return {"success": True, "needs_verification": True, "email": email,
                        "message": "Verification code resent. Check your inbox."}

        cur.execute(
            """INSERT INTO users
               (email, name, password_hash, auth_token, email_verified,
                verification_code, verification_expires,
                stats, notes, created_at, last_login)
               VALUES (?,?,?,?,0,?,?,?,?,?,?)""",
            (email, name, password_hash, "", code, expires, "{}", "[]", now, now)
        )
        conn.commit()

        if not send_verification_email(email, name, code):
            return {"success": False, "error": EMAIL_SEND_ERROR}

        return {"success": True, "needs_verification": True, "email": email,
                "message": "Check your email for the 6-digit verification code."}
    except Exception as exc:
        conn.rollback()
        return {"success": False, "error": str(exc)}
    finally:
        conn.close()


@app.post("/auth/login")
async def auth_login(request: Request):
    data     = await request.json()
    email    = (data.get("email") or "").lower().strip()
    password = (data.get("password") or "")

    if not email or not password:
        return {"success": False, "error": "Email and password are required."}

    conn = connect_db()
    cur  = conn.cursor()
    try:
        cur.execute("SELECT * FROM users WHERE email = ?", (email,))
        user = cur.fetchone()

        if not user:
            return {"success": False, "error": "No account found. Please register first."}
        if not bcrypt.checkpw(password.encode(), user["password_hash"]):
            return {"success": False, "error": "Incorrect password. Please try again."}

        # FIX: enforce email verification before allowing login
        if not user["email_verified"]:
            # Re-send a fresh verification code
            code    = make_code()
            expires = (datetime.now() + timedelta(minutes=15)).isoformat()
            cur.execute(
                "UPDATE users SET verification_code=?, verification_expires=? WHERE email=?",
                (code, expires, email)
            )
            conn.commit()
            send_verification_email(email, user["name"], code)
            return {
                "success": True,
                "needs_verification": True,
                "email": email,
                "message": "Please verify your email first. A new code has been sent.",
            }

        auth_token = str(uuid.uuid4())
        cur.execute("UPDATE users SET auth_token=?, last_login=? WHERE email=?",
                    (auth_token, datetime.now().isoformat(), email))
        conn.commit()

        return {
            "success": True,
            "user": {"name": user["name"], "email": email,
                     "verified": is_verified(email), "auth_token": auth_token},
            "stats": json.loads(user["stats"] or "{}"),
            "notes": json.loads(user["notes"] or "[]")
        }
    except Exception as exc:
        return {"success": False, "error": str(exc)}
    finally:
        conn.close()


@app.post("/auth/verify-email")
async def verify_email_code(request: Request):
    data  = await request.json()
    email = (data.get("email") or "").lower().strip()
    code  = (data.get("code") or "").strip()

    conn = connect_db()
    cur  = conn.cursor()
    try:
        cur.execute("SELECT * FROM users WHERE email = ?", (email,))
        user = cur.fetchone()

        if not user:
            return {"success": False, "error": "Account not found."}
        if user["email_verified"]:
            return {"success": False, "error": "Email already verified. Please sign in."}
        if user["verification_code"] != code:
            return {"success": False, "error": "Incorrect code. Please try again."}
        # FIX: use proper datetime comparison
        if is_expired(user["verification_expires"]):
            return {"success": False, "error": "Code expired. Please register again to get a new code."}

        auth_token = str(uuid.uuid4())
        cur.execute(
            "UPDATE users SET email_verified=1, auth_token=?, verification_code=NULL, verification_expires=NULL WHERE email=?",
            (auth_token, email)
        )
        conn.commit()

        return {
            "success": True,
            "user": {"name": user["name"], "email": email,
                     "verified": is_verified(email), "auth_token": auth_token},
            "stats": json.loads(user["stats"] or "{}"),
            "notes": json.loads(user["notes"] or "[]")
        }
    except Exception as exc:
        return {"success": False, "error": str(exc)}
    finally:
        conn.close()


@app.post("/auth/forgot-password")
async def forgot_password(request: Request):
    data  = await request.json()
    email = (data.get("email") or "").lower().strip()

    if not email:
        return {"success": False, "error": "Please enter your email address."}

    conn = connect_db()
    cur  = conn.cursor()
    try:
        cur.execute("SELECT name, email_verified FROM users WHERE email = ?", (email,))
        user = cur.fetchone()

        if not user:
            # Don't reveal whether account exists
            return {"success": True, "message": "If an account exists, a reset code has been sent."}

        code    = make_code()
        expires = (datetime.now() + timedelta(minutes=15)).isoformat()

        cur.execute("UPDATE users SET reset_code=?, reset_expires=? WHERE email=?",
                    (code, expires, email))
        conn.commit()

        if not send_reset_email(email, user["name"], code):
            return {"success": False, "error": EMAIL_SEND_ERROR}
        return {"success": True, "message": "Reset code sent. Check your inbox."}
    except Exception as exc:
        return {"success": False, "error": str(exc)}
    finally:
        conn.close()


@app.post("/auth/reset-password")
async def reset_password(request: Request):
    data         = await request.json()
    email        = (data.get("email") or "").lower().strip()
    code         = (data.get("code") or "").strip()
    new_password = (data.get("new_password") or "")

    if not email or not code or not new_password:
        return {"success": False, "error": "All fields are required."}
    if len(new_password) < 6:
        return {"success": False, "error": "Password must be at least 6 characters."}

    conn = connect_db()
    cur  = conn.cursor()
    try:
        cur.execute("SELECT * FROM users WHERE email = ?", (email,))
        user = cur.fetchone()

        if not user or user["reset_code"] != code:
            return {"success": False, "error": "Invalid or expired reset code."}
        # FIX: use proper datetime comparison
        if is_expired(user["reset_expires"]):
            return {"success": False, "error": "Reset code expired. Please request a new one."}

        new_hash   = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt())
        auth_token = str(uuid.uuid4())
        cur.execute(
            "UPDATE users SET password_hash=?, auth_token=?, email_verified=1, reset_code=NULL, reset_expires=NULL WHERE email=?",
            (new_hash, auth_token, email)
        )
        conn.commit()

        return {
            "success": True,
            "user": {"name": user["name"], "email": email,
                     "verified": is_verified(email), "auth_token": auth_token},
            "stats": json.loads(user["stats"] or "{}"),
            "notes": json.loads(user["notes"] or "[]")
        }
    except Exception as exc:
        return {"success": False, "error": str(exc)}
    finally:
        conn.close()


@app.post("/auth/save-stats")
async def save_stats(request: Request):
    data = await request.json()
    email = (data.get("email") or "").lower().strip()
    auth_token = (data.get("auth_token") or "").strip()
    stats = data.get("stats") or {}

    conn = connect_db()
    cur = conn.cursor()
    try:
        if not check_auth(cur, email, auth_token):
            return {"success": False, "error": "Unauthorized."}

        cur.execute("UPDATE users SET stats = ? WHERE email = ?", (json.dumps(stats), email))
        conn.commit()
        return {"success": True}
    except Exception as exc:
        return {"success": False, "error": str(exc)}
    finally:
        conn.close()


@app.post("/auth/save-notes")
async def save_notes(request: Request):
    data = await request.json()
    email = (data.get("email") or "").lower().strip()
    auth_token = (data.get("auth_token") or "").strip()
    notes = data.get("notes") or []

    conn = connect_db()
    cur = conn.cursor()
    try:
        if not check_auth(cur, email, auth_token):
            return {"success": False, "error": "Unauthorized."}

        cur.execute("UPDATE users SET notes = ? WHERE email = ?", (json.dumps(notes), email))
        conn.commit()
        return {"success": True}
    except Exception as exc:
        return {"success": False, "error": str(exc)}
    finally:
        conn.close()


@app.get("/auth/profile")
async def get_profile(email: str, auth_token: str):
    conn = connect_db()
    cur = conn.cursor()
    try:
        user = check_auth(cur, email.lower().strip(), auth_token.strip())
        if not user:
            return {"success": False, "error": "Unauthorized."}

        return {
            "success": True,
            "name": user["name"],
            "stats": json.loads(user["stats"] or "{}"),
            "notes": json.loads(user["notes"] or "[]")
        }
    except Exception as exc:
        return {"success": False, "error": str(exc)}
    finally:
        conn.close()


@app.get("/")
async def home():
    return template("home.html")


@app.get("/login")
async def login_page():
    return template("login.html")


@app.get("/study")
async def study():
    return template("study.html")


@app.get("/room/{room_code}")
async def room_redirect(room_code: str):
    return template("room.html")


@app.get("/health")
async def health():
    return {"status": "healthy", "ai": ai_client is not None}


# FIX: /api/ice-config endpoint — provides ICE server config to the frontend.
# On the same LAN STUN alone works; across different networks TURN is required.
# Configure TURN_URL / TURN_USERNAME / TURN_PASSWORD in .env for production.
@app.get("/api/ice-config")
async def ice_config():
    ice_servers = [
        {"urls": "stun:stun.l.google.com:19302"},
        {"urls": "stun:stun1.l.google.com:19302"},
        {"urls": "stun:stun.cloudflare.com:3478"},
    ]

    if turn_url and turn_username and turn_password:
        ice_servers.append({
            "urls": turn_url,
            "username": turn_username,
            "credential": turn_password,
        })
    else:
        # Add free public TURN servers as fallback for cross-network video.
        # These are provided by Open Relay Project and are rate-limited but functional.
        ice_servers += [
            {
                "urls": "turn:openrelay.metered.ca:80",
                "username": "openrelayproject",
                "credential": "openrelayproject",
            },
            {
                "urls": "turn:openrelay.metered.ca:443",
                "username": "openrelayproject",
                "credential": "openrelayproject",
            },
            {
                "urls": "turn:openrelay.metered.ca:443?transport=tcp",
                "username": "openrelayproject",
                "credential": "openrelayproject",
            },
        ]

    return {"iceServers": ice_servers}


@app.get("/ai/ask")
async def ask_ai(question: str, subject: str = "General"):
    if not ai_client:
        return {"success": False, "error": "AI is not configured. Add GEMINI_KEY to .env."}

    try:
        response = ai_client.models.generate_content(
            model=gemini_model,
            contents=f"You are a helpful {subject} tutor. Answer clearly:\n\n{question}",
        )
        return {"success": True, "answer": response.text}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


@app.post("/ai/summarize-room")
async def summarize_room(request: Request):
    data = await request.json()
    room_code = (data.get("room_code") or "").upper().strip()

    if not ai_client:
        return {"success": False, "summary": "AI is not configured. Add GEMINI_KEY to .env."}

    conn = connect_db()
    cur = conn.cursor()
    cur.execute("SELECT messages FROM rooms WHERE code = ? AND active = 1", (room_code,))
    room = cur.fetchone()
    conn.close()

    if not room:
        return {"success": False, "summary": "Room not found."}

    messages = json.loads(room["messages"] or "[]")
    if not messages:
        return {"success": True, "summary": "No messages to summarize yet."}

    chat_text = "\n".join(
        f"{m.get('user', 'Student')}: {m.get('text', '')}"
        for m in messages[-50:]
        if m.get("type") == "message"
    )

    try:
        response = ai_client.models.generate_content(
            model=gemini_model,
            contents=f"Summarize this study room chat concisely. List the main topics discussed and any key points:\n\n{chat_text}",
        )
        return {"success": True, "summary": response.text}
    except Exception as exc:
        return {"success": False, "summary": str(exc)}


@app.post("/ai/quiz")
async def generate_quiz(request: Request):
    data = await request.json()
    subject = (data.get("subject") or "General").strip()
    topic = (data.get("topic") or subject).strip()
    difficulty = (data.get("difficulty") or "medium").strip()

    if not ai_client:
        return {"success": False, "quiz": "AI is not configured. Add GEMINI_KEY to .env."}

    try:
        response = ai_client.models.generate_content(
            model=gemini_model,
            contents=(
                f"Create a {difficulty} difficulty quiz with 3 questions on the topic '{topic}' "
                f"for the subject {subject}. Number each question. "
                "After each question, provide the answer on a new line starting with 'Answer:'."
            ),
        )
        return {"success": True, "quiz": response.text}
    except Exception as exc:
        return {"success": False, "quiz": str(exc)}


@app.post("/ai/study-plan")
async def generate_study_plan(request: Request):
    data = await request.json()
    subject = (data.get("subject") or "General").strip()
    goal = (data.get("goal") or subject).strip()
    minutes = int(data.get("minutes") or 45)

    if not ai_client:
        return {"success": False, "plan": "AI is not configured. Add GEMINI_KEY to .env."}

    try:
        response = ai_client.models.generate_content(
            model=gemini_model,
            contents=(
                f"Create a {minutes}-minute study plan for the goal: '{goal}' (subject: {subject}). "
                "Break it into clear timed blocks with specific tasks for each block. "
                "Keep it practical and achievable."
            ),
        )
        return {"success": True, "plan": response.text}
    except Exception as exc:
        return {"success": False, "plan": str(exc)}


@app.post("/verify-student")
async def verify_student(request: Request):
    data = await request.json()
    email = (data.get("email") or "").lower()
    edu_markers = [".edu", ".ac.uk", ".edu.in", "student.", "university.", "college.", ".ac."]
    return {"success": True, "verified": any(marker in email for marker in edu_markers)}


@app.post("/match/join-queue")
async def join_queue(request: Request):
    data = await request.json()
    user_name, user_email, subject = clean_user(data)

    async with _match_lock:
        conn = connect_db()
        conn.execute("PRAGMA journal_mode=WAL")
        cur = conn.cursor()

        try:
            # Check if this user already has a pending match result
            cur.execute("SELECT * FROM match_results WHERE user_email = ?", (user_email,))
            existing = cur.fetchone()

            if existing:
                cur.execute("DELETE FROM match_results WHERE user_email = ?", (user_email,))
                conn.commit()
                return {
                    "success": True,
                    "matched": True,
                    "room_code": existing["room_code"],
                    "subject": existing["subject"],
                    "members": json.loads(existing["members"] or "[]"),
                }

            # Re-insert user into queue to refresh their timestamp
            cur.execute("DELETE FROM waiting_queue WHERE user_email = ?", (user_email,))
            cur.execute(
                """
                INSERT INTO waiting_queue (user_name, user_email, subject, joined_at)
                VALUES (?, ?, ?, ?)
                """,
                (user_name, user_email, subject, datetime.now().isoformat()),
            )

            # --- Try same-subject match first ---
            cur.execute(
                """
                SELECT user_name, user_email, subject
                FROM waiting_queue
                WHERE subject = ?
                ORDER BY joined_at ASC
                """,
                (subject,),
            )
            waiting = cur.fetchall()

            if len(waiting) >= 2:
                group = waiting[:3] if len(waiting) >= 3 else waiting[:2]
                members = [
                    {"name": r["user_name"], "email": r["user_email"], "subject": r["subject"]}
                    for r in group
                ]
                room_code = create_unique_room(cur)
                cur.execute(
                    """
                    INSERT INTO rooms (code, host, subject, members, messages, created_at, active)
                    VALUES (?, ?, ?, ?, ?, ?, 1)
                    """,
                    (
                        room_code, members[0]["name"], subject,
                        json.dumps(members), json.dumps([]),
                        datetime.now().isoformat(),
                    ),
                )
                for member in members:
                    cur.execute("DELETE FROM waiting_queue WHERE user_email = ?", (member["email"],))
                    cur.execute(
                        """
                        INSERT OR REPLACE INTO match_results
                        (user_email, room_code, subject, members, created_at)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            member["email"], room_code, subject,
                            json.dumps(members), datetime.now().isoformat(),
                        ),
                    )

                # FIX: fetch current user's match result BEFORE deleting it so we can return it
                cur.execute("SELECT * FROM match_results WHERE user_email = ?", (user_email,))
                my_result = cur.fetchone()
                cur.execute("DELETE FROM match_results WHERE user_email = ?", (user_email,))
                conn.commit()

                return {
                    "success": True,
                    "matched": True,
                    "cross_subject": False,
                    "room_code": my_result["room_code"] if my_result else room_code,
                    "subject": subject,
                    "members": members,
                }

            # Cross-subject fallback — if no same-subject partner,
            # look for ANY student waiting in the queue
            cur.execute(
                """
                SELECT user_name, user_email, subject
                FROM waiting_queue
                WHERE user_email != ?
                ORDER BY joined_at ASC
                LIMIT 1
                """,
                (user_email,),
            )
            any_partner = cur.fetchone()

            if any_partner:
                partner_subject = any_partner["subject"]
                members = [
                    {"name": user_name, "email": user_email, "subject": subject},
                    {
                        "name": any_partner["user_name"],
                        "email": any_partner["user_email"],
                        "subject": partner_subject,
                    },
                ]
                room_code = create_unique_room(cur)
                room_subject = f"{subject} / {partner_subject}"
                cur.execute(
                    """
                    INSERT INTO rooms (code, host, subject, members, messages, created_at, active)
                    VALUES (?, ?, ?, ?, ?, ?, 1)
                    """,
                    (
                        room_code, user_name, room_subject,
                        json.dumps(members), json.dumps([]),
                        datetime.now().isoformat(),
                    ),
                )
                for member in members:
                    cur.execute("DELETE FROM waiting_queue WHERE user_email = ?", (member["email"],))
                    cur.execute(
                        """
                        INSERT OR REPLACE INTO match_results
                        (user_email, room_code, subject, members, created_at)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            member["email"], room_code, room_subject,
                            json.dumps(members), datetime.now().isoformat(),
                        ),
                    )

                # FIX: fetch current user's match result BEFORE deleting it
                cur.execute("SELECT * FROM match_results WHERE user_email = ?", (user_email,))
                my_result = cur.fetchone()
                cur.execute("DELETE FROM match_results WHERE user_email = ?", (user_email,))
                conn.commit()

                return {
                    "success": True,
                    "matched": True,
                    "cross_subject": True,
                    "partner_subject": partner_subject,
                    "room_code": my_result["room_code"] if my_result else room_code,
                    "subject": room_subject,
                    "members": members,
                }

            # FIX: use total queue count (not just same-subject) for accurate waiting message
            cur.execute("SELECT COUNT(*) AS total FROM waiting_queue")
            total_waiting = cur.fetchone()["total"]

            conn.commit()
            return {
                "success": True,
                "matched": False,
                "waiting": len(waiting),
                "message": f"Waiting for a {subject} partner... ({total_waiting} total in queue)",
            }
        except Exception as exc:
            conn.rollback()
            return {"success": False, "error": str(exc)}
        finally:
            conn.close()


@app.post("/match/leave-queue")
async def leave_queue(request: Request):
    data = await request.json()
    user_email = (data.get("user_email") or "").lower().strip()

    conn = connect_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM waiting_queue WHERE user_email = ?", (user_email,))
    conn.commit()
    conn.close()

    return {"success": True}


@app.get("/match/queue-count")
async def queue_count():
    conn = connect_db()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS count FROM waiting_queue")
    count = cur.fetchone()["count"]
    conn.close()
    return {"count": count}


@app.post("/room/create")
async def create_room(request: Request):
    data = await request.json()
    user_name, user_email, subject = clean_user(data)

    conn = connect_db()
    cur = conn.cursor()

    try:
        room_code = create_unique_room(cur)
        members = [{"name": user_name, "email": user_email, "subject": subject}]

        cur.execute(
            """
            INSERT INTO rooms (code, host, subject, members, messages, created_at, active)
            VALUES (?, ?, ?, ?, ?, ?, 1)
            """,
            (
                room_code,
                user_name,
                subject,
                json.dumps(members),
                json.dumps([]),
                datetime.now().isoformat(),
            ),
        )

        conn.commit()
        return {"success": True, "room_code": room_code}
    finally:
        conn.close()


@app.post("/room/join")
async def join_room(request: Request):
    data = await request.json()
    user_name, user_email, subject = clean_user(data)
    room_code = (data.get("room_code") or "").upper().strip()

    conn = connect_db()
    cur = conn.cursor()

    try:
        cur.execute("SELECT * FROM rooms WHERE code = ? AND active = 1", (room_code,))
        room = cur.fetchone()

        if not room:
            return {"success": False, "error": "Room not found"}

        members = json.loads(room["members"] or "[]")

        if any(member.get("email") == user_email for member in members):
            return {"success": True, "room_code": room_code}

        if len(members) >= 3:
            return {"success": False, "error": "Room full. Maximum 3 students allowed."}

        members.append({"name": user_name, "email": user_email, "subject": subject})
        cur.execute(
            "UPDATE rooms SET members = ? WHERE code = ?",
            (json.dumps(members), room_code),
        )

        conn.commit()
        return {"success": True, "room_code": room_code}
    finally:
        conn.close()


@app.get("/room/{room_code}/info")
async def get_room_info(room_code: str):
    conn = connect_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM rooms WHERE code = ? AND active = 1", (room_code.upper(),))
    room = cur.fetchone()
    conn.close()

    if not room:
        return {"success": False, "error": "Room not found"}

    # FIX: also include live WebSocket connections so members list is always fresh
    live_emails = set(room_connections.get(room_code.upper(), {}).keys())
    db_members  = json.loads(room["members"] or "[]")

    # Merge: DB members as base, mark who's currently online
    for m in db_members:
        m["online"] = m.get("email", "") in live_emails

    return {
        "success": True,
        "room": {
            "code": room["code"],
            "host": room["host"],
            "subject": room["subject"],
            "members": db_members,
        },
    }


@app.get("/chat/{room_code}")
async def get_messages(room_code: str):
    conn = connect_db()
    cur = conn.cursor()
    cur.execute("SELECT messages FROM rooms WHERE code = ? AND active = 1", (room_code.upper(),))
    room = cur.fetchone()
    conn.close()

    return {"success": True, "messages": json.loads(room["messages"] or "[]") if room else []}


# FIX: debug/reset-db removed — it was an unauthenticated endpoint that wiped the entire DB.
# If you need to reset during development, run this directly in a Python shell:
#   from main import connect_db, init_db
#   conn = connect_db(); [conn.execute(f"DROP TABLE IF EXISTS {t}") for t in ("users","rooms","waiting_queue","match_results")]; conn.commit(); init_db()


if __name__ == "__main__":
    import uvicorn

    print("Study Buddy server: http://127.0.0.1:8000")
    uvicorn.run(socket_app, host="127.0.0.1", port=8000)
