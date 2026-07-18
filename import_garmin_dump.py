#!/usr/bin/env python3
import os
import sys
import json
import zipfile
import argparse
from io import BytesIO
from datetime import datetime
from fitparse import FitFile
from concurrent.futures import ProcessPoolExecutor

def convert_semicircles(semicircles):
    if semicircles is None:
        return None
    return float(semicircles) * (180.0 / 2147483648.0)

def parse_fit_bytes(args_tuple):
    """
    Parses FIT file bytes in a separate process.
    args_tuple: (file_bytes, filename, downsample_rate)
    """
    file_bytes, filename, downsample_rate = args_tuple
    try:
        fitfile = FitFile(BytesIO(file_bytes))
    except Exception:
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
        
        if lat is None or lng is None:
            continue
            
        if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lng <= 180.0):
            continue

        point = {
            "lat": round(lat, 6),
            "lng": round(lng, 6)
        }
        
        if timestamp and isinstance(timestamp, datetime):
            if start_time is None or timestamp < start_time:
                start_time = timestamp
            if end_time is None or timestamp > end_time:
                end_time = timestamp

        points.append(point)

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
        "start_time": start_time.isoformat() if start_time else None,
        "end_time": end_time.isoformat() if end_time else None,
        "distance_meters": round(session_distance, 1),
        "duration_seconds": round(session_duration, 1),
        "points_count": len(points),
        "points": points
    }

def main():
    parser = argparse.ArgumentParser(description="Extract and parse running activities from a Garmin Connect export dump.")
    parser.add_argument("--dump-dir", required=True, help="Path to the extracted Garmin Connect dump folder")
    parser.add_argument("--manual-dir", help="Path to manual FIT files directory")
    parser.add_argument("--out", required=True, help="Path to save the output runs.json")
    parser.add_argument("--downsample", type=int, default=1, help="Downsample coordinates (keep every Nth point, default: 1)")
    parser.add_argument("--chunk-size", type=int, help="Chunk size for parsing candidate runs")
    parser.add_argument("--chunk-index", type=int, help="Chunk index for parsing candidate runs")
    
    args = parser.parse_args()
    
    seen_start_times = set()
    runs = []
    
    # 1. Parse manual files if provided (only for chunk 0 or if chunking is not used)
    should_parse_manual = True
    if args.chunk_index is not None and args.chunk_index != 0:
        should_parse_manual = False
        
    if should_parse_manual and args.manual_dir and os.path.isdir(args.manual_dir):
        print(f"Scanning manual FIT files in {args.manual_dir}...")
        manual_files = [os.path.join(args.manual_dir, f) for f in os.listdir(args.manual_dir) if f.lower().endswith('.fit')]
        
        # Read bytes for manual files
        manual_jobs = []
        for filepath in sorted(manual_files):
            filename = os.path.basename(filepath)
            with open(filepath, 'rb') as f:
                manual_jobs.append((f.read(), filename, args.downsample))
                
        # Parse manual files in parallel
        if manual_jobs:
            with ProcessPoolExecutor() as executor:
                results = executor.map(parse_fit_bytes, manual_jobs)
                for run_data in results:
                    if run_data and run_data["start_time"]:
                        if run_data["start_time"] not in seen_start_times:
                            seen_start_times.add(run_data["start_time"])
                            runs.append(run_data)
                            print(f"  ✓ Parsed manual run: {run_data['filename']} ({round(run_data['distance_meters'] / 1000.0, 2)} km)")
                        
    # 2. Parse ZIP archives in Garmin dump
    uploads_dir = os.path.join(args.dump_dir, "DI_CONNECT", "DI-Connect-Uploaded-Files")
    if os.path.isdir(uploads_dir):
        zip_files = [os.path.join(uploads_dir, f) for f in os.listdir(uploads_dir) if f.lower().endswith('.zip')]
        print(f"\nScanning {len(zip_files)} ZIP files in Garmin dump...")
        
        all_infos = []
        for zip_path in zip_files:
            print(f"Reading index of {os.path.basename(zip_path)}...")
            with zipfile.ZipFile(zip_path, 'r') as zf:
                infos = [info for info in zf.infolist() if info.file_size > 15000 and info.filename.lower().endswith('.fit')]
                for info in infos:
                    all_infos.append((zip_path, info))
                    
        print(f"  Found a total of {len(all_infos)} candidate files > 15KB across all ZIPs.")
        
        # Apply chunking if requested
        if args.chunk_size is not None and args.chunk_index is not None:
            start_idx = args.chunk_index * args.chunk_size
            end_idx = start_idx + args.chunk_size
            print(f"Applying chunking: keeping candidate files {start_idx} to {end_idx} out of {len(all_infos)}")
            all_infos = all_infos[start_idx:end_idx]
            
        # Group by zip_path to open each ZIP only once for loading bytes
        from collections import defaultdict
        by_zip = defaultdict(list)
        for zip_path, info in all_infos:
            by_zip[zip_path].append(info)
            
        zip_jobs = []
        for zip_path, infos in by_zip.items():
            print(f"Loading bytes for {len(infos)} files from {os.path.basename(zip_path)}...")
            with zipfile.ZipFile(zip_path, 'r') as zf:
                for info in infos:
                    file_bytes = zf.read(info.filename)
                    zip_jobs.append((file_bytes, os.path.basename(info.filename), args.downsample))
                    
        # Parse ZIP fit files in parallel
        if zip_jobs:
            print(f"Parsing {len(zip_jobs)} candidate runs in parallel...")
            with ProcessPoolExecutor() as executor:
                results = executor.map(parse_fit_bytes, zip_jobs)
                for run_data in results:
                    if run_data and run_data["start_time"]:
                        if run_data["start_time"] not in seen_start_times:
                            seen_start_times.add(run_data["start_time"])
                            runs.append(run_data)
                            print(f"  ✓ Parsed run: {run_data['filename']} ({round(run_data['distance_meters'] / 1000.0, 2)} km)")
                        
    if not runs:
        print("\n⚠️ No runs were successfully parsed.")
        sys.exit(0)
        
    # Sort runs chronologically descending
    runs.sort(key=lambda x: x["start_time"] or "", reverse=True)
    
    # Save output JSON
    out_dir = os.path.dirname(args.out)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        
    with open(args.out, 'w') as f:
        json.dump(runs, f)
        
    print(f"\n🎉 Successfully parsed and combined {len(runs)} unique runs into {args.out}")

if __name__ == "__main__":
    main()
