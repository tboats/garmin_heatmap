#!/bin/bash
set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export HOME="/Users/tboats"
export GIT_SSH_COMMAND="ssh -i /Users/tboats/.ssh/github_key -o IdentitiesOnly=yes"

cd /Users/tboats/Documents/Code/health/running_heatmap/Projects/running-heatmap/repo

LOG_FILE="/Users/tboats/Documents/Code/health/running_heatmap/sync.log"

echo "=========================================" >> "$LOG_FILE"
echo "Starting Daily Garmin Sync: $(date)" >> "$LOG_FILE"
/opt/homebrew/bin/uv run --with garminconnect --with fitparse python3 sync_garmin.py --auto-push >> "$LOG_FILE" 2>&1
echo "Finished Daily Garmin Sync: $(date)" >> "$LOG_FILE"
