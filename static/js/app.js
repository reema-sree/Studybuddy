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

    const ICE_SERVERS = {
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
            { urls: "stun:stun2.l.google.com:19302" },
            { urls: "stun:stun3.l.google.com:19302" },
            { urls: "stun:stun4.l.google.com:19302" },
            { urls: "stun:stun.cloudflare.com:3478" },
            {
                urls: "turn:openrelay.metered.ca:80",
                username: "openrelayproject",
                credential: "openrelayproject"
            },
            {
                urls: "turn:openrelay.metered.ca:443",
                username: "openrelayproject",
                credential: "openrelayproject"
            },
            {
                urls: "turn:openrelay.metered.ca:443?transport=tcp",
                username: "openrelayproject",
                credential: "openrelayproject"
            }
        ]
    };


    const MAX_FILE_SIZE_MB = 10;
    const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

    const $ = (id) => document.getElementById(id);

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
        } catch { /* silent — localStorage is the fallback */ }
    }

    async function syncNotesToServer(user, notes) {
        if (!user?.auth_token) return;
        try {
            await postJson("/auth/save-notes", {
                email: user.email,
                auth_token: user.auth_token,
                notes
            });
        } catch { /* silent */ }
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
            const merged = {
                focusSeconds:      Math.max(localStats.focusSeconds, serverStats.focusSeconds),
                completedSeconds:  Math.max(localStats.completedSeconds, serverStats.completedSeconds),
                completedSessions: Math.max(localStats.completedSessions, serverStats.completedSessions),
                notesShared:       Math.max(localStats.notesShared, serverStats.notesShared),
                earlyLeaves:       Math.max(localStats.earlyLeaves || 0, serverStats.earlyLeaves || 0),
                studyDates:        [...new Set([...localStats.studyDates, ...serverStats.studyDates])].sort()
            };
            localStorage.setItem(statsKeyForEmail(user.email), JSON.stringify(merged));

            // Merge notes — combine and deduplicate by createdAt
            const localNotes = readNotesForUser(user);
            const serverNotes = Array.isArray(data.notes) ? data.notes : [];
            const allNotes = [...localNotes, ...serverNotes];
            const seen = new Set();
            const mergedNotes = allNotes.filter(n => {
                const key = n.createdAt || n.title;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            }).slice(0, 50);
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
            studyDates: [...new Set(studyDates)].sort()
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
        const focusPoints = Math.floor(stats.focusSeconds / 60) * 2;
        const completionPoints = stats.completedSessions * 4;   // FIX: was 50, now 4 per session
        const earlyLeavePoints = (stats.earlyLeaves || 0) * 2; // FIX: 2 points for leaving early
        const dayPoints = stats.studyDates.length * 25;
        const notePoints = stats.notesShared * 10;
        return focusPoints + completionPoints + earlyLeavePoints + dayPoints + notePoints;
    }

    function setStatsText(name, value) {
        document.querySelectorAll(`[data-stat="${name}"]`).forEach((element) => {
            element.textContent = value;
        });
    }

    function renderHomeDashboard(user) {
        const dashboard = $("home-dashboard");
        if (!dashboard) return;

        const stats = readStatsForUser(user);
        const streak = statStreak(stats);

        dashboard.classList.remove("hidden");
        setStatsText("focusHours", statHours(stats.focusSeconds));
        setStatsText("completedHours", statHours(stats.completedSeconds));
        setStatsText("studyDays", String(stats.studyDates.length));
        setStatsText("loyaltyPoints", String(statPoints(stats)));
        setStatsText("streakLabel", `${streak} day${streak === 1 ? "" : "s"} streak`);
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

    function saveNoteForUser(user, note) {
        if (!user?.email) return;

        const notes = readNotesForUser(user);
        notes.unshift(note);
        const trimmed = notes.slice(0, 50);
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
            show("auth-switch-wrap",  mode === "login" || mode === "register");

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
                const merged = {
                    focusSeconds:      Math.max(local.focusSeconds, server.focusSeconds),
                    completedSeconds:  Math.max(local.completedSeconds, server.completedSeconds),
                    completedSessions: Math.max(local.completedSessions, server.completedSessions),
                    notesShared:       Math.max(local.notesShared, server.notesShared),
                    earlyLeaves:       Math.max(local.earlyLeaves || 0, server.earlyLeaves || 0),
                    studyDates:        [...new Set([...local.studyDates, ...(server.studyDates || [])])].sort()
                };
                localStorage.setItem(statsKeyForEmail(currentUser.email), JSON.stringify(merged));
            }
            if (Array.isArray(result.notes) && result.notes.length) {
                const local = readNotesForUser(currentUser);
                const all   = [...local, ...result.notes];
                const seen  = new Set();
                const merged = all.filter(n => {
                    const key = n.createdAt || n.title;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                }).slice(0, 50);
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
            markStudyDay();
            saveStudyStats();
        }

        function completeStudySession() {
            studyStats.completedSessions += 1;
            studyStats.completedSeconds += STUDY_SESSION_SECONDS;
            markStudyDay();
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

        function formatChatText(text) {
            const fragment = document.createDocumentFragment();
            const lines = String(text || "").split("\n");

            lines.forEach((line, index) => {
                if (index > 0) fragment.appendChild(document.createElement("br"));
                fragment.appendChild(document.createTextNode(line));
            });

            return fragment;
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
                    link.textContent = `Download ${fileName || "file"}`;
                    link.download = fileName || "studybuddy-file";
                    link.href = text || "#";
                    bubble.appendChild(link);
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

            // FIX: ontrack fires once per track (video + audio separately).
            // Reuse existing video element instead of wiping the box each time.
            const existingVideo = box.querySelector("video");
            if (existingVideo) {
                existingVideo.srcObject = stream;
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

            // FIX: handle browser autoplay policy
            video.play().catch(() => {});
        }

        function removePeer(peerEmail) {
            if (peerConnections[peerEmail]) {
                peerConnections[peerEmail].close();
                delete peerConnections[peerEmail];
            }

            delete pendingCandidates[peerEmail];

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

            const pc = new RTCPeerConnection(ICE_SERVERS);
            peerConnections[peer.email] = pc;
            pendingCandidates[peer.email] = pendingCandidates[peer.email] || [];

            if (localStream) {
                localStream.getTracks().forEach((track) => {
                    pc.addTrack(track, localStream);
                });
            }

            pc.ontrack = (event) => {
                // FIX: handle case where event.streams[0] is missing (some browsers)
                const stream = (event.streams && event.streams[0])
                    ? event.streams[0]
                    : new MediaStream([event.track]);
                attachStreamToPlaceholder(peer.email, stream);
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

            // FIX: renegotiate when tracks are added after peer connection is created
            // (happens when camera permission is granted after socket connects)
            pc.onnegotiationneeded = async () => {
                if (pc.signalingState !== "stable") return;
                if (!pc.__offerStarted) return; // only the offerer renegotiates
                try {
                    pc.__offerStarted = false; // reset so makeOffer can re-run
                    await makeOffer(peer);
                } catch (err) {
                    console.warn("Renegotiation failed", err);
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
                    console.warn("Could not add ICE candidate", err);
                }
            }
        }

        async function makeOffer(peer) {
            const pc = ensurePeer(peer);
            if (pc.__offerStarted) return;

            pc.__offerStarted = true;

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            socket.emit("webrtc_offer", {
                room_code: roomCode,
                target: peer.email,
                offer: pc.localDescription,
                from_name: userName,
                from_email: userEmail
            });
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

                if (userEmail < peer.email) {
                    try {
                        await makeOffer(peer);
                    } catch (err) {
                        console.warn("Offer failed", err);
                    }
                }
            }

            updateGridClass();

            if (users.length >= 2 && !timerRunning) {
                startTimer();
            }
        }

        async function handleOffer(data) {
            const peer = {
                email: data.from_email,
                name: data.from_name || data.from_email.split("@")[0]
            };

            const pc = ensurePeer(peer);

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
            if (pc.signalingState === "stable") return;

            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            await flushPendingCandidates(peerEmail);
        }

        async function handleIceCandidate(data) {
            const peerEmail = data.from_email;

            if (!peerConnections[peerEmail]) {
                pendingCandidates[peerEmail] = pendingCandidates[peerEmail] || [];
                pendingCandidates[peerEmail].push(data.candidate);
                return;
            }

            const pc = peerConnections[peerEmail];

            if (pc.remoteDescription) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                } catch (err) {
                    console.warn("Could not add ICE candidate", err);
                }
            } else {
                pendingCandidates[peerEmail] = pendingCandidates[peerEmail] || [];
                pendingCandidates[peerEmail].push(data.candidate);
            }
        }

        async function startLocalVideo() {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                $("local-video").srcObject = localStream;
                $("local-no-video").classList.add("hidden");

                // FIX: if peer connections already exist (socket connected before camera was ready),
                // add tracks now — onnegotiationneeded will fire and trigger a new offer automatically
                for (const [peerEmail, pc] of Object.entries(peerConnections)) {
                    const senders = pc.getSenders();
                    for (const track of localStream.getTracks()) {
                        const alreadySending = senders.some((s) => s.track && s.track.kind === track.kind);
                        if (!alreadySending) {
                            pc.addTrack(track, localStream);
                        }
                    }
                }
            } catch {
                $("local-no-video").classList.remove("hidden");
                $("local-no-video").textContent = "Camera or microphone permission was blocked.";
                $("video-btn").disabled = true;
                $("audio-btn").disabled = true;
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

            $("video-btn").classList.toggle("off", !videoEnabled);
        }

        function toggleAudio() {
            if (!localStream) return;

            audioEnabled = !audioEnabled;
            localStream.getAudioTracks().forEach((track) => {
                track.enabled = audioEnabled;
            });

            $("audio-btn").classList.toggle("off", !audioEnabled);
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
        }

        function resetTimer() {
            clearInterval(timerInterval);
            timerRunning = false;
            timeLeft = STUDY_SESSION_SECONDS;
            $("timer-start").disabled = false;
            $("timer-pause").disabled = true;
            updateTimerDisplay();
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
            // so ALL room members (including sender) get the note saved exactly once.
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
                });
            } catch {
                addChatMessage("system", "Could not load previous chat messages.");
            }
        }

        function connectSocket() {
            socket = io();

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
                    removePeer(data.email);
                    addChatMessage("system", `${data.email} left the room.`);
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

                // FIX: Save notes for EVERY room member (sender + receivers) exactly once.
                // shareNote() no longer calls saveNoteForUser so this is the single save
                // point — meaning all participants get shared notes in their Notes History.
                if (data.type === "note") {
                    saveNoteForUser(
                        { email: userEmail },
                        {
                            title: data.fileName || `${data.user}'s Note`,
                            content: data.text,
                            roomCode,
                            subject: userSubject,
                            sharedBy: data.user,
                            createdAt: new Date().toISOString()
                        }
                    );
                }
            });
        }

        function leaveRoom() {
            if (!confirm("Leave this study room?")) return;

            // FIX: if timer was still running, it's an early leave → award 2 points
            if (timerRunning) {
                studyStats.earlyLeaves = (studyStats.earlyLeaves || 0) + 1;
                markStudyDay();
                saveStudyStats();
            }

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

        updateTimerDisplay();
        loadHistory();
        startLocalVideo().then(connectSocket);
    }

    document.addEventListener("DOMContentLoaded", () => {
        const page = document.body.dataset.page;

        if (page === "home") initHome();
        if (page === "login") initLogin();
        if (page === "room") initRoomRedirect();
        if (page === "study") initStudy();
    });
})();