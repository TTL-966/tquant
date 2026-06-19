# GitHub Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push Tquant to a private GitHub repository with secrets, DB, and build artifacts excluded.

**Architecture:** Five sequential tasks: gitignore hardening, config template, requirements.txt, cleanup commit, GitHub repo creation + push. No code changes — configuration and git hygiene only.

**Tech Stack:** git, GitHub CLI (`gh`), Python 3.12

**Key finding:** `config.json` is untracked (never committed) — no history rewrite needed.

---

### Task 1: Update .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Write new .gitignore content**

Replace current `.aider*` with:

```gitignore
# Secrets
config.json

# Database (large files — 2.8GB+)
*.db
*.db-shm
*.db-wal

# Python
__pycache__/
*.pyc
*.pyo
.venv/
*.spec

# IDE
.idea/

# AI coding tools
.codegraph/
.aider*

# User data
feedback/
temp_reports/

# OS
.DS_Store
Thumbs.db
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: expand .gitignore to exclude secrets, DB, and build artifacts"
```

---

### Task 2: Create config.example.json

**Files:**
- Create: `config.example.json`

- [ ] **Step 1: Read current config.json structure**

```bash
cat config.json
```

- [ ] **Step 2: Create config.example.json with token stripped**

```json
{
  "data_source": "tushare",
  "tushare_token": "YOUR_TUSHARE_TOKEN_HERE",
  "idle_update_enabled": true,
  "idle_update_days": 3,
  "auto_trader": {
    "enabled": false,
    "mode": "pyautogui",
    "emergency_stop": false,
    "auto_confirm_until": null,
    "risk": {
      "max_amount_per_order": 50000,
      "max_volume_per_order": 10000,
      "trading_hours_only": true,
      "allowed_actions": ["buy", "sell"]
    },
    "pyautogui": {
      "window_title": "网上股票交易系统5.0",
      "use_image_recognition": false,
      "buy_button_pos": [492, 666],
      "sell_button_pos": [508, 653]
    }
  }
}
```

**Note:** Adjust the template to match exact structure of current `config.json`, replacing only sensitive values (token, credentials) with placeholders. Keep non-sensitive defaults intact so new users can see the expected format.

- [ ] **Step 3: Commit**

```bash
git add config.example.json
git commit -m "chore: add config.example.json template without secrets"
```

---

### Task 3: Generate requirements.txt

**Files:**
- Create: `requirements.txt`

- [ ] **Step 1: Create requirements.txt with pinned or minimal versions**

Based on import analysis:

```
# Core
pyside6>=6.5
pyside6-webengine>=6.5

# Data
tushare
baostock
pandas
numpy
sqlalchemy

# HTTP / Web
aiohttp
requests
beautifulsoup4

# Automation (auto trader)
pyautogui
pygetwindow
```

- [ ] **Step 2: Verify: install in fresh venv to confirm no missing deps (optional, skip if pressed for time)**

```bash
python -m venv /tmp/verify_venv && source /tmp/verify_venv/bin/activate && pip install -r requirements.txt
```

- [ ] **Step 3: Commit**

```bash
git add requirements.txt
git commit -m "chore: add requirements.txt"
```

---

### Task 4: Cleanup commit — remove tracked artifacts

**Files:**
- Modify: tracked `.idea/` and `__pycache__/` files (remove from tracking)

- [ ] **Step 1: Remove already-tracked files that are now gitignored**

```bash
# Remove .idea files from git tracking (keep on disk)
git rm --cached -r .idea/ 2>/dev/null

# Remove any tracked __pycache__ files
git rm --cached -r app/__pycache__/ 2>/dev/null
git rm --cached -r backend/__pycache__/ 2>/dev/null
```

- [ ] **Step 2: Verify nothing sensitive staged**

```bash
git diff --cached --name-only
```

Ensure no `config.json`, `*.db`, or `.venv/` in the list.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: remove IDE and cache files from git tracking"
```

---

### Task 5: Create GitHub repo and push

**Prerequisites:** GitHub CLI (`gh`) installed and authenticated. If not: `gh auth login`.

- [ ] **Step 1: Create private GitHub repository**

```bash
gh repo create tquant --private --source . --remote origin --push
```

This single command: creates `tquant` repo on GitHub (private), sets `origin` remote, pushes all branches.

If the command fails due to existing remotes or auth issues, fall back to manual steps:

```bash
# Create repo WITHOUT pushing first (to handle remotes)
gh repo create tquant --private --remote origin

# Then push
git push -u origin master
```

- [ ] **Step 2: Verify**

```bash
gh repo view --web
```

Check that:
- No `config.json` visible
- No `tquant.db` in repo
- `config.example.json` exists
- `.gitignore` present
- `requirements.txt` present

---

## Post-Push

After successful push:

1. **Rotate tushare token** — if token was ever committed to ANY git branch (it wasn't in this case, but if any other branches exist), revoke and regenerate at [tushare.pro](https://tushare.pro)
2. **Add README.md** (future) — project description, setup instructions, screenshot
3. **GitHub Actions CI** (future) — lint + basic import check
