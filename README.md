# NEXUS // AI INVESTIGATION
### Collegiate Synthetic Intelligence & Forensics Challenge
**Authoritative LAN-Based Multiplayer Forensic Investigation Game**

---

## 1. Architectural Overview

NEXUS is a self-hosted, offline-ready web application engineered to run on a single authoritative host laptop and support **30+ concurrent team workstations** over a local college Ethernet/LAN switch. It requires zero cloud accounts, external database servers, or internet connectivity.

- **Frontend**: React 18 + TypeScript + Vite, styled with Tailwind CSS, Lucide React icons, and Framer Motion transitions.
- **Backend**: Node.js + Express bound to `0.0.0.0` (configurable port defaulting to `3000`).
- **Real-Time Communication**: Authenticated Socket.IO with session rooms and private team channels.
- **Database**: SQLite using `better-sqlite3` with Write-Ahead Logging (`WAL`), foreign keys enforced, busy timeout (5000ms), and atomic transactions.
- **Validation & Security**: Zod schemas, bcryptjs password hashing, SHA-256 session token hashes, Multer server-side MIME verification, and in-memory rate limiting.
- **Authoritative Timers**: Server-authoritative deadlines with pause-time freezing, resume recalculation, deadline enforcement on every submission, and reboot recovery.

---

## 2. Visual Identity & Design System

- **Primary Background**: `#0B0D12`
- **Secondary Background**: `#11141B`
- **Card Background**: `#171A23`
- **Elevated Surface**: `#20232D`
- **Primary Violet**: `#8B7CFF` (Primary actions, selection states, active navigation)
- **Secondary Cyan**: `#51D9E8` (Live connection indicators, active timers)
- **Warm Amber**: `#F0B86E` (Forensic credits, clue costs)
- **Primary Text**: `#F0F0F5`
- **Secondary Text**: `#A8ADBC`
- **Borders**: `#2B2F3A`
- **Success / Error**: `#66D9A6` / `#FF6B78`
- **Typography**: Space Grotesk (headings), Inter (body/forms), JetBrains Mono (timers, scores, credit balances). Offline local system fallbacks are configured.

---

## 3. Quick Start & Production Launch

### Single Documented Production Launch Command

```bash
npm run build && npm start
```

Upon startup, the server automatically initializes SQLite (`nexus.db`), creates the default administrator (`admin`), checks network adapters, and prints the exact participant and administrator access URLs:

```
===============================================================
  ★ NEXUS // AI INVESTIGATION ★
  LAN CHAMPIONSHIP EDITION - AUTHORITATIVE HOST SERVER
===============================================================
  Authoritative Host listening on: 0.0.0.0:3000
  Local Access:      http://localhost:3000
  Primary LAN IP:    http://192.168.1.8:3000

  Participant Access URL (Share with 30 Teams on LAN):
  >>> http://192.168.1.8:3000 <<<

  Admin Portal:
  >>> http://192.168.1.8:3000/admin/login <<<
  Default Admin: admin
===============================================================
```

---

## 4. Complete NPM Scripts Reference

| Command | Purpose |
| :--- | :--- |
| `npm run dev` | Concurrently launches Vite dev server (`:5173`) and Express backend (`:3000`) with HMR. |
| `npm run build` | Compiles the client bundle directly into `server/public` and compiles TypeScript for the server into `server/dist`. |
| `npm start` | Launches the compiled production server bound to `0.0.0.0:3000`, serving the React frontend statically. |
| `npm run db` | Initializes SQLite tables and creates default admin and primary game session. |
| `npm run db:seed` | Populates sample Level 1 questions and sample Level 2 forensic investigation case with clues. |
| `npm run db:backup` | Creates an authoritative point-in-time backup of `nexus.db` and media uploads under `server/backups/`. |
| `npm test` | Runs the automated test suite verifying all 13 critical rules and acceptance criteria via Vitest. |

---

## 5. College LAN & Windows Firewall Configuration

### A. Windows Firewall Rule for Port 3000
To allow the 30 team computers to reach the host laptop over LAN, open PowerShell as **Administrator** on the host laptop and run:

```powershell
New-NetFirewallRule -DisplayName "NEXUS LAN Game Server" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

*(To remove the rule after the event: `Remove-NetFirewallRule -DisplayName "NEXUS LAN Game Server"`)*

### B. Finding the Host Laptop's LAN IPv4 Address
1. The host server automatically detects and prints the primary LAN IPv4 address on startup.
2. Alternatively, open PowerShell/Command Prompt and run:
   ```cmd
   ipconfig
   ```
   Look for the `IPv4 Address` under your active **Ethernet adapter** or **Wi-Fi adapter** (e.g., `192.168.1.8`).
3. Participant computers simply open:
   `http://<HOST_IP>:3000` (e.g. `http://192.168.1.8:3000`)

### C. College LAN Troubleshooting
- **Client Isolation**: If participant laptops cannot ping or reach the host, ensure the router or switch does not have "AP Client Isolation" enabled. A physical unmanaged Ethernet switch connecting all lab PCs is recommended for maximum throughput and zero latency.
- **Subnet Mismatches**: Verify that the host laptop and client machines share the same subnet mask (e.g. `255.255.255.0`) and default gateway.
- **Port Conflicts**: If port 3000 is occupied by another local service, change `PORT=8080` in `.env`.

---

## 6. Game Rules & Gameplay Flow

