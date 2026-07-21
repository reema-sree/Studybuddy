(() => {
    const SUBJECTS = [
        "Mathematics",
        "Physics",
        "Chemistry",
        "Biology",
        "Computer Science",
        "Python Programming",
        "JavaScript",
        "Machine Learning",
        "Data Science",
        "Web Development",
        "English Literature",
        "History",
        "Psychology",
        "Economics",
        "Business Studies",
        "Accounting",
        "Law",
        "Medicine",
        "Engineering",
        "Other"
    ];

    // ICE config is fetched from the server so TURN credentials stay out of client code
    // and can be changed via environment variables without redeploying the frontend.
    let _iceConfig = null;
    async function fetchIceConfig() {
        if (_iceConfig) return _iceConfig;
        try {
            const res = await fetch("/api/ice-config");
            const data = await res.json();
            _iceConfig = data; // { iceServers: [...] }
        } catch (e) {
            // Fallback if the endpoint fails
            console.warn("fetchIceConfig failed, using fallback STUN only:", e);
            _iceConfig = {
                iceServers: [
                    { urls: "stun:stun.l.google.com:19302" },
                    { urls: "stun:stun.cloudflare.com:3478" }
                ]
            };
        }
        return _iceConfig;
    }


    const MAX_FILE_SIZE_MB = 10;
    const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

    const $ = (id) => document.getElementById(id);

    const ICON_VIDEO_ON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px; vertical-align: middle;"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg> Video On`;
    const ICON_VIDEO_OFF = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px; vertical-align: middle;"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10l-2.66-2"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg> Video Off`;
    const ICON_AUDIO_ON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px; vertical-align: middle;"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg> Audio On`;
    const ICON_AUDIO_OFF = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px; vertical-align: middle;"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 11a7 7 0 0 1-14 0v-2h2v2a5 5 0 0 0 10 0V9"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg> Audio Off`;

    function getUser() {
        try {
            return JSON.parse(localStorage.getItem("studybuddy_user") || "null");
        } catch {
            return null;
        }
    }

    function saveUser(user) {
        localStorage.setItem("studybuddy_user", JSON.stringify(user));
    }

    function clearUser() {
        localStorage.removeItem("studybuddy_user");
    }

    function guestEmail(name) {
        const safe = (name || "guest").toLowerCase().replace(/[^a-z0-9]/g, "") || "guest";
        return `${safe}-${Date.now()}@guest.local`;
    }

    function makeUser(name, email, verified, auth_token = "") {
        return {
            id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name,
            email: email || guestEmail(name),
            verified: !!verified,
            auth_token: auth_token || ""
        };
    }

    // --- Server auth helpers ---

    async function registerUser(name, email, password) {
        const data = await postJson("/auth/register", { name, email, password });
        if (!data.success) throw new Error(data.error || "Registration failed.");
        return data;
    }

    async function loginUser(email, password) {
        const data = await postJson("/auth/login", { email, password });
        if (!data.success) throw new Error(data.error || "Login failed.");
        return data;
    }

    async function syncStatsToServer(user, stats) {
        if (!user?.auth_token) return;
        try {
            await postJson("/auth/save-stats", {
                email: user.email,
                auth_token: user.auth_token,
                stats
            });
        } catch (e) { console.warn("syncStatsToServer failed (localStorage is fallback):", e); }
    }

    async function syncNotesToServer(user, notes) {
        if (!user?.auth_token) return;
        try {
            await postJson("/auth/save-notes", {
                email: user.email,
                auth_token: user.auth_token,
                notes
            });
        } catch (e) { console.warn("syncNotesToServer failed:", e); }
    }

    async function verifyEmailCode(email, code) {
        const data = await postJson("/auth/verify-email", { email, code });
        if (!data.success) throw new Error(data.error || "Verification failed.");
        return data;
    }

    async function forgotPassword(email) {
        const data = await postJson("/auth/forgot-password", { email });
        if (!data.success) throw new Error(data.error || "Could not send reset code.");
        return data;
    }

    async function resetPassword(email, code, new_password) {
        const data = await postJson("/auth/reset-password", { email, code, new_password });
        if (!data.success) throw new Error(data.error || "Reset failed.");
        return data;
    }

    async function restoreFromServer(user) {
        if (!user?.auth_token) return;
        try {
            const res = await fetch(
                `/auth/profile?email=${encodeURIComponent(user.email)}&auth_token=${encodeURIComponent(user.auth_token)}`
            );
            const data = await res.json();
            if (!data.success) return;

            // Merge server stats with localStorage — take the higher value for each number field
            const localStats = readStatsForUser(user);
            const serverStats = cleanStats(data.stats || {});
            const merged = mergeStats(localStats, serverStats);
            localStorage.setItem(statsKeyForEmail(user.email), JSON.stringify(merged));

            // Merge notes — combine and deduplicate by createdAt
            const localNotes = readNotesForUser(user);
            const serverNotes = Array.isArray(data.notes) ? data.notes : [];
            const mergedNotes = dedupeNotes([...localNotes, ...serverNotes]).slice(0, 50);
            localStorage.setItem(notesKeyForEmail(user.email), JSON.stringify(mergedNotes));
        } catch { /* silent */ }
    }

    function fillSubjectSelects() {
        document.querySelectorAll("[data-subject-select]").forEach((select) => {
            select.innerHTML = '<option value="">Select subject...</option>' +
                SUBJECTS.map((subject) => `<option value="${subject}">${subject}</option>`).join("");
        });
    }

    async function postJson(url, body) {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body || {})
        });
        return res.json();
    }

    function buildStudyUrl(roomCode, user) {
        const params = new URLSearchParams({
            room: roomCode,
            name: user.name,
            email: user.email,
            subject: user.subject || "Private Study"
        });
        return `/study?${params.toString()}`;
    }

    async function verifyEmail(email) {
        if (!email) return false;

        try {
            const data = await postJson("/verify-student", { email });
            return !!data.verified;
        } catch {
            return false;
        }
    }

    function statsKeyForEmail(email) {
        return `studybuddy_stats_${String(email || "").toLowerCase()}`;
    }

    function notesKeyForEmail(email) {
        return `studybuddy_notes_${String(email || "").toLowerCase()}`;
    }

    function cleanStats(raw) {
        const studyDates = Array.isArray(raw?.studyDates)
            ? raw.studyDates.filter(Boolean)
            : [];

        return {
            focusSeconds: Number(raw?.focusSeconds) || 0,
            completedSeconds: Number(raw?.completedSeconds) || 0,
            completedSessions: Number(raw?.completedSessions) || 0,
            notesShared: Number(raw?.notesShared) || 0,
            earlyLeaves: Number(raw?.earlyLeaves) || 0,
            studyDates: [...new Set(studyDates)].sort(),
            xp: Number(raw?.xp) || 0,
            level: Number(raw?.level) || 1
        };
    }

    function mergeStats(localStats, serverStats) {
        const local = cleanStats(localStats || {});
        const server = cleanStats(serverStats || {});
        const useServerProgress =
            server.level > local.level ||
            (server.level === local.level && server.xp > local.xp);

        return {
            focusSeconds:      Math.max(local.focusSeconds, server.focusSeconds),
            completedSeconds:  Math.max(local.completedSeconds, server.completedSeconds),
            completedSessions: Math.max(local.completedSessions, server.completedSessions),
            notesShared:       Math.max(local.notesShared, server.notesShared),
            earlyLeaves:       Math.max(local.earlyLeaves || 0, server.earlyLeaves || 0),
            studyDates:        [...new Set([...local.studyDates, ...server.studyDates])].sort(),
            xp:                useServerProgress ? server.xp : local.xp,
            level:             useServerProgress ? server.level : local.level
        };
    }

    function readStatsForUser(user) {
        if (!user?.email) return cleanStats({});

        try {
            return cleanStats(JSON.parse(localStorage.getItem(statsKeyForEmail(user.email)) || "{}"));
        } catch {
            return cleanStats({});
        }
    }

    function statHours(seconds) {
        const hours = Math.max(0, seconds) / 3600;
        return hours >= 10 ? hours.toFixed(1) : hours.toFixed(2);
    }

    function statDateStamp(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function statStreak(stats) {
        const dates = new Set(stats.studyDates);
        const cursor = new Date();
        let streak = 0;

        while (dates.has(statDateStamp(cursor))) {
            streak += 1;
            cursor.setDate(cursor.getDate() - 1);
        }

        return streak;
    }

    function statPoints(stats) {
        const focusPoints      = Math.floor(stats.focusSeconds / 60) * 2;
        const completionPoints = stats.completedSessions * 4;
        // FIX: early leaves are a penalty, not a reward — deduct 3 pts each
        const earlyLeavePenalty = (stats.earlyLeaves || 0) * 3;
        const dayPoints        = stats.studyDates.length * 25;
        const notePoints       = stats.notesShared * 10;
        return Math.max(0, focusPoints + completionPoints - earlyLeavePenalty + dayPoints + notePoints);
    }

    function setStatsText(name, value) {
        document.querySelectorAll(`[data-stat="${name}"]`).forEach((element) => {
            element.textContent = value;
        });
    }

    function levelTitle(lvl) {
        if (lvl >= 10) return "Ultimate Academic Weapon 👑";
        if (lvl >= 7)  return "Certified Cooker 👨‍🍳";
        if (lvl >= 5)  return "Aura Beast 🦁";
        if (lvl >= 3)  return "Locked In Pro 🔒";
        return "Grind Novice 🌱";
    }

    function renderHomeDashboard(user) {
        const dashboard = $("home-dashboard");
        if (!dashboard) return;

        // FIX: only show the dashboard when a user is actually signed in
        if (!user) {
            dashboard.classList.add("hidden");
            return;
        }

        const stats  = readStatsForUser(user);
        const streak = statStreak(stats);

        dashboard.classList.remove("hidden");
        setStatsText("focusHours",    statHours(stats.focusSeconds));
        setStatsText("completedHours", statHours(stats.completedSeconds));
        setStatsText("studyDays",     String(stats.studyDates.length));
        setStatsText("loyaltyPoints", String(statPoints(stats)));
        setStatsText("streakLabel",   `${streak} day${streak === 1 ? "" : "s"} streak`);

        // Gamified Level & XP rendering
        const lvl = stats.level || 1;
        const xp = stats.xp || 0;
        const targetXp = lvl * 100;
        const pct = Math.min(100, Math.floor((xp / targetXp) * 100));

        const badge = $("lvl-badge-val");
        const name = $("lvl-name-val");
        const xpText = $("xp-text-val");
        const xpBar = $("xp-bar-val");

        if (badge) badge.textContent = `Lvl ${lvl}`;
        if (name) name.textContent = levelTitle(lvl);
        if (xpText) xpText.textContent = `${xp} / ${targetXp} XP`;
        if (xpBar) xpBar.style.width = `${pct}%`;
    }

    function readNotesForUser(user) {
        if (!user?.email) return [];

        try {
            const notes = JSON.parse(localStorage.getItem(notesKeyForEmail(user.email)) || "[]");
            return Array.isArray(notes) ? notes : [];
        } catch {
            return [];
        }
    }

    function noteKey(note) {
        const title = String(note?.title || "").trim().toLowerCase();
        const content = String(note?.content || "").trim();
        return note?.createdAt ? `${note.createdAt}|${title}` : `${title}|${content}`;
    }

    function dedupeNotes(notes) {
        const seen = new Set();
        return (Array.isArray(notes) ? notes : []).filter((note) => {
            const key = noteKey(note);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function saveNoteForUser(user, note) {
        if (!user?.email) return;

        const normalizedNote = {
            ...note,
            createdAt: note?.createdAt || new Date().toISOString()
        };
        const notes = readNotesForUser(user);
        const trimmed = dedupeNotes([normalizedNote, ...notes]).slice(0, 50);
        localStorage.setItem(notesKeyForEmail(user.email), JSON.stringify(trimmed));

        // Sync to server so notes persist across devices
        if (user?.auth_token) syncNotesToServer(user, trimmed);
    }

    function renderNotesHistory(user) {
        const list = $("notes-history-list");
        const count = $("notes-history-count");
        if (!list || !count) return;

        const notes = readNotesForUser(user);
        count.textContent = `${notes.length} note${notes.length === 1 ? "" : "s"}`;
        list.innerHTML = "";

        if (!notes.length) {
            const empty = document.createElement("div");
            empty.className = "notes-empty";
            empty.textContent = "No notes yet. Share notes from a study room and they will appear here.";
            list.appendChild(empty);
            return;
        }

        notes.slice(0, 6).forEach((note) => {
            const card = document.createElement("article");
            card.className = "note-history-card";

            const title = document.createElement("strong");
            title.textContent = note.title || "Study note";

            const preview = document.createElement("p");
            preview.textContent = note.content || "";

            const meta = document.createElement("div");
            meta.className = "note-history-meta";
            const date = note.createdAt ? new Date(note.createdAt) : new Date();
            const sharedByText = note.sharedBy ? ` · by ${note.sharedBy}` : "";
            meta.textContent = `${date.toLocaleDateString()} · Room ${note.roomCode || "------"}${sharedByText}`;

            card.appendChild(title);
            card.appendChild(preview);
            card.appendChild(meta);
            list.appendChild(card);
        });
    }

    function initHome() {
        fillSubjectSelects();

        let currentUser = getUser();
        let isMatching = false;
        let matchingInterval = null;

        function updateUserUi() {
            const signedIn = !!currentUser;

            $("signin-btn").classList.toggle("hidden", signedIn);
            $("user-profile").classList.toggle("hidden", !signedIn);
            renderHomeDashboard(currentUser);
            renderNotesHistory(currentUser);

            if (!signedIn) return;

            $("username-display").textContent = currentUser.name;
            $("user-avatar").textContent = currentUser.name.charAt(0).toUpperCase();
            $("verified-badge").classList.toggle("hidden", !currentUser.verified);
        }

        function showAuth(mode = "login") {
            authEmail = "";
            $("auth-modal").classList.remove("hidden");
            $("auth-modal").classList.add("active");
            switchAuthMode(mode);
            setTimeout(() => {
                if (mode === "register") $("auth-name")?.focus();
                else $("auth-email")?.focus();
            }, 50);
        }

        function closeAuth() {
            $("auth-modal").classList.remove("active");
            $("auth-modal").classList.add("hidden");
        }

        let authMode   = "login";   // "login" | "register" | "verify" | "forgot" | "reset"
        let authEmail  = "";         // carries email across steps
        const AUTH_STEPS = {
            login:    { title: "Sign In",          copy: "Welcome back.",                              btn: "Sign In" },
            register: { title: "Create Account",   copy: "Join Study Buddy — it's free.",              btn: "Create Account" },
            verify:   { title: "Verify Email",     copy: "Enter the 6-digit code sent to your inbox.", btn: "Verify" },
            forgot:   { title: "Forgot Password",  copy: "Enter your email to receive a reset code.",  btn: "Send Reset Code" },
            reset:    { title: "Reset Password",   copy: "Enter the code from your email and your new password.", btn: "Reset Password" },
        };

        function switchAuthMode(mode) {
            authMode = mode;
            const step = AUTH_STEPS[mode];
            $("auth-mode-title").textContent = step.copy;
            $("auth-submit").textContent     = step.btn;
            $("auth-submit").disabled        = false;
            $("auth-error").textContent      = "";

            // show/hide fields per step
            const show = (id, visible) => $(id) && $(id).classList.toggle("hidden", !visible);
            show("auth-name",         mode === "register");
            show("auth-email",        mode === "login" || mode === "register" || mode === "forgot");
            show("auth-password",     mode === "login" || mode === "register" || mode === "reset");
            show("auth-code-wrap",    mode === "verify" || mode === "reset");
            show("auth-newpass-wrap", mode === "reset");

            const switchLink = $("auth-switch-link");
            if (switchLink) switchLink.textContent = mode === "login"
                ? "No account? Register"
                : "Already have an account? Sign in";

            const forgotLink = $("auth-forgot-link");
            if (forgotLink) forgotLink.classList.toggle("hidden", mode !== "login");

            $("auth-modal-title").textContent = step.title;
        }

        async function authenticate() {
            const name     = ($("auth-name")    ?.value || "").trim();
            const email    = ($("auth-email")   ?.value || "").trim().toLowerCase() || authEmail;
            const password = ($("auth-password")?.value || "");
            const code     = ($("auth-code")    ?.value || "").trim();
            const newpass  = ($("auth-newpass") ?.value || "");

            $("auth-submit").disabled    = true;
            $("auth-submit").textContent = "Please wait...";
            $("auth-error").textContent  = "";

            try {
                if (authMode === "login") {
                    if (!email || !password) throw new Error("Please enter your email and password.");
                    const result = await loginUser(email, password);
                    if (result.needs_verification) {
                        authEmail = email;
                        switchAuthMode("verify");
                        return;
                    }
                    await _finishAuth(result);

                } else if (authMode === "register") {
                    if (!name)     throw new Error("Please enter your name.");
                    if (!email)    throw new Error("Please enter your email.");
                    if (!password) throw new Error("Please enter a password.");
                    const result = await registerUser(name, email, password);
                    if (result.needs_verification === false && result.user) {
                        // Email verification disabled — log straight in
                        await _finishAuth(result);
                    } else {
                        authEmail = email;
                        switchAuthMode("verify");
                    }

                } else if (authMode === "verify") {
                    if (!code) throw new Error("Please enter the 6-digit code.");
                    const result = await verifyEmailCode(authEmail, code);
                    await _finishAuth(result);

                } else if (authMode === "forgot") {
                    if (!email) throw new Error("Please enter your email address.");
                    authEmail = email;
                    await forgotPassword(email);
                    switchAuthMode("reset");

                } else if (authMode === "reset") {
                    if (!code)   throw new Error("Please enter the reset code.");
                    if (!newpass) throw new Error("Please enter a new password.");
                    const result = await resetPassword(authEmail, code, newpass);
                    await _finishAuth(result);
                }
            } catch (err) {
                $("auth-error").textContent = err.message || "Something went wrong.";
                $("auth-submit").disabled   = false;
                $("auth-submit").textContent = AUTH_STEPS[authMode].btn;
            }
        }

        async function _finishAuth(result) {
            currentUser = makeUser(result.user.name, result.user.email, result.user.verified, result.user.auth_token);
            saveUser(currentUser);
            if (result.stats) {
                const local  = readStatsForUser(currentUser);
                const server = cleanStats(result.stats);
                const merged = mergeStats(local, server);
                localStorage.setItem(statsKeyForEmail(currentUser.email), JSON.stringify(merged));
            }
            if (Array.isArray(result.notes) && result.notes.length) {
                const local = readNotesForUser(currentUser);
                const merged = dedupeNotes([...local, ...result.notes]).slice(0, 50);
                localStorage.setItem(notesKeyForEmail(currentUser.email), JSON.stringify(merged));
            }
            updateUserUi();
            closeAuth();
        }


        function stopMatchingUi() {
            isMatching = false;
            if (matchingInterval) clearInterval(matchingInterval);
            matchingInterval = null;
            $("match-btn").classList.remove("hidden");
            $("matching-status").classList.add("hidden");
        }

        async function startMatching() {
            if (!currentUser) {
                showAuth();
                return;
            }

            const subject = $("match-subject").value || currentUser.subject;
            if (!subject) {
                alert("Please select a subject.");
                return;
            }

            isMatching = true;
            $("match-btn").classList.add("hidden");
            $("matching-status").classList.remove("hidden");
            $("matching-message").textContent = `Looking for ${subject} partners...`;

            const tryMatch = async () => {
                if (!isMatching) return;

                try {
                    const data = await postJson("/match/join-queue", {
                        user_name: currentUser.name,
                        user_email: currentUser.email,
                        subject
                    });

                    if (!data.success) {
                        $("matching-message").textContent = data.error || "Could not join queue.";
                        return;
                    }

                    if (data.matched) {
                        stopMatchingUi();

                        // FIX: notify user if matched into a different subject room
                        if (data.cross_subject) {
                            const partnerSubject = data.partner_subject || "a different subject";
                            const go = confirm(
                                `No ${subject} partners found right now.\n\n` +
                                `We found a partner studying "${partnerSubject}" instead.\n\n` +
                                `Join their study room?`
                            );
                            if (!go) {
                                await postJson("/match/leave-queue", { user_email: currentUser.email });
                                return;
                            }
                        }

                        window.location.href = buildStudyUrl(data.room_code, {
                            ...currentUser,
                            subject: data.subject || subject
                        });
                        return;
                    }

                    $("matching-message").textContent = data.message || "Still searching...";
                    updateQueueCount();
                } catch {
                    $("matching-message").textContent = "Connection issue. Retrying...";
                }
            };

            await tryMatch();
            matchingInterval = setInterval(tryMatch, 4000);
        }

        async function cancelMatching() {
            if (currentUser) {
                try {
                    await postJson("/match/leave-queue", { user_email: currentUser.email });
                } catch {
                    // Ignore cancellation errors.
                }
            }

            stopMatchingUi();
            updateQueueCount();
        }

        async function createRoom() {
            if (!currentUser) {
                showAuth();
                return;
            }

            const data = await postJson("/room/create", {
                user_name: currentUser.name,
                user_email: currentUser.email,
                subject: "Private Study"
            });

            if (data.success) {
                window.location.href = buildStudyUrl(data.room_code, {
                    ...currentUser,
                    subject: "Private Study"
                });
            } else {
                alert(data.error || "Could not create room.");
            }
        }

        async function joinRoom() {
            if (!currentUser) {
                showAuth();
                return;
            }

            const code = $("join-code-input").value.trim().toUpperCase();
            if (!code) {
                alert("Please enter a room code.");
                return;
            }

            const data = await postJson("/room/join", {
                room_code: code,
                user_name: currentUser.name,
                user_email: currentUser.email,
                subject: "Private Study"
            });

            if (data.success) {
                window.location.href = buildStudyUrl(code, {
                    ...currentUser,
                    subject: "Private Study"
                });
            } else {
                alert(data.error || "Could not join room.");
            }
        }

        async function updateQueueCount() {
            try {
                const res = await fetch("/match/queue-count");
                const data = await res.json();
                $("queue-count").textContent = data.count || 0;
            } catch {
                $("queue-count").textContent = "0";
            }
        }

        $("signin-btn").addEventListener("click", () => showAuth("login"));
        $("auth-cancel").addEventListener("click", closeAuth);
        $("auth-submit").addEventListener("click", authenticate);
        $("auth-switch-link").addEventListener("click", (e) => {
            e.preventDefault();
            switchAuthMode(authMode === "login" ? "register" : "login");
        });
        $("auth-forgot-link").addEventListener("click", (e) => {
            e.preventDefault();
            switchAuthMode("forgot");
        });
        $("auth-modal").addEventListener("click", (event) => {
            if (event.target.id === "auth-modal") closeAuth();
        });
        ["auth-name", "auth-email", "auth-password", "auth-code", "auth-newpass"].forEach((id) => {
            $(id) && $(id).addEventListener("keydown", (event) => {
                if (event.key === "Enter") authenticate();
            });
        });
        $("signout-btn").addEventListener("click", () => {
            if (isMatching) cancelMatching();
            currentUser = null;
            clearUser();
            updateUserUi();
        });

        $("match-btn").addEventListener("click", startMatching);
        $("cancel-match-btn").addEventListener("click", cancelMatching);
        $("create-room-btn").addEventListener("click", createRoom);
        $("join-room-btn").addEventListener("click", joinRoom);

        $("join-code-input").addEventListener("input", (event) => {
            event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
        });

        updateUserUi();
        updateQueueCount();
        setInterval(() => {
            const user = getUser();
            renderHomeDashboard(user);
            renderNotesHistory(user);
        }, 10000);
        setInterval(updateQueueCount, 10000);
    }

    function initLogin() {
        let loginMode  = "login";
        let loginEmail = "";
        const STEPS = {
            login:    { title: "Sign In",         copy: "Welcome back.",                              btn: "Sign In" },
            register: { title: "Create Account",  copy: "Join Study Buddy — it's free.",             btn: "Create Account" },
            verify:   { title: "Verify Email",    copy: "Enter the 6-digit code sent to your inbox.", btn: "Verify" },
            forgot:   { title: "Forgot Password", copy: "Enter your email for a reset code.",         btn: "Send Reset Code" },
            reset:    { title: "Reset Password",  copy: "Enter the code and your new password.",      btn: "Reset Password" },
        };

        function switchLoginMode(mode) {
            loginMode = mode;
            const step = STEPS[mode];
            $("login-title").textContent = step.title;
            $("login-copy") && ($("login-copy").textContent = step.copy);
            $("login-submit").textContent = step.btn;
            $("login-submit").disabled    = false;
            $("login-error").textContent  = "";

            const show = (id, v) => $(id) && $(id).classList.toggle("hidden", !v);
            show("login-name-wrap",    mode === "register");
            show("login-email",        mode === "login" || mode === "register" || mode === "forgot");
            show("login-password",     mode === "login" || mode === "register" || mode === "reset");
            show("login-code-wrap",    mode === "verify" || mode === "reset");
            show("login-newpass-wrap", mode === "reset");

            const sw = $("login-switch-link");
            if (sw) sw.textContent = mode === "login" ? "No account yet? Register" : "Back to sign in";
            const fg = $("login-forgot-link");
            if (fg) fg.classList.toggle("hidden", mode !== "login");
        }

        async function submitLogin() {
            const name    = ($("login-name")   ?.value || "").trim();
            const email   = ($("login-email")  ?.value || "").trim().toLowerCase() || loginEmail;
            const pass    = ($("login-password")?.value || "");
            const code    = ($("login-code")   ?.value || "").trim();
            const newpass = ($("login-newpass") ?.value || "");

            $("login-submit").disabled    = true;
            $("login-submit").textContent = "Please wait...";
            $("login-error").textContent  = "";

            try {
                let result;
                if (loginMode === "login") {
                    if (!email || !pass) throw new Error("Please enter your email and password.");
                    result = await loginUser(email, pass);
                    if (result.needs_verification) { loginEmail = email; switchLoginMode("verify"); return; }

                } else if (loginMode === "register") {
                    if (!name)  throw new Error("Please enter your name.");
                    if (!email) throw new Error("Please enter your email.");
                    if (!pass)  throw new Error("Please enter a password.");
                    const regResult = await registerUser(name, email, pass);
                    if (regResult.needs_verification === false && regResult.user) {
                        result = regResult;
                    } else {
                        loginEmail = email;
                        switchLoginMode("verify");
                        return;
                    }

                } else if (loginMode === "verify") {
                    if (!code) throw new Error("Please enter the 6-digit code.");
                    result = await verifyEmailCode(loginEmail, code);

                } else if (loginMode === "forgot") {
                    if (!email) throw new Error("Please enter your email address.");
                    loginEmail = email;
                    await forgotPassword(email);
                    switchLoginMode("reset");
                    return;

                } else if (loginMode === "reset") {
                    if (!code)   throw new Error("Please enter the reset code.");
                    if (!newpass) throw new Error("Please enter a new password.");
                    result = await resetPassword(loginEmail, code, newpass);
                }

                // Success — save user and restore from server
                const user = makeUser(result.user.name, result.user.email, result.user.verified, result.user.auth_token);
                saveUser(user);
                await restoreFromServer(user);

                const params = new URLSearchParams(window.location.search);
                window.location.href = params.get("next") || "/";

            } catch (err) {
                $("login-error").textContent  = err.message || "Something went wrong.";
                $("login-submit").disabled    = false;
                $("login-submit").textContent = STEPS[loginMode].btn;
            }
        }

        $("login-submit").addEventListener("click", submitLogin);
        $("login-switch-link")?.addEventListener("click", (e) => {
            e.preventDefault();
            switchLoginMode(loginMode === "login" ? "register" : "login");
        });
        $("login-forgot-link")?.addEventListener("click", (e) => {
            e.preventDefault();
            switchLoginMode("forgot");
        });
        ["login-email", "login-password", "login-code", "login-newpass"].forEach((id) => {
            $(id)?.addEventListener("keydown", (e) => { if (e.key === "Enter") submitLogin(); });
        });
    }


    function initRoomRedirect() {
        // Handles /room/{code} URLs — reads room code from path,
        // gets saved user and redirects to the study page with all params.
        const user = getUser();
        const parts = window.location.pathname.split("/").filter(Boolean);
        const roomCode = (parts[parts.length - 1] || "").toUpperCase();

        if (!roomCode) {
            window.location.replace("/");
            return;
        }

        if (!user || !user.name || !user.email) {
            window.location.replace(`/login?next=${encodeURIComponent(window.location.href)}`);
            return;
        }

        window.location.replace(buildStudyUrl(roomCode, {
            ...user,
            subject: user.subject || "Private Study"
        }));
    }

    function initStudy() {
        const params = new URLSearchParams(window.location.search);
        const savedUser = getUser() || {};

        const roomCode = (params.get("room") || "").toUpperCase();
        const userName = params.get("name") || savedUser.name;
        const userEmail = params.get("email") || savedUser.email;
        const userSubject = params.get("subject") || savedUser.subject || "Other";

        if (!roomCode) {
            window.location.replace("/");
            return;
        }

        if (!userName || !userEmail) {
            window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
            return;
        }

        let socket = null;
        let localStream = null;
        let videoEnabled = true;
        let audioEnabled = true;
        let timerInterval = null;
        const STUDY_SESSION_SECONDS = 45 * 60;
        let timeLeft = STUDY_SESSION_SECONDS;
        let timerRunning = false;
        const statsStorageKey = statsKeyForEmail(userEmail);
        let studyStats = loadStudyStats();

        const peerConnections = {};
        const pendingCandidates = {};
        const peerNames = {};
        const remoteStreams = {}; // track remote streams per peer email to prevent overwriting
        const makingOfferMap = {}; // prevent glare (simultaneous WebRTC offers)

        $("room-code-display").textContent = roomCode;

        function loadStudyStats() {
            try {
                return cleanStats(JSON.parse(localStorage.getItem(statsStorageKey) || "{}"));
            } catch {
                return cleanStats({});
            }
        }

        function saveStudyStats() {
            localStorage.setItem(statsStorageKey, JSON.stringify(studyStats));
            // Sync to server so stats persist across devices
            const user = getUser();
            if (user?.auth_token) syncStatsToServer(user, studyStats);
        }

        function markStudyDay() {
            const today = statDateStamp();

            if (!studyStats.studyDates.includes(today)) {
                studyStats.studyDates.push(today);
                studyStats.studyDates.sort();
            }
        }

        function recordFocusedSecond() {
            studyStats.focusSeconds += 1;
            if (studyStats.focusSeconds % 6 === 0) {
                addXp(1);
            }
            markStudyDay();
            saveStudyStats();
        }

        function completeStudySession() {
            studyStats.completedSessions += 1;
            studyStats.completedSeconds += STUDY_SESSION_SECONDS;
            addXp(100, true);
            markStudyDay();
            saveStudyStats();
        }

        // --- Soundboard Audio Setup ---
        const audioStreams = {
            lofi: new Audio("https://stream.zeno.fm/0r0xa792kwzuv"),
            rain: new Audio("https://actions.google.com/sounds/v1/weather/rain_heavy_loud.ogg"),
            cafe: new Audio("https://actions.google.com/sounds/v1/crowds/restaurant_ambience.ogg"),
            forest: new Audio("https://actions.google.com/sounds/v1/nature/forest_ambience.ogg")
        };

        Object.values(audioStreams).forEach(audio => {
            audio.loop = true;
            // NOTE: do NOT set crossOrigin on Audio objects — it triggers a CORS
            // preflight that the Google Action Sound servers don't support, blocking playback.
        });

        let audioCtx = null;
        function getAudioContext() {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioCtx.state === "suspended") {
                audioCtx.resume();
            }
            return audioCtx;
        }

        let noiseSource = null;
        let noiseGain = null;

        function playNoise() {
            const ctx = getAudioContext();
            const bufferSize = 2 * ctx.sampleRate;
            const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const output = noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                output[i] = Math.random() * 2 - 1;
            }

            noiseSource = ctx.createBufferSource();
            noiseSource.buffer = noiseBuffer;
            noiseSource.loop = true;

            noiseGain = ctx.createGain();
            const slider = $("volume-noise");
            noiseGain.gain.value = slider ? parseFloat(slider.value) : 0.5;

            noiseSource.connect(noiseGain);
            noiseGain.connect(ctx.destination);
            noiseSource.start();
        }

        function stopNoise() {
            if (noiseSource) {
                try { noiseSource.stop(); } catch(e){}
                noiseSource = null;
            }
        }

        function handleSoundToggle(key, startFn, stopFn, audioObj) {
            const toggle = $(`play-${key}`);
            const slider = $(`volume-${key}`);
            if (!toggle) return;

            toggle.addEventListener("change", () => {
                if (toggle.checked) {
                    if (audioObj) {
                        audioObj.volume = slider ? parseFloat(slider.value) : 0.5;
                        audioObj.play().catch(err => {
                            console.warn("Audio play failed:", err);
                            toggle.checked = false;
                        });
                    } else if (startFn) {
                        try {
                            startFn();
                        } catch(err) {
                            console.warn("Noise start failed:", err);
                            toggle.checked = false;
                        }
                    }
                } else {
                    if (audioObj) {
                        audioObj.pause();
                    } else if (stopFn) {
                        stopFn();
                    }
                }
            });

            if (slider) {
                slider.addEventListener("input", () => {
                    const vol = parseFloat(slider.value);
                    if (audioObj) {
                        audioObj.volume = vol;
                    } else if (key === "noise" && noiseGain) {
                        noiseGain.gain.value = vol;
                    }
                });
            }
        }

        // --- Virtual Pet Logic ---
        const buddyAvatar = $("buddy-avatar-wrap");
        const buddyBubble = $("buddy-bubble-text");

        const buddyStates = {
            sleeping: `<svg width="40" height="40" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="50" cy="55" r="30" fill="#a78bfa" />
                <polygon points="25,35 35,50 20,50" fill="#8b5cf6" />
                <polygon points="75,35 65,50 80,50" fill="#8b5cf6" />
                <path d="M38 58 Q43 62 48 58" stroke="#1e1b4b" stroke-width="3" stroke-linecap="round" fill="none" />
                <path d="M52 58 Q57 62 62 58" stroke="#1e1b4b" stroke-width="3" stroke-linecap="round" fill="none" />
                <path d="M48 65 L52 65 L50 67 Z" fill="#1e1b4b" />
                <text x="75" y="30" font-family="monospace" font-size="16" fill="#8b5cf6" font-weight="bold" class="zzz">z</text>
                <text x="65" y="20" font-family="monospace" font-size="12" fill="#c084fc" font-weight="bold" class="zzz-delayed">z</text>
                <style>
                    .zzz { animation: floatZzz 2s infinite ease-in-out; }
                    .zzz-delayed { animation: floatZzz 2s infinite ease-in-out; animation-delay: 0.7s; }
                    @keyframes floatZzz {
                        0% { transform: translate(0, 0) scale(0.8); opacity: 0; }
                        50% { opacity: 1; }
                        100% { transform: translate(10px, -20px) scale(1.2); opacity: 0; }
                    }
                </style>
            </svg>`,
            studying: `<svg width="40" height="40" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="50" cy="55" r="30" fill="#a78bfa" />
                <polygon points="25,35 35,50 20,50" fill="#8b5cf6" />
                <polygon points="75,35 65,50 80,50" fill="#8b5cf6" />
                <circle cx="40" cy="55" r="8" stroke="#f59e0b" stroke-width="3" fill="none" />
                <circle cx="60" cy="55" r="8" stroke="#f59e0b" stroke-width="3" fill="none" />
                <line x1="48" y1="55" x2="52" y2="55" stroke="#f59e0b" stroke-width="3" />
                <circle cx="40" cy="55" r="2" fill="#1e1b4b" />
                <circle cx="60" cy="55" r="2" fill="#1e1b4b" />
                <path d="M47 67 Q50 70 53 67" stroke="#1e1b4b" stroke-width="2" stroke-linecap="round" fill="none" />
                <rect x="35" y="70" width="30" height="18" rx="2" fill="#ffffff" stroke="#1e1b4b" stroke-width="2" />
                <line x1="50" y1="70" x2="50" y2="88" stroke="#1e1b4b" stroke-width="2" />
                <circle cx="38" cy="74" r="4" fill="#c084fc" class="paw-left" />
                <circle cx="62" cy="74" r="4" fill="#c084fc" class="paw-right" />
                <style>
                    .paw-left { animation: typePaw 0.4s infinite alternate ease-in-out; }
                    .paw-right { animation: typePaw 0.4s infinite alternate ease-in-out; animation-delay: 0.2s; }
                    @keyframes typePaw {
                        0% { transform: translateY(0); }
                        100% { transform: translateY(-3px); }
                    }
                </style>
            </svg>`,
            cheering: `<svg width="40" height="40" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="50" cy="55" r="30" fill="#a78bfa" />
                <polygon points="25,32 35,47 20,47" fill="#8b5cf6" />
                <polygon points="75,32 65,47 80,47" fill="#8b5cf6" />
                <path d="M36 56 Q40 50 44 56" stroke="#1e1b4b" stroke-width="3" stroke-linecap="round" fill="none" />
                <path d="M56 56 Q60 50 64 56" stroke="#1e1b4b" stroke-width="3" stroke-linecap="round" fill="none" />
                <path d="M46 64 Q50 72 54 64 Z" fill="#b91c1c" stroke="#1e1b4b" stroke-width="2" />
                <circle cx="25" cy="48" r="5" fill="#c084fc" class="paw-cheer" />
                <circle cx="75" cy="48" r="5" fill="#c084fc" class="paw-cheer" />
                <polygon points="50,10 52,15 57,17 52,19 50,24 48,19 43,17 48,15" fill="#fbbf24" class="sparkle" />
                <style>
                    .paw-cheer { animation: cheerPaws 0.5s infinite alternate cubic-bezier(0.25, 1, 0.5, 1); }
                    .sparkle { animation: spinSparkle 1.5s infinite linear; transform-origin: 50px 17px; }
                    @keyframes cheerPaws {
                        from { transform: translateY(0); }
                        to { transform: translateY(-6px); }
                    }
                    @keyframes spinSparkle {
                        from { transform: rotate(0deg) scale(0.8); }
                        50% { transform: rotate(185deg) scale(1.2); }
                        to { transform: rotate(360deg) scale(0.8); }
                    }
                </style>
            </svg>`
        };

        let currentBuddyState = "sleeping";
        function setBuddyState(state, text) {
            if (!buddyAvatar || !buddyStates[state]) return;
            currentBuddyState = state;
            buddyAvatar.innerHTML = buddyStates[state];
            if (buddyBubble && text) {
                buddyBubble.textContent = text;
            }
        }

        let buddyRestoreTimeout = null;
        function setBuddyTemporarily(tempState, text, durationMs = 3000) {
            const prevState = currentBuddyState;
            setBuddyState(tempState, text);
            if (buddyRestoreTimeout) clearTimeout(buddyRestoreTimeout);
            buddyRestoreTimeout = setTimeout(() => {
                const autoText = prevState === "studying" ? "Back to focus! You're doing great! ⚡" : "Zzz... tap start when you're ready! 😴";
                setBuddyState(prevState, autoText);
            }, durationMs);
        }

        // --- Level & XP Gamification ---
        function showNotification(title, message, type = "info") {
            let container = $("notification-container");
            if (!container) {
                container = document.createElement("div");
                container.id = "notification-container";
                container.style.cssText = `
                    position: fixed;
                    bottom: 20px;
                    left: 20px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    z-index: 10000;
                `;
                document.body.appendChild(container);
            }
            
            const card = document.createElement("div");
            card.style.cssText = `
                background: var(--surface);
                border: 1px solid var(--accent);
                border-radius: var(--radius);
                padding: 12px 18px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.15);
                display: flex;
                flex-direction: column;
                gap: 4px;
                min-width: 240px;
                animation: slideInNotification 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                color: var(--text);
                backdrop-filter: blur(10px);
            `;
            
            const titleEl = document.createElement("strong");
            titleEl.textContent = title;
            titleEl.style.fontSize = "13px";
            titleEl.style.color = "var(--accent)";
            
            const descEl = document.createElement("span");
            descEl.textContent = message;
            descEl.style.fontSize = "12px";
            descEl.style.color = "var(--text-muted)";
            
            card.appendChild(titleEl);
            card.appendChild(descEl);
            
            container.appendChild(card);
            
            if (!document.getElementById("notification-keyframe")) {
                const style = document.createElement("style");
                style.id = "notification-keyframe";
                style.textContent = `
                    @keyframes slideInNotification {
                        from { transform: translateX(-100px); opacity: 0; }
                        to { transform: translateX(0); opacity: 1; }
                    }
                `;
                document.head.appendChild(style);
            }
            
            setTimeout(() => {
                card.style.transition = "all 0.3s ease";
                card.style.transform = "translateX(-150%)";
                card.style.opacity = "0";
                setTimeout(() => card.remove(), 300);
            }, 4000);
        }

        function addXp(amount, showToast = false) {
            studyStats.xp = (studyStats.xp || 0) + amount;
            let leveledUp = false;
            let targetXp = studyStats.level * 100;
            
            while (studyStats.xp >= targetXp) {
                studyStats.xp -= targetXp;
                studyStats.level = (studyStats.level || 1) + 1;
                targetXp = studyStats.level * 100;
                leveledUp = true;
            }
            
            if (leveledUp) {
                showNotification("🎉 LEVEL UP!", `You reached Level ${studyStats.level}! 🏆`, "success");
                setBuddyState("cheering", `Wow! LEVEL UP! We are now Level ${studyStats.level}! 🏆`);
            } else if (showToast) {
                showNotification("XP Gained", `+${amount} XP earned! ⚡`, "info");
            }
            
            saveStudyStats();
        }

        function idFromEmail(email) {
            return email.replace(/[^a-zA-Z0-9_-]/g, "_");
        }

        function initialsFor(name) {
            return (name || "?")
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part.charAt(0).toUpperCase())
                .join("") || "?";
        }

        function escapeHtml(text) {
            return String(text || "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

        function formatChatText(text) {
            const div = document.createElement("div");
            div.className = "chat-text";

            let html = escapeHtml(text || "");

            // Bold & Italic
            html = html.replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>");
            html = html.replace(/\*\*_(.*?)_\*\*/g, "<strong><em>$1</em></strong>");
            // Bold
            html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
            // Italic
            html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
            html = html.replace(/_(.*?)_/g, "<em>$1</em>");
            // Inline code
            html = html.replace(/`(.*?)`/g, "<code>$1</code>");
            // Newlines to <br>
            html = html.replace(/\n/g, "<br>");

            div.innerHTML = html;
            return div;
        }

        function addChatMessage(user, text, type = "message", fileName = "") {
            const chat = $("chat-messages");
            const row = document.createElement("div");
            const isSystem = user === "system";
            const isAI = user === "AI";
            const isYou = user === userName;

            row.className = "chat-message";
            if (isSystem) row.classList.add("system");
            if (isAI) row.classList.add("ai");
            if (isYou) row.classList.add("you");

            // React with pet cheering for non-system messages
            if (!isSystem && typeof setBuddyTemporarily === "function") {
                if (type === "note") {
                    setBuddyTemporarily("cheering", "A new note was shared! Writing helps memory! 📝");
                } else if (type === "file") {
                    setBuddyTemporarily("cheering", "Resource file uploaded! Awesome study materials! 📎");
                } else {
                    setBuddyTemporarily("cheering", isYou ? "Spot on! Sharing thoughts is great! 💬" : `${user} says hello! 💬`);
                }
            }

            if (isSystem) {
                row.textContent = text;
            } else {
                const avatar = document.createElement("div");
                avatar.className = "chat-avatar";
                avatar.textContent = isAI ? "AI" : initialsFor(user);

                const bubble = document.createElement("div");
                bubble.className = "chat-bubble";

                const meta = document.createElement("div");
                meta.className = "chat-meta";

                const name = document.createElement("strong");
                name.textContent = isYou ? "You" : user;

                const time = document.createElement("span");
                time.textContent = new Date().toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit"
                });

                meta.appendChild(name);
                meta.appendChild(time);
                bubble.appendChild(meta);

                if (type === "note") {
                    const note = document.createElement("div");
                    note.className = "note-bubble";

                    const title = document.createElement("strong");
                    title.textContent = fileName || "Shared note";

                    const body = document.createElement("div");
                    body.appendChild(formatChatText(text));

                    note.appendChild(title);
                    note.appendChild(body);
                    bubble.appendChild(note);
                } else if (type === "file") {
                    const link = document.createElement("a");
                    link.className = "file-link";
                    link.textContent = `📎 ${fileName || "file"}`;
                    link.download = fileName || "studybuddy-file";
                    link.href = text || "#";
                    // Open PDFs and images in a new tab for viewing
                    if (fileName && /\.(pdf|png|jpg|jpeg|gif|webp)$/i.test(fileName)) {
                        link.target = "_blank";
                        link.rel = "noopener noreferrer";
                        link.removeAttribute("download");
                    }
                    bubble.appendChild(link);
                } else if (type === "file_stub") {
                    // File shared during a previous session — base64 data is not stored
                    const notice = document.createElement("div");
                    notice.className = "file-link";
                    notice.style.cursor = "default";
                    notice.style.opacity = "0.7";
                    notice.innerHTML = `📎 <strong>${fileName || "file"}</strong><br><small style="font-size:0.72rem;">Shared during session · re-share to download again</small>`;
                    bubble.appendChild(notice);
                } else {
                    const message = document.createElement("div");
                    message.className = "chat-text";
                    message.appendChild(formatChatText(text));
                    bubble.appendChild(message);
                }

                row.appendChild(avatar);
                row.appendChild(bubble);
            }

            chat.appendChild(row);
            chat.scrollTop = chat.scrollHeight;
        }

        function renderMembers(users) {
            const row = $("members-row");
            row.innerHTML = "";

            users.forEach((user) => {
                const tag = document.createElement("span");
                tag.className = "member-tag";
                tag.textContent = user.email === userEmail ? `${user.name} (You)` : user.name;
                row.appendChild(tag);
            });
        }

        function updateGridClass() {
            const count = $("video-grid").querySelectorAll(".video-box").length;
            $("video-grid").className = `video-grid col-${Math.min(Math.max(count, 1), 3)}`;
        }

        function createRemotePlaceholder(peer) {
            const id = `remote-${idFromEmail(peer.email)}`;
            if ($(id)) return;

            const box = document.createElement("div");
            box.className = "video-box";
            box.id = id;

            const placeholder = document.createElement("div");
            placeholder.className = "no-video";
            placeholder.textContent = "Waiting for video...";

            const label = document.createElement("div");
            label.className = "video-label";
            label.textContent = peer.name || peer.email.split("@")[0];

            box.appendChild(placeholder);
            box.appendChild(label);
            $("video-grid").appendChild(box);
            updateGridClass();
        }

        function attachStreamToPlaceholder(peerEmail, stream) {
            const id = `remote-${idFromEmail(peerEmail)}`;
            const box = $(id);
            if (!box) return;

            const existingVideo = box.querySelector("video");
            if (existingVideo) {
                if (existingVideo.srcObject !== stream) {
                    existingVideo.srcObject = stream;
                }
                existingVideo.play().catch(() => {});
                return;
            }

            box.innerHTML = "";

            const video = document.createElement("video");
            video.autoplay = true;
            video.playsInline = true;
            video.srcObject = stream;

            const label = document.createElement("div");
            label.className = "video-label";
            label.textContent = peerNames[peerEmail] || peerEmail.split("@")[0];

            box.appendChild(video);
            box.appendChild(label);

            video.play().catch(() => {});
        }

        function removePeer(peerEmail) {
            if (peerConnections[peerEmail]) {
                peerConnections[peerEmail].close();
                delete peerConnections[peerEmail];
            }

            delete pendingCandidates[peerEmail];
            delete remoteStreams[peerEmail];

            const box = $(`remote-${idFromEmail(peerEmail)}`);
            if (box) box.remove();

            updateGridClass();
        }

        function ensurePeer(peer) {
            peerNames[peer.email] = peer.name || peer.email.split("@")[0];

            if (peerConnections[peer.email]) {
                return peerConnections[peer.email];
            }

            createRemotePlaceholder(peer);

            const pc = new RTCPeerConnection(_iceConfig || { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
            peerConnections[peer.email] = pc;
            pendingCandidates[peer.email] = pendingCandidates[peer.email] || [];

            if (localStream) {
                localStream.getTracks().forEach((track) => {
                    pc.addTrack(track, localStream);
                });
            }

            pc.ontrack = (event) => {
                if (!remoteStreams[peer.email]) {
                    remoteStreams[peer.email] = new MediaStream();
                }
                remoteStreams[peer.email].addTrack(event.track);
                attachStreamToPlaceholder(peer.email, remoteStreams[peer.email]);
            };

            pc.onicecandidate = (event) => {
                if (!event.candidate || !socket) return;

                socket.emit("webrtc_ice_candidate", {
                    room_code: roomCode,
                    target: peer.email,
                    candidate: event.candidate,
                    from_name: userName,
                    from_email: userEmail
                });
            };

            pc.onnegotiationneeded = async () => {
                if (userEmail < peer.email) {
                    await makeOffer(peer);
                }
            };

            pc.onconnectionstatechange = () => {
                if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
                    console.warn("Peer connection state:", pc.connectionState, peer.email);
                }
            };

            return pc;
        }

        async function flushPendingCandidates(peerEmail) {
            const pc = peerConnections[peerEmail];
            const list = pendingCandidates[peerEmail] || [];

            while (list.length && pc && pc.remoteDescription) {
                const candidate = list.shift();
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (err) {
                    console.warn("Could not add ICE candidate from pending list", err);
                }
            }
        }

        async function makeOffer(peer) {
            const pc = ensurePeer(peer);
            if (makingOfferMap[peer.email] || pc.signalingState !== "stable") return;

            try {
                makingOfferMap[peer.email] = true;
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);

                socket.emit("webrtc_offer", {
                    room_code: roomCode,
                    target: peer.email,
                    offer: pc.localDescription,
                    from_name: userName,
                    from_email: userEmail
                });
            } catch (err) {
                console.warn("Error creating offer", err);
            } finally {
                makingOfferMap[peer.email] = false;
            }
        }

        async function handleRoomUsers(data) {
            const users = data.users || [];
            const activeEmails = new Set(users.map((user) => user.email));

            renderMembers(users);

            Object.keys(peerConnections).forEach((email) => {
                if (!activeEmails.has(email)) removePeer(email);
            });

            for (const peer of users) {
                if (!peer.email || peer.email === userEmail) continue;

                ensurePeer(peer);
            }

            updateGridClass();
        }

        async function handleOffer(data) {
            const peer = {
                email: data.from_email,
                name: data.from_name || data.from_email.split("@")[0]
            };

            const pc = ensurePeer(peer);
            const polite = userEmail > peer.email;

            const offerCollision = makingOfferMap[peer.email] || pc.signalingState !== "stable";
            const ignoreOffer = !polite && offerCollision;

            if (ignoreOffer) {
                return;
            }

            if (offerCollision && polite) {
                await pc.setLocalDescription({ type: "rollback" });
            }

            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            await flushPendingCandidates(peer.email);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            socket.emit("webrtc_answer", {
                room_code: roomCode,
                target: peer.email,
                answer: pc.localDescription,
                from_name: userName,
                from_email: userEmail
            });
        }

        async function handleAnswer(data) {
            const peerEmail = data.from_email;
            const pc = peerConnections[peerEmail];

            if (!pc) return;
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            await flushPendingCandidates(peerEmail);
        }

        async function handleIceCandidate(data) {
            const peerEmail = data.from_email;
            const pc = peerConnections[peerEmail];

            if (!pc || !pc.remoteDescription) {
                pendingCandidates[peerEmail] = pendingCandidates[peerEmail] || [];
                pendingCandidates[peerEmail].push(data.candidate);
                return;
            }

            try {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (err) {
                console.warn("Could not add ICE candidate", err);
            }
        }

        async function startLocalVideo() {
            // getUserMedia requires a secure context (HTTPS or localhost).
            // On a deployed HTTP site the browser sets mediaDevices to undefined.
            if (!window.isSecureContext || !navigator.mediaDevices) {
                $("local-no-video").classList.remove("hidden");
                $("local-no-video").textContent =
                    "Camera unavailable: your site must be served over HTTPS. " +
                    "HTTP blocks camera/mic access on all non-localhost origins.";
                const vBtn = $("video-btn");
                const aBtn = $("audio-btn");
                if (vBtn) {
                    vBtn.disabled = true;
                    vBtn.innerHTML = ICON_VIDEO_OFF;
                    vBtn.classList.add("btn-red");
                }
                if (aBtn) {
                    aBtn.disabled = true;
                    aBtn.innerHTML = ICON_AUDIO_OFF;
                    aBtn.classList.add("btn-red");
                }
                return;
            }
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                $("local-video").srcObject = localStream;
                $("local-no-video").classList.add("hidden");

                // Sync initial button states
                const vBtn = $("video-btn");
                if (vBtn) {
                    vBtn.innerHTML = ICON_VIDEO_ON;
                    vBtn.classList.remove("off", "btn-red");
                    vBtn.classList.add("btn-primary");
                }
                const aBtn = $("audio-btn");
                if (aBtn) {
                    aBtn.innerHTML = ICON_AUDIO_ON;
                    aBtn.classList.remove("off", "btn-red");
                    aBtn.classList.add("btn-primary");
                }

                // If peer connections already exist, add tracks now
                for (const [peerEmail, pc] of Object.entries(peerConnections)) {
                    const senders = pc.getSenders();
                    for (const track of localStream.getTracks()) {
                        const alreadySending = senders.some((s) => s.track && s.track.kind === track.kind);
                        if (!alreadySending) {
                            pc.addTrack(track, localStream);
                        }
                    }
                }
            } catch (err) {
                console.warn("getUserMedia failed:", err);
                $("local-no-video").classList.remove("hidden");
                // Show a specific message based on the actual error type
                const errName = err?.name || "";
                if (errName === "NotFoundError" || errName === "DevicesNotFoundError") {
                    $("local-no-video").textContent = "No camera or microphone found on this device.";
                } else if (errName === "NotReadableError" || errName === "TrackStartError") {
                    $("local-no-video").textContent = "Camera is busy — close other apps using it and refresh.";
                } else if (errName === "OverconstrainedError") {
                    $("local-no-video").textContent = "Camera settings not supported by this device.";
                } else if (errName === "NotAllowedError" || errName === "PermissionDeniedError") {
                    $("local-no-video").textContent = "Camera or microphone permission was blocked. Please allow access in your browser settings.";
                } else {
                    $("local-no-video").textContent = "Could not start camera: " + (err?.message || "unknown error");
                }
                const vBtn = $("video-btn");
                const aBtn = $("audio-btn");
                if (vBtn) {
                    vBtn.disabled = true;
                    vBtn.innerHTML = ICON_VIDEO_OFF;
                    vBtn.classList.add("btn-red");
                }
                if (aBtn) {
                    aBtn.disabled = true;
                    aBtn.innerHTML = ICON_AUDIO_OFF;
                    aBtn.classList.add("btn-red");
                }
            }
        }

        function stopLocalVideo() {
            if (!localStream) return;
            localStream.getTracks().forEach((track) => track.stop());
            localStream = null;
        }

        function toggleVideo() {
            if (!localStream) return;

            videoEnabled = !videoEnabled;
            localStream.getVideoTracks().forEach((track) => {
                track.enabled = videoEnabled;
            });

            const btn = $("video-btn");
            btn.classList.toggle("off", !videoEnabled);
            if (videoEnabled) {
                btn.innerHTML = ICON_VIDEO_ON;
                btn.classList.remove("btn-red");
                btn.classList.add("btn-primary");
            } else {
                btn.innerHTML = ICON_VIDEO_OFF;
                btn.classList.remove("btn-primary");
                btn.classList.add("btn-red");
            }
        }

        function toggleAudio() {
            if (!localStream) return;

            audioEnabled = !audioEnabled;
            localStream.getAudioTracks().forEach((track) => {
                track.enabled = audioEnabled;
            });

            const btn = $("audio-btn");
            btn.classList.toggle("off", !audioEnabled);
            if (audioEnabled) {
                btn.innerHTML = ICON_AUDIO_ON;
                btn.classList.remove("btn-red");
                btn.classList.add("btn-primary");
            } else {
                btn.innerHTML = ICON_AUDIO_OFF;
                btn.classList.remove("btn-primary");
                btn.classList.add("btn-red");
            }
        }

        function updateTimerDisplay() {
            const minutes = Math.floor(timeLeft / 60);
            const seconds = timeLeft % 60;
            $("timer-display").textContent =
                `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
        }

        function startTimer() {
            if (timerRunning) return;

            timerRunning = true;
            $("timer-start").disabled = true;
            $("timer-pause").disabled = false;

            // Sync pet studying state
            setBuddyState("studying", "Focus mode activated! Let's crush this! ✍️");

            timerInterval = setInterval(() => {
                recordFocusedSecond();
                timeLeft -= 1;
                updateTimerDisplay();

                if (timeLeft <= 0) {
                    clearInterval(timerInterval);
                    timerRunning = false;
                    $("timer-start").disabled = false;
                    $("timer-pause").disabled = true;
                    completeStudySession();
                    addChatMessage("system", "Study session complete. Loyalty Points updated.");
                    timeLeft = STUDY_SESSION_SECONDS;
                    updateTimerDisplay();
                }
            }, 1000);
        }

        function pauseTimer() {
            clearInterval(timerInterval);
            timerRunning = false;
            $("timer-start").disabled = false;
            $("timer-pause").disabled = true;

            // Sync pet sleeping state
            setBuddyState("sleeping", "Time for a quick stretch. Rest up! ☕");
        }

        function resetTimer() {
            clearInterval(timerInterval);
            timerRunning = false;
            timeLeft = STUDY_SESSION_SECONDS;
            $("timer-start").disabled = false;
            $("timer-pause").disabled = true;
            updateTimerDisplay();

            // Sync pet sleeping state
            setBuddyState("sleeping", "Ready to start a new focus session? Let's go!");
        }

        async function sendChat() {
            const input = $("chat-input");
            const text = input.value.trim();
            if (!text) return;

            input.value = "";

            if (text.startsWith("/ai ")) {
                const question = text.slice(4).trim();
                if (!question) return;

                addChatMessage("AI", "Thinking...");

                try {
                    const res = await fetch(
                        `/ai/ask?question=${encodeURIComponent(question)}&subject=${encodeURIComponent(userSubject)}`
                    );
                    const data = await res.json();
                    addChatMessage("AI", data.answer || data.error || "No answer received.");
                } catch {
                    addChatMessage("AI", "AI request failed.");
                }

                return;
            }

            socket.emit("chat_message_socket", {
                room_code: roomCode,
                user_name: userName,
                text,
                type: "message"
            });
        }

        async function summarizeRoom() {
            addChatMessage("AI", "Summarizing this room...");

            try {
                const data = await postJson("/ai/summarize-room", { room_code: roomCode });
                addChatMessage("AI", data.summary || data.error || "No summary available.");
            } catch {
                addChatMessage("AI", "Could not summarize the room.");
            }
        }

        async function generateQuiz() {
            const topic = prompt("Enter quiz topic:", userSubject || "General");
            if (!topic) return;

            addChatMessage("AI", "Generating quiz...");

            try {
                const data = await postJson("/ai/quiz", {
                    subject: userSubject,
                    topic,
                    difficulty: "medium"
                });
                addChatMessage("AI", data.quiz || data.error || "Could not generate quiz.");
            } catch {
                addChatMessage("AI", "Quiz generation failed.");
            }
        }

        async function generateStudyPlan() {
            const goal = prompt("What do you want to study?", userSubject || "revision");
            if (!goal) return;

            addChatMessage("AI", "Creating study plan...");

            try {
                const data = await postJson("/ai/study-plan", {
                    subject: userSubject,
                    goal,
                    minutes: 45
                });
                addChatMessage("AI", data.plan || data.error || "Could not generate study plan.");
            } catch {
                addChatMessage("AI", "Study plan generation failed.");
            }
        }

        function openNotesModal() {
            $("notes-modal").classList.remove("hidden");
            $("notes-modal").classList.add("active");
            $("note-title").focus();
        }

        function closeNotesModal() {
            $("notes-modal").classList.remove("active");
            $("notes-modal").classList.add("hidden");
        }

        function shareNote() {
            const title = $("note-title").value.trim() || "Note";
            const content = $("note-content").value.trim();

            if (!content) return;

            socket.emit("chat_message_socket", {
                room_code: roomCode,
                user_name: userName,
                text: content,
                type: "note",
                file_name: title
            });

            // NOTE: saveNoteForUser is now handled inside socket.on("new-message")
            // so ALL room members get the note saved exactly once.
            studyStats.notesShared += 1;
            markStudyDay();
            saveStudyStats();

            $("note-title").value = "";
            $("note-content").value = "";
            closeNotesModal();
        }

        function shareFile() {
            const file = $("file-input").files[0];
            if (!file) return;

            if (file.size > MAX_FILE_SIZE_BYTES) {
                alert(`Please share files smaller than ${MAX_FILE_SIZE_MB} MB.`);
                $("file-input").value = "";
                return;
            }

            const reader = new FileReader();
            reader.onload = () => {
                socket.emit("chat_message_socket", {
                    room_code: roomCode,
                    user_name: userName,
                    text: reader.result,
                    type: "file",
                    file_name: file.name
                });
                $("file-input").value = "";
            };
            reader.readAsDataURL(file);
        }

        async function loadHistory() {
            try {
                const res = await fetch(`/chat/${roomCode}`);
                const data = await res.json();

                $("chat-messages").innerHTML = "";

                if (!data.messages || !data.messages.length) {
                    addChatMessage("system", "Room ready. Waiting for study partners...");
                    return;
                }

                data.messages.forEach((msg) => {
                    addChatMessage(msg.user, msg.text, msg.type, msg.fileName);
                    // BUG FIX: also save notes from history so they appear on the home dashboard
                    if (msg.type === "note") {
                        const fullUser = getUser() || { email: userEmail };
                        saveNoteForUser(fullUser, {
                            title: msg.fileName || `${msg.user}'s Note`,
                            content: msg.text,
                            roomCode,
                            subject: userSubject,
                            sharedBy: msg.user,
                            createdAt: msg.timestamp || new Date().toISOString()
                        });
                    }
                });
            } catch {
                addChatMessage("system", "Could not load previous chat messages.");
            }
        }

        function connectSocket() {
            // Explicitly prefer WebSocket over polling.
            // Many reverse proxies (nginx, Cloudflare, Render, Railway) default to
            // blocking WebSocket upgrades — enable it in your proxy config too.
            socket = io({
                transports: ["websocket", "polling"],
                reconnectionAttempts: 10,
                reconnectionDelay: 1500
            });

            socket.on("connect", () => {
                $("connection-status").textContent = "Online";
                socket.emit("join_room_signal", {
                    room_code: roomCode,
                    user_name: userName,
                    user_email: userEmail
                });
            });

            socket.on("disconnect", () => {
                $("connection-status").textContent = "Offline";
            });

            socket.on("room-users", (data) => {
                handleRoomUsers(data).catch((err) => console.warn("Room users failed", err));
            });

            socket.on("user-left", (data) => {
                if (data.email) {
                    // FIX: show friendly name instead of raw email address
                    const displayName = peerNames[data.email] || data.email.split("@")[0];
                    removePeer(data.email);
                    addChatMessage("system", `${displayName} left the room.`);
                }
            });

            socket.on("webrtc_offer", (data) => {
                handleOffer(data).catch((err) => console.warn("Offer handling failed", err));
            });

            socket.on("webrtc_answer", (data) => {
                handleAnswer(data).catch((err) => console.warn("Answer handling failed", err));
            });

            socket.on("webrtc_ice_candidate", (data) => {
                handleIceCandidate(data).catch((err) => console.warn("ICE handling failed", err));
            });

            socket.on("new-message", (data) => {
                addChatMessage(data.user, data.text, data.type, data.fileName);

                // Save notes for EVERY room member exactly once.
                // FIX: use the full saved user object (includes auth_token) so
                // saveNoteForUser can sync the note to the server across devices.
                if (data.type === "note") {
                    const fullUser = getUser() || { email: userEmail };
                    saveNoteForUser(
                        fullUser,
                        {
                            title: data.fileName || `${data.user}'s Note`,
                            content: data.text,
                            roomCode,
                            subject: userSubject,
                            sharedBy: data.user,
                            createdAt: data.timestamp || new Date().toISOString()
                        }
                    );
                }

                // Award XP when you send messages/notes/files
                if (data.user === userName) {
                    if (data.type === "note") {
                        addXp(50, true);
                    } else if (data.type === "file") {
                        addXp(50, true);
                    } else if (data.type === "message") {
                        addXp(5, false); // Don't show toast for simple messages to avoid spam
                    }
                }
            });
        }

        function leaveRoom() {
            if (!confirm("Leave this study room?")) return;

            // if timer was still running, award early leave points
            if (timerRunning) {
                studyStats.earlyLeaves = (studyStats.earlyLeaves || 0) + 1;
                markStudyDay();
                saveStudyStats();
            }

            // Stop all audio streams on exit
            if (typeof audioStreams !== "undefined" && audioStreams) {
                Object.values(audioStreams).forEach(audio => {
                    try { audio.pause(); } catch(e){}
                    audio.src = "";
                });
            }
            stopNoise();

            if (socket) {
                socket.emit("leave_room_signal", {
                    room_code: roomCode,
                    user_email: userEmail
                });
                socket.disconnect();
            }

            stopLocalVideo();
            Object.values(peerConnections).forEach((pc) => pc.close());
            window.location.href = "/";
        }

        $("timer-start").addEventListener("click", startTimer);
        $("timer-pause").addEventListener("click", pauseTimer);
        $("timer-reset").addEventListener("click", resetTimer);
        $("video-btn").addEventListener("click", toggleVideo);
        $("audio-btn").addEventListener("click", toggleAudio);
        $("leave-btn").addEventListener("click", leaveRoom);
        $("send-chat-btn").addEventListener("click", sendChat);
        $("chat-input").addEventListener("keydown", (event) => {
            if (event.key === "Enter") sendChat();
        });
        $("open-notes-btn").addEventListener("click", openNotesModal);
        $("ai-summary-btn").addEventListener("click", summarizeRoom);
        $("ai-quiz-btn").addEventListener("click", generateQuiz);
        $("ai-plan-btn").addEventListener("click", generateStudyPlan);
        $("close-notes-btn").addEventListener("click", closeNotesModal);
        $("share-note-btn").addEventListener("click", shareNote);
        $("file-input").addEventListener("change", shareFile);
        $("notes-modal").addEventListener("click", (event) => {
            if (event.target.id === "notes-modal") closeNotesModal();
        });
        document.querySelectorAll("[data-ai-prompt]").forEach((button) => {
            button.addEventListener("click", () => {
                $("chat-input").value = `/ai ${button.dataset.aiPrompt}`;
                $("chat-input").focus();
            });
        });
        window.addEventListener("beforeunload", saveStudyStats);
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") saveStudyStats();
        });

        const sbToggleBtn = $("soundboard-toggle-btn");
        const sbPopover = $("soundboard-popover");
        const sbCloseBtn = $("close-soundboard");

        if (sbToggleBtn && sbPopover) {
            sbToggleBtn.addEventListener("click", () => {
                sbPopover.classList.toggle("hidden");
            });
        }
        if (sbCloseBtn && sbPopover) {
            sbCloseBtn.addEventListener("click", () => {
                sbPopover.classList.add("hidden");
            });
        }

        handleSoundToggle("lofi", null, null, audioStreams.lofi);
        handleSoundToggle("rain", null, null, audioStreams.rain);
        handleSoundToggle("cafe", null, null, audioStreams.cafe);
        handleSoundToggle("forest", null, null, audioStreams.forest);
        handleSoundToggle("noise", playNoise, stopNoise, null);

        // Sync initial pet state
        setBuddyState("sleeping", "Zzz... tap start when you're ready! 😴");

        updateTimerDisplay();
        loadHistory();
        // Fetch ICE config first so TURN credentials are ready before any peer connection is created
        fetchIceConfig().then(() => startLocalVideo()).then(connectSocket);
    }

    function setupThemeToggler() {
        const toggleBtn = document.getElementById("theme-toggle-btn");
        if (!toggleBtn) return;

        // Sync initial button icon — icon represents the ACTION (what clicking will switch to)
        // In dark mode: clicking switches to light → show ☀️
        // In light mode: clicking switches to dark → show 🌙
        const currentTheme = document.documentElement.getAttribute("data-theme") || "light";
        toggleBtn.textContent = currentTheme === "dark" ? "☀️" : "🌙";

        toggleBtn.addEventListener("click", () => {
            const currentTheme = document.documentElement.getAttribute("data-theme") || "light";
            const newTheme = currentTheme === "dark" ? "light" : "dark";

            document.documentElement.setAttribute("data-theme", newTheme);
            localStorage.setItem("theme", newTheme);
            // Show icon for the NEXT possible action
            toggleBtn.textContent = newTheme === "dark" ? "☀️" : "🌙";
        });
    }

    document.addEventListener("DOMContentLoaded", () => {
        setupThemeToggler();
        const page = document.body.dataset.page;

        if (page === "home") initHome();
        if (page === "login") initLogin();
        if (page === "room") initRoomRedirect();
        if (page === "study") initStudy();
    });
})();