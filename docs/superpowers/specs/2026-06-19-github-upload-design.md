# GitHub Upload Design

## Goal

Push Tquant to GitHub: private repo for full codebase, optional public repo for extractable components.

## Constraints

- `config.json` contains tushare API token — must not be exposed
- `tquant.db` is 2.8GB — must not be uploaded
- Private features (auto trader, strategy engine, stock screener) stay private
- No DB upload

## Repo Structure

### Private: `tquant` (full)

```
tquant/
├── main.py
├── config.example.json        # template without token
├── Tquant.html
├── requirements.txt           # to be added
├── app/
├── backend/
├── js/
├── strategies/
├── docs/
├── tests/
└── scripts/
```

### Public (future): `tquant-chart` / `tquant-core`

Extracted reusable components: chart renderer, indicators, backtest framework core.

## .gitignore

```
# secrets
config.json

# database
*.db
*.db-shm
*.db-wal

# python
__pycache__/
*.pyc
.venv/
*.spec

# IDE
.idea/

# misc
.codegraph/
.aider*
feedback/
temp_reports/
```

## Steps

1. Create `config.example.json` (strip token)
2. Update `.gitignore`
3. Add `requirements.txt`
4. Purge secret from git history via `git filter-repo` or `BFG`
5. Create private GitHub repo
6. `git remote add origin` + push
7. CI (optional, later)

## Risks

- Token already in git history — must purge or rotate tushare token
- Large WAL/SHM files alongside DB — covered by `*.db-*` globs
- `.idea/` already tracked — handled by gitignore + `git rm --cached`
