#!/bin/bash
set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export HOME="/Users/tboats"
export GIT_SSH_COMMAND="ssh -i /Users/tboats/.ssh/github_key -o IdentitiesOnly=yes"

cd /Users/tboats/Documents/Code/health/running_heatmap/Projects/running-heatmap/repo

LOG_FILE="/Users/tboats/Documents/Code/health/running_heatmap/sync.log"

echo "=========================================" >> "$LOG_FILE"
echo "Starting Daily Garmin Sync: $(date)" >> "$LOG_FILE"

# 1. Sync Running Heatmap
cd /Users/tboats/Documents/Code/health/running_heatmap/Projects/running-heatmap/repo
/opt/homebrew/bin/uv run --with garminconnect --with fitparse python3 sync_garmin.py --auto-push >> "$LOG_FILE" 2>&1

# 2. Sync Marathon 2027 Training, Coach Evaluation & Plan Doc
cd /Users/tboats/Documents/Code/health/running_heatmap/Projects/la-marathon-2027/repo
echo "Starting Marathon 2027 Training & Coaching Sync: $(date)" >> "$LOG_FILE"
/opt/homebrew/bin/uv run --with garminconnect --with fitparse python3 sync_and_eval.py --auto-push >> "$LOG_FILE" 2>&1
echo "Finished Marathon 2027 Training & Coaching Sync: $(date)" >> "$LOG_FILE"

echo "Finished Daily Garmin Sync: $(date)" >> "$LOG_FILE"