### Level 1: AI vs Human (Neural Discernment)
- **Question Media**: Text excerpts, high-resolution imagery, or video clips.
- **Options**:
  - `A. AI Made` (+1 pt if correct)
  - `B. Human Made` (+1 pt if correct)
  - `C. Can't Define` (0 pts, regardless of truth)
  - *Incorrect answer*: 0 pts.
- **Anti-Cheat & Fairness**:
  - The correct answer and explanation are **never** delivered in the question payload before submission.
  - Questions are independently randomized per team.
  - Submissions are atomic; duplicate submissions cannot award duplicate points.
  - When the authoritative timer expires, further answers are rejected.

### Level 2: Clues with Credits (Forensic Investigation)
- **Credit Allocation**: Each team starts with a configurable credit pool (Default: 200 CR).
- **Classified Clues**: Clues have credit prices (e.g., 30 CR, 40 CR, 50 CR).
- **Atomic Unlocking**:
  - Checked against active round state and available balance.
  - Idempotent: repeated unlock requests never double-charge.
  - Private: unlocked clues and draft conclusions are only transmitted to the purchasing team.
- **Forensic Conclusion**:
  - Teams synthesize an evidence-backed narrative in the multiline verdict field.
  - Final submission locks the draft and places it in the admin evaluation queue.
- **Admin Rubric Scoring**:
  - **Accuracy** (0–10 pts): Root cause, threat vector, and responsible entity.
  - **Reasoning & Evidence** (0–5 pts): Quality of deductive logic and clue citation.
  - **Credit Efficiency** (0–5 pts): Economy of intelligence acquisition.
  - **Total Level 2 Score**: Up to 20 pts.

### Final Leaderboard & Tie-Breakers
- **Final Score** = `Level 1 Score + Level 2 Score`.
- **Authoritative Tie-Breakers**:
  1. Higher Level 2 Score.
  2. Higher Level 1 Accuracy percentage.
  3. Earlier final conclusion submission timestamp.
- **Publication**: Results remain embargoed until the administrator clicks **"Publish Final Results"**.
- **Export**: One-click CSV download available in the admin portal.

---

## 7. Administrator Credentials & Controls

- **Admin Login Route**: `/admin/login`
- **Default Username**: `admin`
- **Default Password**: `nexus_forensics_2026!` *(Change via `.env`)*
- **Live Controls**:
  - **Start Level 1**: Validates question pool, shuffles question order per team, starts countdown.
  - **Pause Level 1 / Level 2**: Freezes timer; remaining seconds saved to SQLite.
  - **Resume Level 1 / Level 2**: Atomically recalculates deadline and resumes ticking.
  - **End Round**: Finalizes scores and transitions teams to waiting room.
  - **Publish Final Results**: Broadcasts final rankings and triggers celebration.
  - **Reset Tournament Session**: Archives active session and creates a fresh idle session.

---

## 8. 30-Client LAN Smoke-Test Checklist

| Step | Verification Procedure | Expected Outcome |
| :---: | :--- | :--- |
| **1** | Open host laptop at `http://localhost:3000/admin/login` and sign in. | Overview renders with 0 registered teams, seeded questions, and idle state. |
| **2** | Open 30 participant browsers across lab computers to `http://<HOST_IP>:3000`. | Join screen renders with green "LAN LIVE" badge on every machine. |
| **3** | Register distinct team names (`Team-01` through `Team-30`). | Each client redirects to `/waiting`; admin overview shows `Registered Teams: 30`. |
| **4** | Admin clicks **"Start Level 1 Round"** in Live Game Control. | All 30 participant screens simultaneously and automatically navigate to `/level1`. |
| **5** | Verify timers on all 30 machines tick down synchronously. | All clients match authoritative server deadline within <100ms drift. |
| **6** | Teams submit answers for questions. | Correct answers award +1 pt immediately; duplicate submissions are rejected. |
| **7** | Admin clicks **"Pause Level 1"**, waits 10s, then clicks **"Resume Level 1"**. | Timers freeze on all screens and resume accurately without losing remaining time. |
| **8** | Timer reaches 00:00 (or Admin ends L1). | Question submission locks; final scores display; clients return to `/waiting`. |
| **9** | Admin clicks **"Start Level 2 Round"**. | All 30 participant screens automatically transition to `/level2`. |
| **10** | Teams purchase clues with credits. | Credits deduct accurately (200 -> 170 -> 120); repeated clicks do not double-charge. |
| **11** | Teams submit forensic conclusions. | Admin submissions queue populates in real time with submitted text and clue counts. |
| **12** | Admin evaluates conclusions using the 0-10, 0-5, 0-5 rubric. | Level 2 scores update immediately in SQLite and reflect on the admin leaderboard. |
| **13** | Admin clicks **"Publish Final Results"**. | Standings un-embargo on all participant screens with top 3 podium and rankings. |
| **14** | Admin clicks **"Export CSV"**. | Full tournament results download as a properly formatted `.csv` spreadsheet. |

---

## 9. Database Backup & Disaster Recovery

- **Online WAL Backup**: SQLite's online backup API is used to take non-blocking snapshots even while writes are occurring.
- **Run Manual Backup**:
  ```bash
  npm run db:backup
  ```
  Or click **"Trigger Backup"** under `/admin/settings`.
- **Backup Location**: Stored in `server/backups/backup_<ISO_TIMESTAMP>/` containing:
  - `nexus.db` (Authoritative database snapshot)
  - `uploads/` (All uploaded question media)
  - `backup-metadata.json` (Record counts and session snapshot)
- **Restoration**: To restore from a backup, simply copy the backed-up `nexus.db` back to the project root and restart the server.
