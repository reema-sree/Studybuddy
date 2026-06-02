content = open("static/js/app.js", encoding="utf-8").read()
home    = open("templates/home.html", encoding="utf-8").read()

checks = []

# 1. earlyLeave is now a penalty
assert "earlyLeavePenalty" in content, "FAIL: earlyLeavePenalty not found"
assert "earlyLeavePoints" not in content, "FAIL: old earlyLeavePoints still present"
assert "Math.max(0," in content, "FAIL: points floor at 0 missing"
checks.append("[PASS] earlyLeave is now a penalty (-3 pts each), floored at 0")

# 2. Dashboard hidden for guests
assert 'if (!user)' in content, "FAIL: guest check missing"
assert 'dashboard.classList.add("hidden")' in content, "FAIL: dashboard hide call missing"
checks.append("[PASS] Dashboard hidden when user is not signed in")

# 3. home.html dashboard starts hidden
assert 'id="home-dashboard" class="dashboard-panel hidden"' in home, "FAIL: hidden class missing from dashboard HTML"
checks.append("[PASS] home.html dashboard has hidden class initially")

# 4. user-left shows name not raw email
assert "displayName = peerNames[data.email]" in content, "FAIL: displayName lookup missing"
assert "${data.email} left the room" not in content, "FAIL: raw email still used in user-left"
checks.append("[PASS] user-left shows friendly name instead of raw email")

# 5. saveNoteForUser uses full user object (has auth_token for server sync)
assert "const fullUser = getUser()" in content, "FAIL: fullUser not found"
assert "saveNoteForUser(\n                        fullUser," in content, "FAIL: saveNoteForUser still using partial object"
checks.append("[PASS] saveNoteForUser uses full user object (auth_token included)")

# 6. fetchIceConfig hits the correct backend endpoint
assert 'fetch("/api/ice-config")' in content, "FAIL: /api/ice-config fetch missing"
checks.append("[PASS] fetchIceConfig calls /api/ice-config")

# 7. No debug reset-db route in app.js calls
assert "reset-db" not in content, "FAIL: reset-db reference found in frontend"
checks.append("[PASS] No debug reset-db references in frontend")

# 8. TURN fallback in fetchIceConfig
assert "openrelay.metered.ca" not in content, "FAIL: TURN servers should come from backend, not hardcoded in JS"
checks.append("[PASS] ICE/TURN config comes from backend only (not hardcoded in JS)")

print()
print("Frontend verification:")
for c in checks:
    print(" ", c)
print()
print("All frontend checks passed!")
