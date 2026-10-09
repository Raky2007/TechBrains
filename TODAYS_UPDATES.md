# TechBrains — Summary of Updates (October 9, 2026)

This document provides a comprehensive log of all architectural enhancements, security implementations, audit findings, and stability fixes completed today.

---

## 1. Executive Summary

Today's work advanced the **TechBrains LAN-Based Multiplayer Investigation Game** across five major operational pillars:
1. **Concurrency & Section Locking (Point 10)**: Strict server-authoritative round locks and per-question timeouts.
2. **State Persistence & Recovery (Point 11)**: Local storage fail-safes and draft recovery across device reloads.
3. **LAN Client IP Detection & Presence (Point 12)**: Peer IP address normalization and real-time host monitoring.
4. **Single Active Connection Enforcement (Point 13)**: Strict one-tab/one-device limit per team with graceful eviction.
5. **Admin Ban / Disqualification System (Point 14)**: Persistent database ban flags, instant socket teardown, and HTTP gating.
6. **Nemotron AI Evaluation Pre-Implementation Audit (Point 15)**: Secure architecture plan for integrating NVIDIA Nemotron API.
7. **Node.js Environment & Native SQLite Fix**: Solved the `HTTP 500` / `OFFLINE` error by aligning with Node 22 LTS.
8. **GitHub Deployment**: All passing changes built and pushed to `origin/main` (`commit 733ba81`).

---

## 2. Feature-by-Feature Changelog

### Point 10: Section / Level Locking & Progression Enforcement
* **Problem Solved**: High-concurrency LAN race conditions where one team finishing Round 1 advanced other teams prematurely.
* **Implementation Details**:
  * Decoupled each team's progression from the global game state (`TeamStage` resolution).
  * Enforced server-side per-question countdown timers with immutable deadlines in SQLite (`team_question_assignments.deadline_at`).
  * Enforced Round 1 qualification cutoff (`settings.round1CutoffScore`) before allowing any Round 2 clue unlock, media replay, or submission.
  * Enforced irreversible conclusion locking in `GameService.submitConclusion` and backed it with a SQLite trigger (`trg_conclusions_immutable_after_submit`).

### Point 11: Client-Side State Persistence & Recovery
* **Problem Solved**: Participants accidentally refreshing or navigating away losing written conclusion drafts or getting stuck in invalid auth states.
* **Implementation Details**:
  * Created `client/src/lib/storage.ts` with safe storage wrappers handling `QuotaExceededError` and private browsing blocks.
  * Implemented isolated conclusion draft keys scoped strictly to `(sessionId, teamId)`.
  * Preserved credentials on transient network dropouts while cleanly clearing session cookies on confirmed 401/403 responses.

### Point 12: Client IP Detection & Admin Presence Registry
* **Problem Solved**: Admins had no visibility into physical client workstations connected to the LAN server.
* **Implementation Details**:
  * Implemented `normalizeClientIp()` in `server/src/utils/network.ts` to normalize IPv4-mapped IPv6 (`::ffff:192.168.x.x`) and loopbacks directly from TCP socket handshakes.
  * Built an in-memory presence registry in `server/src/sockets/socketHandler.ts` tracking `is_connected`, connection count, IP addresses, and `last_connected_at`.
  * Enriched `GET /api/admin/teams` with live presence metadata while keeping participant payloads strictly isolated.

### Point 13: One Active Tab/Device per Team (Single Connection Enforcement)
* **Problem Solved**: Teams sharing access tokens across multiple devices or opening multiple browser tabs to gain unfair advantages.
* **Implementation Details**:
  * Enforced exactly one active Socket.IO connection per `(sessionId, teamId)`.
  * When a new socket connects for the same team, the older socket receives a `team:session_replaced` event and is immediately disconnected.
  * Added validation guards to all inbound socket handlers (`nexus:ping`, clue unlocks) to reject stale or replaced sockets.
  * Replaced sockets are blocked from rejoining private team rooms or receiving private state broadcasts.

