/**
 * Garmin RunFlow Heatmap - Main Application Logic (v1.0.0)
 */

document.addEventListener("DOMContentLoaded", () => {
    // State management
    const state = {
        runs: [],
        map: null,
        tiles: {},
        currentTheme: "dark",
        heatmapLayer: null,
        trackLayers: [],
        activeHighlightPolyline: null,
        activeTab: "dashboard",
        heatmapPreset: "neon-orange",
        
        // Heatmap config defaults
        radius: 10,
        blur: 8,
        opacity: 0.8,
        maxIntensity: 35.0,
        showHeatmap: true,
        showTracks: false,

        // Segments config defaults
        segments: [],
        showSegments: true,
        segmentLayer: null,
        activeSegmentPolyline: null
    };

    // DOM Elements
    const elements = {
        headerTotalRuns: document.getElementById("header-total-runs"),
        headerTotalDistance: document.getElementById("header-total-distance"),
        statTotalDuration: document.getElementById("stat-total-duration"),
        statAvgPace: document.getElementById("stat-avg-pace"),
        
        toggleHeatmap: document.getElementById("toggle-heatmap"),
        toggleTracks: document.getElementById("toggle-tracks"),
        inputRadius: document.getElementById("input-radius"),
        inputBlur: document.getElementById("input-blur"),
        inputOpacity: document.getElementById("input-opacity"),
        inputMaxIntensity: document.getElementById("input-max-intensity"),
        
        valRadius: document.getElementById("val-radius"),
        valBlur: document.getElementById("val-blur"),
        valOpacity: document.getElementById("val-opacity"),
        valMaxIntensity: document.getElementById("val-max-intensity"),
        
        runList: document.getElementById("run-list"),
        runsBadge: document.getElementById("runs-badge"),
        segmentList: document.getElementById("segment-list"),
        segmentsBadge: document.getElementById("segments-badge"),
        toggleSegments: document.getElementById("toggle-segments"),
        loadingOverlay: document.getElementById("loading-overlay")
    };

    // Color Gradients Presets for Heatmap
    const colorPresets = {
        "neon-orange": {
            0.4: 'rgba(255, 98, 0, 0.5)',
            0.65: 'rgba(255, 120, 0, 0.8)',
            0.85: 'rgba(255, 180, 0, 0.95)',
            1.0: '#fff'
        },
        "neon-green": {
            0.4: 'rgba(57, 255, 20, 0.5)',
            0.65: 'rgba(0, 255, 100, 0.8)',
            0.85: 'rgba(200, 255, 0, 0.95)',
            1.0: '#fff'
        },
        "neon-blue": {
            0.4: 'rgba(0, 240, 255, 0.5)',
            0.65: 'rgba(0, 150, 255, 0.8)',
            0.85: 'rgba(180, 0, 255, 0.95)',
            1.0: '#fff'
        }
    };

    // Map Tile Layers setup (watermark-free default providers, with optional CARTO API key support)
    const cartoApiKey = (new URLSearchParams(window.location.search)).get("carto_key") || localStorage.getItem("carto_api_key") || "";
    if ((new URLSearchParams(window.location.search)).get("carto_key")) {
        localStorage.setItem("carto_api_key", (new URLSearchParams(window.location.search)).get("carto_key"));
    }

    function createTileLayer(theme) {
        if (theme === "dark") {
            if (cartoApiKey) {
                return L.tileLayer(`https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?api_key=${cartoApiKey}`, {
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
                    maxZoom: 20
                });
            }
            return L.layerGroup([
                L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
                    attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
                    maxZoom: 18
                }),
                L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
                    maxZoom: 18
                })
            ]);
        } else if (theme === "light") {
            if (cartoApiKey) {
                return L.tileLayer(`https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?api_key=${cartoApiKey}`, {
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
                    maxZoom: 20
                });
            }
            return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                maxZoom: 19
            });
        } else if (theme === "satellite") {
            return L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
                attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
                maxZoom: 19
            });
        }
    }

    // 1. Initialize Map
    function initMap() {
        // Create map centered on Seattle
        state.map = L.map("map", {
            zoomControl: true,
            attributionControl: true
        }).setView([47.6062, -122.3321], 11);

        // Add Zoom control at top right
        state.map.zoomControl.setPosition('topright');

        // Create tile layers
        ["dark", "light", "satellite"].forEach(theme => {
            state.tiles[theme] = createTileLayer(theme);
        });

        // Set default dark theme
        state.tiles[state.currentTheme].addTo(state.map);
    }

    // 2. Fetch runs.json
    async function loadData() {
        try {
            const response = await fetch("data/runs.json");
            if (!response.ok) {
                throw new Error("Could not load runs.json database.");
            }
            state.runs = await response.json();
            
            // Format dates (UTC to browser local time)
            state.runs.forEach(run => {
                let timeStr = run.start_time;
                if (timeStr && !timeStr.endsWith('Z') && !timeStr.includes('+') && !timeStr.includes('-')) {
                    timeStr += 'Z';
                }
                run.dateObj = timeStr ? new Date(timeStr) : new Date();
            });
            
            // Sort runs chronologically descending
            state.runs.sort((a, b) => b.dateObj - a.dateObj);
            
            // Load Segments
            try {
                const segResponse = await fetch("data/segments.json");
                if (segResponse.ok) {
                    state.segments = await segResponse.json();
                }
            } catch (e) {
                console.warn("Could not load segments.json:", e);
                state.segments = [];
            }

            // Merge any custom segments saved by the user in localStorage
            try {
                const customSegs = JSON.parse(localStorage.getItem("user_custom_segments") || "[]");
                if (Array.isArray(customSegs) && customSegs.length > 0) {
                    const existingIds = new Set(state.segments.map(s => s.id));
                    customSegs.forEach(cs => {
                        if (!existingIds.has(cs.id)) {
                            state.segments.push(cs);
                            existingIds.add(cs.id);
                        }
                    });
                }
            } catch (e) {
                console.warn("Error reading custom segments from localStorage:", e);
            }

            // Render Stats, Heatmap, Tracks & Segments
            updateDashboardStats();
            renderRunList();
            renderHeatmap();
            renderTracks();
            renderSegments();
            renderSegmentTracks();
            
            // Keep default Seattle view on load (no auto-center override)
            
            // Hide loading screen
            setTimeout(() => {
                elements.loadingOverlay.style.opacity = 0;
                setTimeout(() => {
                    elements.loadingOverlay.style.display = "none";
                }, 500);
            }, 800);

        } catch (error) {
            console.error("Error loading runs:", error);
            elements.runList.innerHTML = `<div class="loading-runs">❌ Failed to load run data: ${error.message}</div>`;
            alert("Failed to load runs.json. Did you run parse_fit.py first?");
        }
    }

    // 3. Format helper functions
    function formatDistance(meters) {
        return (meters / 1000.0).toFixed(2) + " km";
    }

    function formatDuration(seconds) {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        if (hrs > 0) {
            return `${hrs}h ${mins}m`;
        }
        return `${mins} mins`;
    }

    function formatPace(meters, seconds) {
        if (!meters || !seconds) return "0:00 /km";
        const km = meters / 1000.0;
        const totalSecondsPerKm = seconds / km;
        let mins = Math.floor(totalSecondsPerKm / 60);
        let secs = Math.round(totalSecondsPerKm % 60);
        if (secs === 60) {
            mins += 1;
            secs = 0;
        }
        return `${mins}:${secs.toString().padStart(2, '0')} /km`;
    }

    function formatDate(date) {
        const options = { year: 'numeric', month: 'short', day: 'numeric' };
        return date.toLocaleDateString(undefined, options);
    }

    function formatTime(date) {
        const options = { hour: '2-digit', minute: '2-digit' };
        return date.toLocaleTimeString(undefined, options);
    }

    // 4. Update Dashboard Stats
    function updateDashboardStats() {
        if (state.runs.length === 0) return;
        
        let totalDistance = 0;
        let totalDuration = 0;
        
        state.runs.forEach(run => {
            totalDistance += run.distance_meters || 0;
            totalDuration += run.duration_seconds || 0;
        });

        // Populate elements
        elements.headerTotalRuns.innerText = state.runs.length;
        elements.headerTotalDistance.innerText = formatDistance(totalDistance);
        elements.statTotalDuration.innerText = formatDuration(totalDuration);
        elements.statAvgPace.innerText = formatPace(totalDistance, totalDuration);
        elements.runsBadge.innerText = `${state.runs.length} Runs`;
    }

    // 5. Render Run List
    function renderRunList() {
        elements.runList.innerHTML = "";
        
        state.runs.forEach((run, index) => {
            const dateStr = formatDate(run.dateObj);
            const timeStr = formatTime(run.dateObj);
            const distanceStr = formatDistance(run.distance_meters);
            const durationStr = formatDuration(run.duration_seconds);
            const paceStr = formatPace(run.distance_meters, run.duration_seconds);

            const card = document.createElement("div");
            card.className = "run-item";
            card.dataset.index = index;
            card.innerHTML = `
                <div class="run-item-top">
                    <span class="run-date">${dateStr}</span>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span class="run-time">${timeStr}</span>
                        <button class="btn-star-run" title="Bookmark as a Segment" data-index="${index}">
                            <i class="fa-regular fa-star"></i>
                        </button>
                    </div>
                </div>
                <div class="run-stats-row">
                    <div class="run-sub-stat">
                        <span class="val">${distanceStr}</span>
                        <span class="lbl">Dist</span>
                    </div>
                    <div class="run-sub-stat">
                        <span class="val">${durationStr}</span>
                        <span class="lbl">Time</span>
                    </div>
                    <div class="run-sub-stat">
                        <span class="val">${paceStr}</span>
                        <span class="lbl">Pace</span>
                    </div>
                </div>
            `;

            // Star button to save run as a custom segment
            const starBtn = card.querySelector(".btn-star-run");
            if (starBtn) {
                starBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    saveRunAsSegment(run);
                });
            }

            // Hover effects (highlight track line on map)
            card.addEventListener("mouseenter", () => {
                highlightTrack(index);
            });
            card.addEventListener("mouseleave", () => {
                removeHighlightTrack();
            });

            // Click effect (pan/zoom to track)
            card.addEventListener("click", () => {
                // Remove active classes
                document.querySelectorAll(".run-item").forEach(item => item.classList.remove("active"));
                card.classList.add("active");
                
                zoomToRun(index);
            });

            elements.runList.appendChild(card);
        });
    }

    // 5b. Render Segments List
    function renderSegments() {
        if (!elements.segmentList) return;
        elements.segmentList.innerHTML = "";
        if (elements.segmentsBadge) {
            elements.segmentsBadge.innerText = `${state.segments.length} Segments`;
        }

        if (state.segments.length === 0) {
            elements.segmentList.innerHTML = `
                <div class="loading-runs" style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 20px 0;">
                    <i class="fa-solid fa-trophy" style="font-size: 24px; margin-bottom: 8px; opacity: 0.5;"></i><br>
                    No segments saved yet.<br>Click the star <i class="fa-regular fa-star"></i> on any run in the Runs tab to save it as a segment!
                </div>`;
            return;
        }

        state.segments.forEach((seg, index) => {
            const distKm = (seg.distance_meters / 1000.0).toFixed(2) + " km";
            const mins = Math.floor(seg.duration_seconds / 60);
            const secs = Math.round(seg.duration_seconds % 60);
            const prStr = `${mins}:${secs.toString().padStart(2, '0')}`;
            const paceStr = formatPace(seg.distance_meters, seg.duration_seconds);

            const card = document.createElement("div");
            card.className = "segment-item";
            card.dataset.index = index;
            card.innerHTML = `
                <div class="segment-item-top">
                    <span class="segment-name"><i class="fa-solid fa-flag-checkered"></i> ${seg.name}</span>
                    <span class="segment-badge-attempts">${seg.attempts || 1} run${(seg.attempts || 1) > 1 ? 's' : ''}</span>
                </div>
                <div class="segment-desc">${seg.description || 'Custom segment from Garmin history'}</div>
                <div class="segment-stats-row">
                    <div class="segment-sub-stat">
                        <span class="val">${distKm}</span>
                        <span class="lbl">Dist</span>
                    </div>
                    <div class="segment-sub-stat">
                        <span class="val pr"><i class="fa-solid fa-crown" style="font-size:10px;"></i> ${prStr}</span>
                        <span class="lbl">Best Time</span>
                    </div>
                    <div class="segment-sub-stat">
                        <span class="val">${paceStr}</span>
                        <span class="lbl">PR Pace</span>
                    </div>
                </div>
            `;

            // Hover effects
            card.addEventListener("mouseenter", () => {
                highlightSegment(index);
            });
            card.addEventListener("mouseleave", () => {
                removeHighlightSegment();
            });

            // Click effect (zoom to segment)
            card.addEventListener("click", () => {
                document.querySelectorAll(".segment-item").forEach(item => item.classList.remove("active"));
                card.classList.add("active");
                zoomToSegment(seg);
            });

            elements.segmentList.appendChild(card);
        });
    }

    // Render Segment Tracks on Map
    function renderSegmentTracks() {
        if (!state.map) return;
        if (state.segmentLayer) {
            state.map.removeLayer(state.segmentLayer);
        }

        state.segmentLayer = L.layerGroup();

        state.segments.forEach((seg, index) => {
            if (!seg.points || seg.points.length === 0) return;
            const latlngs = seg.points.map(p => [p.lat, p.lng]);

            // Glow line underneath
            const glowLine = L.polyline(latlngs, {
                color: "#00f0ff",
                weight: 7,
                opacity: 0.35,
                lineCap: "round",
                lineJoin: "round"
            });

            // Crisp line on top
            const coreLine = L.polyline(latlngs, {
                color: "#ffffff",
                weight: 3.5,
                dashArray: "8, 6",
                opacity: 0.95,
                lineCap: "round",
                lineJoin: "round"
            });

            // Start & Finish Markers
            const startPt = latlngs[0];
            const finishPt = latlngs[latlngs.length - 1];

            const startIcon = L.divIcon({
                className: "custom-div-icon",
                html: `<div class="segment-marker start" title="Start">S</div>`,
                iconSize: [22, 22],
                iconAnchor: [11, 11]
            });
            const finishIcon = L.divIcon({
                className: "custom-div-icon",
                html: `<div class="segment-marker finish" title="Finish">F</div>`,
                iconSize: [22, 22],
                iconAnchor: [11, 11]
            });

            const startMarker = L.marker(startPt, { icon: startIcon });
            const finishMarker = L.marker(finishPt, { icon: finishIcon });

            const distKm = (seg.distance_meters / 1000.0).toFixed(2) + " km";
            coreLine.bindTooltip(`<b>${seg.name}</b><br>${distKm} &bull; ${seg.attempts || 1} attempts`, {
                sticky: true,
                className: "hud-tooltip"
            });

            coreLine.on("click", () => {
                zoomToSegment(seg);
                // Switch to segments tab and highlight card
                const segBtn = document.querySelector('.tab-btn[data-tab="segments"]');
                if (segBtn) segBtn.click();
                const card = document.querySelector(`.segment-item[data-index="${index}"]`);
                if (card) {
                    document.querySelectorAll(".segment-item").forEach(item => item.classList.remove("active"));
                    card.classList.add("active");
                    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
                }
            });

            state.segmentLayer.addLayer(glowLine);
            state.segmentLayer.addLayer(coreLine);
            state.segmentLayer.addLayer(startMarker);
            state.segmentLayer.addLayer(finishMarker);
        });

        if (state.showSegments) {
            state.segmentLayer.addTo(state.map);
        }
    }

    function zoomToSegment(seg) {
        if (!seg || !seg.points || seg.points.length === 0) return;
        const latlngs = seg.points.map(pt => [pt.lat, pt.lng]);
        const bounds = L.latLngBounds(latlngs);
        state.map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
        highlightSegmentPolyline(latlngs);
    }

    function highlightSegment(index) {
        removeHighlightSegment();
        const seg = state.segments[index];
        if (!seg || !seg.points || seg.points.length === 0) return;
        const latlngs = seg.points.map(pt => [pt.lat, pt.lng]);
        highlightSegmentPolyline(latlngs);
    }

    function highlightSegmentPolyline(latlngs) {
        removeHighlightSegment();
        state.activeSegmentPolyline = L.polyline(latlngs, {
            color: "#00f0ff",
            weight: 7,
            opacity: 1.0,
            lineCap: "round",
            lineJoin: "round"
        }).addTo(state.map);
    }

    function removeHighlightSegment() {
        if (state.activeSegmentPolyline) {
            state.map.removeLayer(state.activeSegmentPolyline);
            state.activeSegmentPolyline = null;
        }
    }

    function saveRunAsSegment(run) {
        const defaultName = `Route (${formatDistance(run.distance_meters)})`;
        const segName = prompt("Enter a name for this Segment:", defaultName);
        if (!segName || !segName.trim()) return;

        const dateStr = formatDate(run.dateObj);
        const newSeg = {
            id: "custom-" + Date.now(),
            name: segName.trim(),
            description: `Saved from run on ${dateStr}`,
            distance_meters: run.distance_meters,
            duration_seconds: run.duration_seconds,
            attempts: 1,
            best_date: run.start_time,
            points: run.points
        };

        state.segments.unshift(newSeg);

        // Persist to localStorage
        try {
            const customSegs = JSON.parse(localStorage.getItem("user_custom_segments") || "[]");
            customSegs.unshift(newSeg);
            localStorage.setItem("user_custom_segments", JSON.stringify(customSegs));
        } catch (e) {
            console.warn("Failed to persist custom segment:", e);
        }

        renderSegments();
        renderSegmentTracks();

        // Switch to Segments tab and highlight
        const segTabBtn = document.querySelector('.tab-btn[data-tab="segments"]');
        if (segTabBtn) segTabBtn.click();

        zoomToSegment(newSeg);
        alert(`🎉 '${newSeg.name}' saved as a segment!`);
    }

    // 6. Heatmap Layer rendering
    function renderHeatmap() {
        // Flatten all coordinates from all runs
        const heatPoints = [];
        state.runs.forEach(run => {
            if (run.points && run.points.length > 0) {
                run.points.forEach(point => {
                    heatPoints.push([point.lat, point.lng, 1.0]); // Lat, Lng, Intensity
                });
            }
        });

        // Initialize or update layer
        if (state.heatmapLayer) {
            state.map.removeLayer(state.heatmapLayer);
        }

        // Create Leaflet Heatmap
        state.heatmapLayer = L.heatLayer(heatPoints, {
            radius: state.radius,
            blur: state.blur,
            maxZoom: 17,
            max: state.maxIntensity,
            gradient: colorPresets[state.heatmapPreset]
        });

        // Add to map if toggled on
        if (state.showHeatmap) {
            state.heatmapLayer.addTo(state.map);
            
            // Set initial canvas container opacity after render
            setTimeout(() => {
                const container = document.querySelector(".leaflet-heatmap-layer");
                if (container) {
                    container.style.opacity = state.opacity;
                }
            }, 50);
        }
    }

    // 7. Track Layer (Individual lines) rendering
    function renderTracks() {
        // Remove existing tracks
        state.trackLayers.forEach(layer => state.map.removeLayer(layer));
        state.trackLayers = [];

        state.runs.forEach(run => {
            if (run.points && run.points.length > 0) {
                const latlngs = run.points.map(pt => [pt.lat, pt.lng]);
                
                const polyline = L.polyline(latlngs, {
                    color: state.heatmapPreset === 'neon-orange' ? '#ff6200' : (state.heatmapPreset === 'neon-green' ? '#39ff14' : '#00f0ff'),
                    weight: 2.5,
                    opacity: 0.5,
                    lineJoin: 'round'
                });

                state.trackLayers.push(polyline);
                
                if (state.showTracks) {
                    polyline.addTo(state.map);
                }
            }
        });
    }

    // 8. Highlight Track on hover
    function highlightTrack(index) {
        removeHighlightTrack();
        
        const run = state.runs[index];
        if (!run || !run.points || run.points.length === 0) return;

        const latlngs = run.points.map(pt => [pt.lat, pt.lng]);
        
        // Draw a thick glowing line
        state.activeHighlightPolyline = L.polyline(latlngs, {
            color: '#fff',
            weight: 4,
            opacity: 0.9,
            lineJoin: 'round',
            shadowColor: state.heatmapPreset === 'neon-orange' ? '#ff6200' : (state.heatmapPreset === 'neon-green' ? '#39ff14' : '#00f0ff'),
            shadowBlur: 10
        }).addTo(state.map);
    }

    function removeHighlightTrack() {
        if (state.activeHighlightPolyline) {
            state.map.removeLayer(state.activeHighlightPolyline);
            state.activeHighlightPolyline = null;
        }
    }

    // 9. Zoom and Center to a specific run
    function zoomToRun(index) {
        const run = state.runs[index];
        if (!run || !run.points || run.points.length === 0) return;

        const latlngs = run.points.map(pt => [pt.lat, pt.lng]);
        const bounds = L.latLngBounds(latlngs);
        state.map.fitBounds(bounds, { padding: [50, 50] });
    }

    // 10. Fit Map Bounds to fit ALL runs
    function fitMapToBounds() {
        if (state.runs.length === 0) return;

        const allLatLngs = [];
        state.runs.forEach(run => {
            if (run.points) {
                run.points.forEach(pt => {
                    allLatLngs.push([pt.lat, pt.lng]);
                });
            }
        });

        if (allLatLngs.length > 0) {
            const bounds = L.latLngBounds(allLatLngs);
            state.map.fitBounds(bounds, { padding: [40, 40] });
        }
    }

    // 11. Event Listeners for UI Controls
    function setupControls() {
        // Tab switching
        document.querySelectorAll(".tab-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                // Set active class
                document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");

                // Show active tab content
                const tabId = btn.dataset.tab;
                document.querySelectorAll(".tab-content").forEach(tc => tc.classList.remove("active"));
                document.getElementById(`tab-${tabId}`).classList.add("active");
                state.activeTab = tabId;
            });
        });

        // Toggle Heatmap Checkbox
        elements.toggleHeatmap.addEventListener("change", (e) => {
            state.showHeatmap = e.target.checked;
            if (state.showHeatmap) {
                state.heatmapLayer.addTo(state.map);
            } else {
                state.map.removeLayer(state.heatmapLayer);
            }
        });

        // Toggle Tracks Checkbox
        elements.toggleTracks.addEventListener("change", (e) => {
            state.showTracks = e.target.checked;
            state.trackLayers.forEach(layer => {
                if (state.showTracks) {
                    layer.addTo(state.map);
                } else {
                    state.map.removeLayer(layer);
                }
            });
        });

        // Toggle Segments Checkbox
        if (elements.toggleSegments) {
            elements.toggleSegments.addEventListener("change", (e) => {
                state.showSegments = e.target.checked;
                if (state.showSegments) {
                    if (state.segmentLayer) state.segmentLayer.addTo(state.map);
                } else {
                    if (state.segmentLayer) state.map.removeLayer(state.segmentLayer);
                }
            });
        }

        // Heatmap Radius Slider
        elements.inputRadius.addEventListener("input", (e) => {
            state.radius = parseInt(e.target.value);
            elements.valRadius.innerText = `${state.radius}px`;
            if (state.heatmapLayer) {
                state.heatmapLayer.setOptions({ radius: state.radius });
            }
        });

        // Heatmap Blur Slider
        elements.inputBlur.addEventListener("input", (e) => {
            state.blur = parseInt(e.target.value);
            elements.valBlur.innerText = `${state.blur}px`;
            if (state.heatmapLayer) {
                state.heatmapLayer.setOptions({ blur: state.blur });
            }
        });

        // Heatmap Opacity Slider
        elements.inputOpacity.addEventListener("input", (e) => {
            state.opacity = parseFloat(e.target.value) / 10.0;
            elements.valOpacity.innerText = state.opacity.toFixed(1);
            
            // Adjust opacity of the layer container
            const container = document.querySelector(".leaflet-heatmap-layer");
            if (container) {
                container.style.opacity = state.opacity;
            }
        });

        // Heatmap Max Intensity (Contrast) Slider
        elements.inputMaxIntensity.addEventListener("input", (e) => {
            state.maxIntensity = parseFloat(e.target.value) / 10.0;
            elements.valMaxIntensity.innerText = state.maxIntensity.toFixed(1);
            if (state.heatmapLayer) {
                state.heatmapLayer.setOptions({ max: state.maxIntensity });
            }
        });

        // Theme switching (Map Background)
        document.querySelectorAll(".theme-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                document.querySelectorAll(".theme-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");

                const theme = btn.dataset.theme;
                state.map.removeLayer(state.tiles[state.currentTheme]);
                state.tiles[theme].addTo(state.map);
                state.currentTheme = theme;
            });
        });

        // Color Presets switching
        document.querySelectorAll(".color-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                document.querySelectorAll(".color-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");

                const preset = btn.dataset.color;
                state.heatmapPreset = preset;
                
                // Re-render heatmap & tracks
                renderHeatmap();
                renderTracks();
            });
        });
    }

    // Run Initialization
    initMap();
    setupControls();
    loadData();
});
