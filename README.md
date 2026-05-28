# GrindRoom 📚

> A peaceful, collaborative study platform designed to mimic the warm environment of a library. Engage in focused study sessions with peers in real-time.

**Live Demo:** [GrindRoom Live App](https://studybuddy-production-489f.up.railway.app)

## ✨ Features

- 🕒 **Structured Study Sessions** — Built-in 45-minute focus phases to maximize productivity using the Pomodoro technique.
- 👥 **Intimate Study Rooms** — Join real-time study rooms with a maximum capacity of 3 students to maintain a focused, distraction-free environment.
- 🔄 **Real-time Sync** — Powered by WebSockets (Socket.IO) for live updates on room occupancy, timers, and active study phases.
- 📁 **Shared Resources** — Access and share study materials (PDFs, notes, study playlists) directly within your study group.
- 🎨 **Warm Library Aesthetic** — A beautifully designed, distraction-free UI featuring soothing typography (Playfair Display & Lora) and a structured layout.

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | HTML5, Vanilla CSS, Vanilla JavaScript |
| **Backend** | Node.js, Express.js |
| **Real-time Engine**| Socket.IO |
| **Fonts** | Playfair Display, Lora (Google Fonts) |

## 🚀 Getting Started (Local)

### Prerequisites
- [Node.js](https://nodejs.org/) (v14 or higher)
- npm (comes with Node.js)

### 1. Navigate to the project directory
```bash
cd GrindRoomWeb
```

### 2. Install dependencies
```bash
npm install
```

### 3. Run the development server
```bash
# Starts the server using nodemon for automatic restarts on file changes
npm run dev

# OR start the server normally
npm start
```

### 4. Open the application
Navigate to **http://localhost:3000** in your web browser.

## 📁 Project Structure

```
GrindRoomWeb/
├── package.json          ← Node.js project configuration and dependencies
├── server.js             ← Express backend and Socket.IO real-time server
└── public/               ← Frontend static assets
    ├── index.html        ← Main application dashboard
    ├── main.js           ← Frontend logic and WebSocket client
    └── style.css         ← Styling and UI design system
```

## 🔌 WebSockets / API Reference

The real-time functionality is handled entirely over Socket.IO connections.

| Event | Direction | Description |
|---|---|---|
| `connection` | Client -> Server | Establishes the WebSocket connection |
| `join_room` | Client -> Server | Request to join a specific study room ID |
| `room_update` | Server -> Client | Broadcasts current room state (users, timer, phase) |
| `room_full` | Server -> Client | Emitted when a user tries to join a room with 3 users |
| `disconnect` | Client -> Server | Automatically handles user cleanup from rooms |

## 🔮 Future Enhancements

- **User Authentication**: Implement user login to save profiles, study streaks, and personal study analytics.
- **WebRTC Voice/Video**: Allow muted, background ambient video or voice channels to simulate sitting at a table together.
- **Persistent Database**: Transition from the in-memory dummy database to MongoDB or PostgreSQL to persist room histories and shared resources.
- **Customizable Timers**: Allow room creators to set custom study intervals (e.g., 25/5 Pomodoro or 50/10).

## 📄 License

This project is licensed under the MIT License.