### Point 14: Admin Ban and Unban Teams
* **Problem Solved**: No administrative mechanism to disqualify cheaters or disruptive teams during a live LAN event.
* **Implementation Details**:
  * Added additive SQLite columns via `server/src/database/migrate.ts`:
    * `teams.is_banned` (INTEGER NOT NULL DEFAULT 0)
    * `teams.banned_at`, `teams.banned_by`, `teams.ban_reason`
  * Added `POST /api/admin/teams/:id/ban` and `POST /api/admin/teams/:id/unban`.
  * Updated `requireTeamAuth` middleware to reject banned teams with `403 Forbidden` (`TEAM_BANNED`).
  * Immediately disconnects the banned team's active socket and prevents new handshakes.
  * Excluded banned teams from public leaderboard rankings while logging all ban actions to `audit_logs`.
  * Updated `AdminTeamsPage.tsx` with Ban/Unban modal dialogues and real-time status badges.

### Point 15: NVIDIA Nemotron AI Evaluation Pre-Implementation Audit
* **Objective**: Comprehensive, read-only architectural plan to integrate NVIDIA Nemotron API for evaluating Round 2 paragraphs.
* **Key Audit Findings & Architecture**:
  * **Endpoint**: Official NVIDIA NIM API at `https://integrate.api.nvidia.com/v1/chat/completions`.
  * **Model**: `nvidia/llama-3.1-nemotron-70b-instruct` (OpenAI-compatible request format).
  * **Prompt Hardening**: Enclosing student submissions in `<untrusted_submission>` XML blocks to prevent prompt injection from overriding rubrics or leaking reference answers.
  * **Anti-Gaming Rubric**: Structured 20-point scoring model across 4 dimensions:
    1. Core Culprit & Root Cause Identification (0–8 pts)
    2. Evidence & Clue Corroboration (0–6 pts)
    3. Analytical Reasoning & Coherence (0–4 pts)
    4. Conciseness & Anti-Padding (0–2 pts)
  * **Offline LAN Resilience**: Preserves submissions as pending/failed if internet drops; allows instant manual admin override or local mock evaluation fallback without crashing.

---

## 3. Environment & Runtime Stabilization

### Resolution of `HTTP 500: Internal Server Error` & `● OFFLINE`
* **Root Cause**:
  * The system was executing on **Node.js v24.11.1** (ABI version 137).
  * `better-sqlite3` only distributes precompiled C++ binaries for Node LTS (up to **Node v22**, ABI 127).
  * Because Visual C++ Build Tools were absent, the native module failed to compile from source, causing the Express backend to crash on startup while Vite remained active on port 5173.
  * Requests to `/api/...` were rejected with `ECONNREFUSED` by the proxy, rendering the UI offline and returning 500 errors.
* **Fix Applied**:
  * Installed **Node.js LTS v22.23.3** via `fnm`.
  * Installed prebuilt `better-sqlite3` compatible with Node 22.
  * Switched default fnm environment to Node 22.
  * Verified that all backend routes (team registration, question deletion, scoring) now respond with 200 OK.

---

## 4. Test Suite & Verification Results

All 7 test suites pass with **100% success rate**:

```
✓ src/__tests__/admin-ban.test.ts (11 tests)
✓ src/__tests__/game-rules.test.ts (39 tests)
✓ src/__tests__/networking-socket.test.ts (11 tests)
✓ src/__tests__/persistence-recovery.test.ts (4 tests)
✓ src/__tests__/presence-networking.test.ts (3 tests)
✓ src/__tests__/section-locking.test.ts (6 tests)
✓ src/__tests__/single-connection.test.ts (10 tests)

Test Files  7 passed (7)
Tests       92 passed (92)
```

---

## 5. Git & Deployment Status

* **Target Branch**: `main`
* **Commit Hash**: `733ba81`
* **Commit Message**: `feat: implement points 10-14 (locking, recovery, IP presence, single active connection, admin ban)`
* **Status**: Clean working tree; production client assets compiled to `server/public/`.
