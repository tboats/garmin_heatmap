#!/usr/bin/env python3
"""
sync_garmin.py - On-demand Garmin Connect Sync with OAuth Token Caching

Authenticates with Garmin Connect using OAuth tokens saved in ~/.garminconnect_tokens.
Fetches recent activities, downloads FIT files for new running activities, downsamples
coordinate points, updates data/runs.json, and optionally commits/pushes to GitHub.
"""

import os
import sys
import json
import getpass
import zipfile
import subprocess
from io import BytesIO
from datetime import datetime

try:
    from garminconnect import Garmin
except ImportError:
    print("❌ Error: 'garminconnect' library is required.")
    print("Install it with: uv pip install garminconnect fitparse")
    print("Or run via uv:   uv run --with garminconnect --with fitparse python3 sync_garmin.py")
    sys.exit(1)

try:
    from fitparse import FitFile
except ImportError:
    print("❌ Error: 'fitparse' library is required.")
    print("Install it with: uv pip install garminconnect fitparse")
    sys.exit(1)

TOKENSTORE = os.path.expanduser("~/.garminconnect_tokens")
DB_PATH = os.path.join(os.path.dirname(__file__), "data", "runs.json")
SEGMENTS_PATH = os.path.join(os.path.dirname(__file__), "data", "segments.json")
DOWNSAMPLE_RATE = 4

def refresh_segments(runs):
    """Recalculates signature route segments from runs and updates segments.json."""
    def find_best_run(min_d, max_d, title, desc, city_filter=None):
        candidates = []
        for r in runs:
            d = r.get('distance_meters', 0) / 1000.0
            if min_d <= d <= max_d and r.get('points'):
                if city_filter:
                    lat = r['points'][0]['lat']
                    lng = r['points'][0]['lng']
                    if city_filter == 'columbus' and not (39.5 <= lat <= 40.5 and -83.5 <= lng <= -82.5):
                        continue
                    if city_filter == 'seattle' and not (47.45 <= lat <= 47.8 and -122.5 <= lng <= -122.2):
                        continue
                    if city_filter == 'ny' and not (40.6 <= lat <= 41.0 and -74.1 <= lng <= -73.8):
                        continue
                    if city_filter == 'burlingame' and not (37.5 <= lat <= 37.7 and -122.5 <= lng <= -122.2):
                        continue
                candidates.append(r)
                
        if not candidates:
            return None
        best = min(candidates, key=lambda r: r.get('duration_seconds', 999999))
        return {
            'id': title.lower().replace(' ', '-').replace('&', 'and'),
            'name': title,
            'description': desc,
            'distance_meters': best['distance_meters'],
            'duration_seconds': best['duration_seconds'],
            'attempts': len(candidates),
            'best_date': best['start_time'],
            'points': best['points']
        }

    segments = [
        find_best_run(5.6, 5.85, 'Queen Anne Loop', 'Your signature 5.7km morning loop in Seattle', city_filter='seattle'),
        find_best_run(7.3, 7.6, 'Lake Union & Fremont 7.5K', 'Frequent 7.4km loop extending past Fremont & Westlake', city_filter='seattle'),
        find_best_run(9.7, 10.5, 'Seattle 10K Route', '10km training loop', city_filter='seattle'),
        find_best_run(12.0, 13.0, 'Seattle 12.5K Route', 'Frequent 12.2 - 12.9km loop through Seattle', city_filter='seattle'),
        find_best_run(14.4, 14.8, 'Seattle Long Loop 15K', '14.6km weekend long run loop', city_filter='seattle'),
        find_best_run(20.0, 21.0, 'Seattle 20K Long Run', '20.5km half-marathon distance long run', city_filter='seattle'),
        find_best_run(9.9, 10.2, 'Columbus 10K Route', '10km river/park route from Columbus, OH trip', city_filter='columbus'),
        find_best_run(8.9, 9.2, 'Burlingame Bay Trail', 'Bayfront running route from California trip', city_filter='burlingame'),
        find_best_run(16.0, 16.5, 'New York Central Park 10-Miler', '16.2km run through New York City', city_filter='ny')
    ]
    segments = [s for s in segments if s]
    with open(SEGMENTS_PATH, 'w') as f:
        json.dump(segments, f, indent=2)
    print(f"📊 Refreshed {len(segments)} route segments in {SEGMENTS_PATH}")
    return segments

def convert_semicircles(semicircles):
    if semicircles is None:
        return None
    return float(semicircles) * (180.0 / 2147483648.0)

