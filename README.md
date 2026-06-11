# Study Buddy

Study Buddy is a collaborative study-room app built with FastAPI, Socket.IO, SQLite, and vanilla HTML/CSS/JavaScript. Students can sign in, create or join small study rooms, use video/audio, share notes and files, track focus stats, and ask AI study questions when Gemini is configured.

## Features

- Email-based account flow with verification and password reset codes
- Private and matched study rooms for up to 3 students
- Socket.IO room presence, chat, file sharing, and WebRTC signaling
- 45-minute focus timer with local and server-synced study stats
- Notes history synced per signed-in user
- Optional Gemini-powered AI chat, summaries, quizzes, and study plans
- Optional TURN server configuration for cross-network video reliability

## Tech Stack

| Layer | Technology |
| --- | --- |
| Backend | FastAPI, python-socketio |
| Database | SQLite by default, optional MySQL backend in `main_mysql.py` |
| Frontend | HTML templates, vanilla CSS, vanilla JavaScript |
| Auth | bcrypt password hashing, email verification codes |
| AI | Google GenAI SDK, configured with `GEMINI_KEY` |

## Local Setup

Use the project virtual environment at `.venv`. The duplicate `.venv-1` folder is not the canonical environment and may be missing dependencies.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Create a `.env` file for local secrets. Common variables:

```env
GEMINI_KEY=your_gemini_key
GMAIL_USER=your_email@gmail.com
GMAIL_APP_PASSWORD=your_app_password
TURN_URL=turn:your-turn-server:3478
TURN_USERNAME=your_turn_username
TURN_PASSWORD=your_turn_password
```

Email can also be configured with Brevo or Resend:

```env
BREVO_API_KEY=your_brevo_key
BREVO_SENDER=verified_sender@example.com

RESEND_API_KEY=your_resend_key
RESEND_FROM=Study Buddy <verified_sender@example.com>
```

## Run The App

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:socket_app --host 127.0.0.1 --port 8000
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

## Verification

```powershell
.\.venv\Scripts\python.exe -m py_compile main.py main_mysql.py check.py check_frontend.py
node --check static\js\app.js
.\.venv\Scripts\python.exe check.py
.\.venv\Scripts\python.exe check_frontend.py
.\.venv\Scripts\python.exe -m pip check
```

The plain `python` command on this machine may point outside the project venv and miss dependencies such as `bcrypt`. Prefer `.\.venv\Scripts\python.exe`.

## Project Structure

```text
.
|-- main.py                 # Primary FastAPI + SQLite app
|-- main_mysql.py           # Optional MySQL-backed variant
|-- requirements.txt        # Python dependencies
|-- check.py                # Backend verification script
|-- check_frontend.py       # Frontend/source verification script
|-- templates/
|   |-- home.html
|   |-- login.html
|   |-- room.html
|   `-- study.html
`-- static/
    |-- css/style.css
    `-- js/app.js
```

## API And Socket.IO Notes

HTTP routes include:

- `GET /health`
- `GET /api/ice-config`
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/verify-email`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `POST /room/create`
- `POST /room/join`
- `POST /match/join-queue`
- `POST /match/leave-queue`
- `GET /chat/{room_code}`
- `GET /room/{room_code}/info`

Socket.IO events include:

- `join_room_signal`
- `leave_room_signal`
- `room-users`
- `user-left`
- `chat_message_socket`
- `new-message`
- `webrtc_offer`
- `webrtc_answer`
- `webrtc_ice_candidate`
