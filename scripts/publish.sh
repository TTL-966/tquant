#!/bin/bash
# Publish obfuscated public version to GitHub.
# Replaces source files with stubs, commits, pushes, then restores locally.
# Your working tree stays untouched after the script finishes.
set -e

STUBS="stubs"
FILES=(
    "backend/strategy_engine.py"
    "backend/trade_simulation.py"
    "backend/backtest_executor.py"
    "backend/multi_backtest_executor.py"
    "backend/stock_screener.py"
    "backend/realtime_strategy_engine.py"
    "backend/multi_realtime_strategy_engine.py"
    "backend/optimization/opt_objective.py"
    "backend/optimization/opt_worker.py"
    "js/indicators.js"
    "js/strategyBuilder.js"
    "js/strategyTemplates.js"
    "js/strategyUtils.js"
)

# 1. Verify clean working tree
if ! git diff-index --quiet HEAD --; then
    echo "ERROR: Working tree not clean. Commit or stash changes first."
    exit 1
fi

# 2. Verify stubs exist
for f in "${FILES[@]}"; do
    if [ ! -f "$STUBS/$f" ]; then
        echo "ERROR: Stub missing: $STUBS/$f"
        exit 1
    fi
done

# 3. Copy stubs over real files
for f in "${FILES[@]}"; do
    cp "$STUBS/$f" "$f"
done

# 4. Commit and push
git add "${FILES[@]}"
git commit -m "publish: obfuscated public version

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push origin master

# 5. Undo local publish commit, restore real files
git reset --hard HEAD~1

echo ""
echo "=== Published ==="
echo "Remote has stubs. Local files restored from git."
echo "Run 'git log --oneline -3' to verify."