def parse_fit_bytes(file_bytes, filename, downsample_rate=4):
    """Parses raw FIT or ZIP bytes in-memory and returns run activity dict."""
    # Check if raw bytes are a ZIP file
    if file_bytes.startswith(b'PK\x03\x04'):
        try:
            with zipfile.ZipFile(BytesIO(file_bytes)) as z:
                fit_names = [f for f in z.namelist() if f.lower().endswith('.fit')]
                if not fit_names:
                    return None
                file_bytes = z.read(fit_names[0])
        except Exception as e:
            print(f"    ⚠️ Warning: Could not unzip activity file {filename}: {e}")
            return None

    try:
        fitfile = FitFile(BytesIO(file_bytes))
    except Exception as e:
        print(f"    ⚠️ Warning: Could not parse FIT file {filename}: {e}")
        return None

    # Check if it is a running activity
    is_running = False
    for message in fitfile.get_messages('session'):
        values = message.get_values()
        if values.get('sport') == 'running':
            is_running = True
            break
            
    if not is_running:
        return None

    points = []
    start_time = None
    end_time = None
    valid_coord_count = 0
    
    for message in fitfile.get_messages('record'):
        values = message.get_values()
        raw_lat = values.get('position_lat')
        raw_lng = values.get('position_long')
        timestamp = values.get('timestamp')
        
        if raw_lat is None or raw_lng is None:
            continue
            
        valid_coord_count += 1
        if valid_coord_count % downsample_rate != 0:
            continue
            
        lat = convert_semicircles(raw_lat)
        lng = convert_semicircles(raw_lng)
        
        if lat is None or lng is None or not (-90.0 <= lat <= 90.0) or not (-180.0 <= lng <= 180.0):
            continue

        points.append({
            "lat": round(lat, 6),
            "lng": round(lng, 6)
        })
        
        if timestamp and isinstance(timestamp, datetime):
            if start_time is None or timestamp < start_time:
                start_time = timestamp
            if end_time is None or timestamp > end_time:
                end_time = timestamp

    if not points:
        return None

    session_distance = 0.0
    session_duration = 0.0
    
    for message in fitfile.get_messages('session'):
        values = message.get_values()
        if values.get('total_distance') is not None:
            session_distance = float(values.get('total_distance'))
        if values.get('total_timer_time') is not None:
            session_duration = float(values.get('total_timer_time'))
            
    if session_duration == 0.0 and start_time and end_time:
        session_duration = (end_time - start_time).total_seconds()
        
    return {
        "filename": filename,
        "start_time": (start_time.isoformat() + "Z") if start_time else None,
        "end_time": (end_time.isoformat() + "Z") if end_time else None,
        "distance_meters": round(session_distance, 1),
        "duration_seconds": round(session_duration, 1),
        "points_count": len(points),
        "points": points
    }

def authenticate():
    """Authenticates using env secret, cached OAuth tokens, or performs initial login."""
    garmin = None

    # 0. Try GARMIN_TOKENS environment variable (used in GitHub Actions)
    tokens_env = os.getenv("GARMIN_TOKENS")
    if tokens_env:
        try:
            print("🔒 Authenticating via GARMIN_TOKENS environment variable...")
            garmin = Garmin()
            garmin.garth.loads(tokens_env.strip())
            print("✅ Successfully authenticated via GARMIN_TOKENS session token!")
            return garmin
        except Exception as e:
            print(f"⚠️ Failed to authenticate via GARMIN_TOKENS: {e}")

    # 1. Try OAuth token authentication from disk
    if os.path.exists(TOKENSTORE):
        try:
            print(f"🔒 Authenticating via saved OAuth tokens ({TOKENSTORE})...")
            garmin = Garmin()
            garmin.login(TOKENSTORE)
            print(f"✅ Authenticated as: {garmin.full_name} ({garmin.display_name})")
            return garmin
        except Exception as e:
            print(f"⚠️ OAuth token expired or invalid: {e}")

    # 2. Prompt for login and save OAuth tokens
    print("\n🔑 Garmin Connect Login Required (OAuth tokens will be saved for future automatic syncs)")
    email = os.getenv("GARMIN_EMAIL") or input("Garmin Email: ").strip()
    password = os.getenv("GARMIN_PASSWORD") or getpass.getpass("Garmin Password: ")
    
    try:
        garmin = Garmin(email, password)
        garmin.login()
        os.makedirs(TOKENSTORE, exist_ok=True)
        garmin.garth.dump(TOKENSTORE)
        print(f"✅ Login successful! Saved OAuth tokens to {TOKENSTORE}")
        return garmin
    except Exception as e:
        print(f"❌ Failed to log in to Garmin Connect: {e}")
        sys.exit(1)

