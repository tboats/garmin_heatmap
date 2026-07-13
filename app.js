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
        showTracks: false
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

    // Theme URLs (Map Tile layers)
    const mapTiles = {
        dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        light: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
        satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
    };

    const tileAttributions = {
        dark: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        light: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        satellite: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
    };

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
        Object.keys(mapTiles).forEach(theme => {
            state.tiles[theme] = L.tileLayer(mapTiles[theme], {
                attribution: tileAttributions[theme],
                maxZoom: 20
            });
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
            
            // Format dates
            state.runs.forEach(run => {
                run.dateObj = run.start_time ? new Date(run.start_time) : new Date();
            });
            
            // Sort runs chronologically descending
            state.runs.sort((a, b) => b.dateObj - a.dateObj);
            
            // Render Stats & Heatmap
            updateDashboardStats();
            renderRunList();
            renderHeatmap();
            renderTracks();
            
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
        const mins = Math.floor(totalSecondsPerKm / 60);
        const secs = Math.round(totalSecondsPerKm % 60);
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
                    <span class="run-time">${timeStr}</span>
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
