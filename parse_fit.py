#!/usr/bin/env python3
import os
import sys
import json
import argparse
from datetime import datetime
from fitparse import FitFile

def convert_semicircles(semicircles):
    if semicircles is None:
        return None
    # Semicircles to degrees: degrees = semicircles * (180 / 2^31)
    return float(semicircles) * (180.0 / 2147483648.0)

def parse_fit_file(file_path, downsample_rate=1):
    """
    Parses a single .fit file and extracts GPS coordinates and metadata.
    """
    print(f"Parsing {os.path.basename(file_path)}...")
    try:
        fitfile = FitFile(file_path)
    except Exception as e:
        print(f"  ❌ Failed to read FIT file structure: {e}", file=sys.stderr)
        return None

    points = []
    start_time = None
    end_time = None
    
    # Process records
    record_count = 0
    valid_coord_count = 0
    
    for message in fitfile.get_messages('record'):
        record_count += 1
        values = message.get_values()
        
        raw_lat = values.get('position_lat')
        raw_lng = values.get('position_long')
        timestamp = values.get('timestamp')
        
        # We need at least valid coordinates
        if raw_lat is None or raw_lng is None:
            continue
            
        valid_coord_count += 1
        
        # Apply downsampling
        if valid_coord_count % downsample_rate != 0:
            continue
            
        lat = convert_semicircles(raw_lat)
        lng = convert_semicircles(raw_lng)
        
        if lat is None or lng is None:
            continue
            
        # Bounds check for valid coordinates
        if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lng <= 180.0):
            continue

        point = {
            "lat": round(lat, 6),
            "lng": round(lng, 6)
        }
        
        if timestamp:
            # ISO timestamp string
            if isinstance(timestamp, datetime):
                point["time"] = timestamp.isoformat()
                if start_time is None or timestamp < start_time:
                    start_time = timestamp
                if end_time is None or timestamp > end_time:
                    end_time = timestamp
            else:
                point["time"] = str(timestamp)
                
        # Optional fields
        altitude = values.get('altitude')
        if altitude is not None:
            point["alt"] = round(float(altitude), 1)
            
        speed = values.get('speed')
        if speed is not None:
            point["speed"] = round(float(speed), 2)

        points.append(point)

    # If no valid coordinates found, skip this run
    if not points:
        print(f"  ⚠️ No GPS records found in {os.path.basename(file_path)}")
        return None

    # Retrieve session metadata if available
    session_distance = 0.0
    session_duration = 0.0
    
    for message in fitfile.get_messages('session'):
        values = message.get_values()
        if values.get('total_distance') is not None:
            session_distance = float(values.get('total_distance')) # in meters
        if values.get('total_timer_time') is not None:
            session_duration = float(values.get('total_timer_time')) # in seconds
            
    # Fallback duration calculation
    if session_duration == 0.0 and start_time and end_time:
        session_duration = (end_time - start_time).total_seconds()

    filename = os.path.basename(file_path)
    
    run_summary = {
        "filename": filename,
        "start_time": start_time.isoformat() if start_time else None,
        "end_time": end_time.isoformat() if end_time else None,
        "distance_meters": round(session_distance, 1),
        "duration_seconds": round(session_duration, 1),
        "points_count": len(points),
        "points": points
    }
    
    print(f"  ✓ Found {len(points)} GPS points (parsed from {record_count} records). Distance: {round(session_distance / 1000.0, 2)} km")
    return run_summary

def main():
    parser = argparse.ArgumentParser(description="Parse Garmin FIT files into a JSON dataset for web mapping.")
    parser.add_argument("--src", required=True, help="Directory containing .fit files")
    parser.add_argument("--out", required=True, help="Output runs.json path")
    parser.add_argument("--downsample", type=int, default=1, help="Downsample points (keep every Nth point, default: 1)")
    
    args = parser.parse_args()
    
    if not os.path.isdir(args.src):
        print(f"Error: Source directory '{args.src}' does not exist.")
        sys.exit(1)
        
    fit_files = [os.path.join(args.src, f) for f in os.listdir(args.src) if f.lower().endswith('.fit')]
    
    if not fit_files:
        print(f"No .fit files found in '{args.src}'.")
        sys.exit(0)
        
    print(f"Found {len(fit_files)} FIT files in {args.src}")
    
    runs = []
    for filepath in sorted(fit_files):
        run_data = parse_fit_file(filepath, args.downsample)
        if run_data:
            runs.append(run_data)
            
    if not runs:
        print("No valid runs were parsed. Output file will not be created.")
        sys.exit(0)
        
    # Ensure output directory exists
    out_dir = os.path.dirname(args.out)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        
    with open(args.out, 'w') as f:
        json.dump(runs, f, indent=2)
        
    print(f"\n🎉 Successfully parsed {len(runs)} runs and wrote to {args.out}")

if __name__ == "__main__":
    main()