def main():
    print("🏃 Garmin Connect On-Demand Sync")
    print("================================")
    
    # 1. Load existing database
    if not os.path.exists(DB_PATH):
        print(f"❌ Database not found at {DB_PATH}")
        sys.exit(1)
        
    with open(DB_PATH, 'r') as f:
        runs = json.load(f)
        
    existing_times = {r.get("start_time") for r in runs if r.get("start_time")}
    existing_filenames = {r.get("filename") for r in runs if r.get("filename")}
    print(f"📊 Loaded existing database: {len(runs)} runs.")

    # 2. Authenticate
    garmin = authenticate()

    # 3. Fetch recent activities
    print("\n📡 Fetching recent activities from Garmin Connect...")
    try:
        activities = garmin.get_activities(0, 30)
    except Exception as e:
        print(f"❌ Error fetching activities: {e}")
        sys.exit(1)

    # 4. Filter for new running activities
    new_runs_count = 0
    for act in activities:
        act_id = act.get("activityId")
        act_type = act.get("activityType", {}).get("typeKey", "").lower()
        act_name = act.get("activityName", "Run")
        start_gmt = act.get("startTimeGMT")
        
        # Check if activity is running
        if "running" not in act_type and act_type != "run":
            continue
            
        # Check if already present
        gmt_iso = (start_gmt.replace(" ", "T") + "Z") if start_gmt else None
        fit_filename = f"{act_id}_ACTIVITY.fit"
        
        if (gmt_iso and gmt_iso in existing_times) or (fit_filename in existing_filenames):
            continue

        print(f"📥 Downloading new run: '{act_name}' (ID: {act_id}, Date: {start_gmt})...")
        try:
            raw_bytes = garmin.download_activity(act_id, dl_fmt=garmin.ActivityDownloadFormat.ORIGINAL)
            run_data = parse_fit_bytes(raw_bytes, fit_filename, downsample_rate=DOWNSAMPLE_RATE)
            
            if run_data and run_data.get("points"):
                runs.append(run_data)
                existing_times.add(run_data["start_time"])
                existing_filenames.add(fit_filename)
                new_runs_count += 1
                dist_km = round(run_data["distance_meters"] / 1000.0, 2)
                print(f"  ✓ Added: {dist_km} km ({run_data['points_count']} points)")
            else:
                print("  ⚠️ Skipped: Activity contains no valid running track points.")
        except Exception as e:
            print(f"  ❌ Error downloading/parsing activity {act_id}: {e}")

    # 5. Save updated database if new runs added
    force_refresh = "--refresh-segments" in sys.argv
    if new_runs_count > 0:
        runs.sort(key=lambda x: x.get("start_time") or "", reverse=True)
        with open(DB_PATH, 'w') as f:
            json.dump(runs, f)
        print(f"\n🎉 Successfully added {new_runs_count} new run(s)! Database updated ({len(runs)} total runs).")

    # Refresh route segments if new runs were added or explicitly requested
    segments_updated = False
    if new_runs_count > 0 or force_refresh or not os.path.exists(SEGMENTS_PATH):
        refresh_segments(runs)
        segments_updated = True

    # 6. Check git diff for files to commit/push
    diff_check = subprocess.run(["git", "status", "--porcelain", DB_PATH, SEGMENTS_PATH], capture_output=True, text=True)
    has_changes = bool(diff_check.stdout.strip())

    if has_changes:
        auto_push = "--auto-push" in sys.argv or "-y" in sys.argv
        if auto_push:
            push_ans = 'y'
        else:
            try:
                push_ans = input("\nWould you like to commit and push changes to GitHub? [Y/n]: ").strip().lower()
            except (EOFError, KeyboardInterrupt):
                push_ans = 'y'

        if push_ans in ('', 'y', 'yes'):
            try:
                print("git commit & push...")
                subprocess.run(["git", "add", DB_PATH, SEGMENTS_PATH], check=True)
                if new_runs_count > 0:
                    commit_msg = f"Auto-sync Garmin Connect: Added {new_runs_count} new run(s) and refreshed segments"
                else:
                    commit_msg = "Refresh segments analysis and running database"
                subprocess.run(["git", "commit", "-m", commit_msg], check=True)
                
                # Push using custom SSH key if available locally
                ssh_key_path = os.path.expanduser("~/.ssh/github_key")
                env = os.environ.copy()
                if os.path.exists(ssh_key_path):
                    env['GIT_SSH_COMMAND'] = f'ssh -i {ssh_key_path} -o IdentitiesOnly=yes'
                subprocess.run(["git", "push", "origin", "main"], check=True, env=env)
                print("🚀 Successfully pushed updates to GitHub repository!")
            except Exception as e:
                print(f"❌ Git push encountered an error: {e}")
    else:
        print("\n✨ Up to date! No changes to runs or route segments.")

if __name__ == "__main__":
    main()
