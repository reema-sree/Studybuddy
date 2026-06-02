from main import (
    is_expired, email_configured, gmail_user, gmail_password,
    turn_url, turn_username, turn_password, smtp_starttls,
    app
)
from datetime import datetime, timedelta

results = []

# 1. is_expired helper
past   = (datetime.now() - timedelta(minutes=1)).isoformat()
future = (datetime.now() + timedelta(minutes=1)).isoformat()
assert is_expired(past)   == True,  "FAIL: past should be expired"
assert is_expired(future) == False, "FAIL: future should not be expired"
assert is_expired("")     == True,  "FAIL: empty should be expired"
results.append("  [PASS] is_expired() works correctly")

# 2. Email config - password spaces stripped
assert email_configured() == True, "FAIL: email not configured"
assert " " not in gmail_password, "FAIL: spaces still in app password"
results.append(f"  [PASS] Email configured  user={gmail_user}  pwd_len={len(gmail_password)}")

# 3. STARTTLS on for port 587
assert smtp_starttls == True, "FAIL: STARTTLS should be enabled for port 587"
results.append("  [PASS] STARTTLS enabled (port 587)")

# 4. TURN config loaded
turn_status = "custom server configured" if turn_url else "using public TURN fallback"
results.append(f"  [PASS] TURN config loaded ({turn_status})")

# 5. /api/ice-config route exists
routes = [r.path for r in app.routes]
assert "/api/ice-config" in routes, "FAIL: /api/ice-config route missing"
results.append("  [PASS] /api/ice-config route exists")

# 6. /debug/reset-db removed
assert "/debug/reset-db" not in routes, "FAIL: /debug/reset-db still exposed!"
results.append("  [PASS] /debug/reset-db removed")

# 7. All required auth routes exist
required = ["/auth/register", "/auth/login", "/auth/verify-email",
            "/auth/forgot-password", "/auth/reset-password",
            "/auth/save-stats", "/auth/save-notes", "/auth/profile"]
for r in required:
    assert r in routes, f"FAIL: route {r} missing"
results.append("  [PASS] All auth routes present")

# 8. Match / room routes exist
for r in ["/match/join-queue", "/match/leave-queue", "/match/queue-count",
          "/room/create", "/room/join", "/ai/ask"]:
    assert r in routes, f"FAIL: route {r} missing"
results.append("  [PASS] All match/room/AI routes present")

print("\nBackend verification:")
for line in results:
    print(line)
print()
print("All checks passed!")
