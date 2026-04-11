// ============================================================================
// 🗺️ ResQ Map & Simulation Engine (Advanced Dynamic Module)
// ============================================================================

const savedSimConfig = JSON.parse(localStorage.getItem('resq_sim_config') || '{}');
export const SIM_CONFIG = {
    AMBULANCE_SPEED_KPH: savedSimConfig.AMBULANCE_SPEED_KPH || 600, 
    CAR_SPEED_KPH: savedSimConfig.CAR_SPEED_KPH || 200,
    PATROL_RADIUS: savedSimConfig.PATROL_RADIUS || 0.03,
    ROAMING_RADIUS: savedSimConfig.PATROL_RADIUS ? savedSimConfig.PATROL_RADIUS * 2 : 0.06,
    OSRM_URL: 'https://router.project-osrm.org/route/v1/driving/'
};

export const MapEngine = {
    map: null,
    layerGroups: { hospitals: null, ambulances: null, incidents: null, devices: null, routes: null },
    markers: { hospitals: {}, ambulances: {}, incidents: {}, devices: {} },
    routes: {},
    activeTasks: {},
    trafficLayerGroup: null,
    heatmapLayerGroup: null,
    trackedEntity: null, 
    incidentRoutes: {},

    // استخراج الإحداثيات الحية بدقة تامة (تستخدم لزرع الحادث فوق السيارة)
    getEntityLatLng(type, id) {
        const marker = this.markers[type]?.[String(id)];
        if (marker) {
            const latLng = marker.getLatLng();
            return { lat: latLng.lat, lng: latLng.lng };
        }
        return null;
    },

    setMarkerVisible(type, id, isVisible) {
        const strId = String(id);
        const marker = this.markers[type]?.[strId];
        if (!marker) return;
        if (isVisible && !this.layerGroups[type].hasLayer(marker)) {
            this.layerGroups[type].addLayer(marker);
        } else if (!isVisible && this.layerGroups[type].hasLayer(marker)) {
            this.layerGroups[type].removeLayer(marker);
        }
    },

    async toggleIncidentRoute(incId, ambLat, ambLng, incLat, incLng, hospLat, hospLng, color, isVisible) {
        const strId = String(incId);
        if (!isVisible) {
            if (this.incidentRoutes[strId]) {
                this.layerGroups.routes.removeLayer(this.incidentRoutes[strId]);
                delete this.incidentRoutes[strId];
            }
            return;
        }
        if (this.incidentRoutes[strId]) return; 

        try {
            const url = `${SIM_CONFIG.OSRM_URL}${ambLng},${ambLat};${incLng},${incLat};${hospLng},${hospLat}?overview=full&geometries=geojson`;
            const res = await fetch(url);
            const data = await res.json();
            
            if (data.routes && data.routes.length > 0) {
                const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
                const polyline = L.polyline(coords, {
                    color: color, weight: 6, opacity: 0.8, dashArray: '10, 10', lineCap: 'round'
                }).addTo(this.layerGroups.routes); 
                this.incidentRoutes[strId] = polyline;
            }
        } catch(e) { console.error("Failed to draw rescue route", e); }
    },
    
    init(containerId, centerLat = 30.0444, centerLng = 31.2357, onMarkerClick) {
        if(this.map) return; 
        this.map = L.map(containerId, { zoomControl: false }).setView([centerLat, centerLng], 12);
        L.control.zoom({ position: 'bottomright' }).addTo(this.map);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(this.map);
        
        this.layerGroups.hospitals = L.layerGroup().addTo(this.map);
        this.layerGroups.ambulances = L.layerGroup().addTo(this.map);
        this.layerGroups.incidents = L.layerGroup().addTo(this.map);
        this.layerGroups.routes = L.layerGroup().addTo(this.map);
        this.layerGroups.devices = L.layerGroup(); 

        this.onMarkerClick = onMarkerClick; 
    },

    toggleLayer(layerName, isVisible) {
        if (!this.layerGroups[layerName]) return;
        if (isVisible) this.map.addLayer(this.layerGroups[layerName]);
        else this.map.removeLayer(this.layerGroups[layerName]);
    },

    getAmbIcon(color, status) {
        let baseColor = status === 'available' || status === 'idle' ? 'bg-blue-500' : (status === 'assigned' ? 'bg-warning' : (status === 'returning' ? 'bg-gray-500' : 'bg-purple-500'));
        let pulseHtml = status === 'assigned' ? `<div class="absolute -inset-2 rounded-full border-2 border-warning animate-ping opacity-50"></div>` : '';
        return L.divIcon({
            className: 'custom-div-icon',
            html: `<div class="relative w-8 h-8 ${baseColor} rounded-xl shadow-lg border-2 border-white dark:border-gray-800 flex items-center justify-center transform transition-transform duration-500 hover:scale-110 z-20">${pulseHtml}<i class="fa-solid fa-truck-medical text-white text-xs"></i></div>`,
            iconSize: [32, 32], iconAnchor: [16, 16] 
        });
    },

    getHospIcon() {
        return L.divIcon({
            className: 'custom-div-icon',
            html: `<div class="w-10 h-10 bg-white dark:bg-gray-800 rounded-full shadow-xl border-2 border-green-500 flex items-center justify-center z-10"><i class="fa-solid fa-hospital text-green-500 text-lg"></i></div>`,
            iconSize: [40, 40], iconAnchor: [20, 20] 
        });
    },

    getIncIcon(status) {
        let color = status === 'completed' ? 'bg-gray-500' : 'bg-red-600';
        let pulse = status === 'pending' ? `<div class="absolute inset-0 bg-red-600 rounded-full animate-ping opacity-75"></div>` : '';
        return L.divIcon({
            className: 'custom-inc-icon',
            html: `<div class="relative w-8 h-8">
                     ${pulse}
                     <div class="relative z-10 w-full h-full ${color} rounded-full border-2 border-white flex items-center justify-center shadow-lg">
                         <i class="fa-solid fa-car-burst text-white text-sm"></i>
                     </div>
                   </div>`,
            iconSize: [32, 32], iconAnchor: [16, 16] 
        });
    },

    getDevIcon() {
        return L.divIcon({
            className: 'custom-div-icon',
            html: `<div class="w-8 h-8 bg-gray-600 rounded-full border-2 border-white flex items-center justify-center shadow-lg"><i class="fa-solid fa-car text-white text-sm"></i></div>`,
            iconSize: [32, 32], iconAnchor: [16, 16] 
        });
    },

    getIconForType(type, item) {
        if(type === 'hospitals') return this.getHospIcon();
        if(type === 'ambulances') return this.getAmbIcon('#3b82f6', item.status);
        if(type === 'incidents') return this.getIncIcon(item.status);
        if(type === 'devices') return this.getDevIcon();
        return new L.Icon.Default();
    },

    updateMarkers(type, dataList) {
        let filteredData = dataList;
        if (type === 'incidents') {
            filteredData = dataList.filter(inc => inc.status !== 'completed' && inc.status !== 'canceled');
        }

        const currentIds = new Set(filteredData.map(item => String(item.id)));
        
        for (let id in this.markers[type]) {
            if (!currentIds.has(String(id))) {
                this.layerGroups[type].removeLayer(this.markers[type][id]);
                delete this.markers[type][id];
            }
        }
        
        // 🌟 التنظيف التلقائي لمسارات الحوادث المنتهية 🌟
        if (type === 'incidents') {
            Object.keys(this.incidentRoutes).forEach(routeId => {
                if (!currentIds.has(routeId)) {
                    this.layerGroups.routes.removeLayer(this.incidentRoutes[routeId]);
                    delete this.incidentRoutes[routeId];
                }
            });
        }
        
        filteredData.forEach(item => {
            const id = String(item.id);
            const lat = parseFloat(item.lat || item.latitude);
            const lng = parseFloat(item.lng || item.longitude);
            
            if(!isNaN(lat) && !isNaN(lng)) {
                if (!this.markers[type][id]) {
                    const icon = this.getIconForType(type, item);
                    const marker = L.marker([lat, lng], { icon: icon });
                    if (item.heading && typeof marker.setRotationAngle === 'function') marker.setRotationAngle(item.heading);
                    
                    marker.on('click', () => { if(this.onMarkerClick) this.onMarkerClick(type, id); });
                    marker.addTo(this.layerGroups[type]);
                    this.markers[type][id] = marker;
                } else {
                    if (!this.activeTasks[`${type}_${id}`]) {
                        this.markers[type][id].setLatLng([lat, lng]);
                    }
                    if (item.heading && typeof this.markers[type][id].setRotationAngle === 'function') this.markers[type][id].setRotationAngle(item.heading);
                    
                    if(type !== 'devices') {
                        const newIcon = this.getIconForType(type, item);
                        this.markers[type][id].setIcon(newIcon);
                    }
                }
            }
        });
    },

    focusOnEntity(type, id) {
        const coords = this.getEntityLatLng(type, id);
        if (coords) {
            this.map.flyTo([coords.lat, coords.lng], 16, { animate: true, duration: 0.8 });
        }
    },

    toggleTracking(type, id) {
        const entityKey = `${type}_${id}`;
        if (this.trackedEntity === entityKey) {
            this.trackedEntity = null; 
            return false;
        } else {
            this.trackedEntity = entityKey;
            this.focusOnEntity(type, id); 
            return true;
        }
    },

    async simulateMovementAlongRoad(type, id, startLat, startLng, targetLat, targetLng, baseSpeedKph, onUpdate, useRouting = false) {
        const strId = String(id);
        const taskKey = `${type}_${strId}`;
        
        // منع التكرار
        if (this.activeTasks[taskKey]) return;
        this.activeTasks[taskKey] = "loading"; // حالة مبدئية

        const sLat = parseFloat(startLat);
        const sLng = parseFloat(startLng);
        const tLat = parseFloat(targetLat);
        const tLng = parseFloat(targetLng);

        if (isNaN(sLat) || isNaN(sLng) || isNaN(tLat) || isNaN(tLng)) {
            delete this.activeTasks[taskKey];
            return;
        }

        const fps = 30;
        const stepTime = 1000 / fps;
        let coords = [];

        if (useRouting) {
            try {
                const url = `${SIM_CONFIG.OSRM_URL}${sLng},${sLat};${tLng},${tLat}?overview=full&geometries=geojson`;
                const res = await fetch(url);
                if (!res.ok) throw new Error("OSRM Failed");
                const data = await res.json();
                if (!data.routes || data.routes.length === 0) throw new Error("No Route");
                coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
            } catch (e) {
                coords = [[sLat, sLng], [tLat, tLng]];
            }
        } else {
            coords = [[sLat, sLng], [tLat, tLng]];
        }

        // التأكد من أن المهمة لم يتم إلغاؤها (Cancel Incident) أثناء تحميل المسار
        if (this.activeTasks[taskKey] !== "loading") return; 

        let currentStep = 0;
        let currentSpeedKph = baseSpeedKph || 100;
        let targetSpeedKph = baseSpeedKph || 100;

        this.activeTasks[taskKey] = setInterval(() => {
            const marker = this.markers[type]?.[strId];
            if (!marker || currentStep >= coords.length - 1) {
                clearInterval(this.activeTasks[taskKey]);
                delete this.activeTasks[taskKey];
                if (onUpdate) onUpdate(tLat, tLng, 0, 0);
                return;
            }

            // 🌟 قوة التسارع الفيزيائية المستقرة (السيارات تنطلق وتتوقف بشكل طبيعي وسريع) 🌟
            if (currentSpeedKph < targetSpeedKph) currentSpeedKph += 4.0; 
            else if (currentSpeedKph > targetSpeedKph) currentSpeedKph -= 6.0; 

            if (Math.random() < 0.05) {
                const min = (baseSpeedKph || 100) * 0.95;
                const max = (baseSpeedKph || 100) * 1.05;
                targetSpeedKph = Math.random() * (max - min) + min;
            }

            const speedMps = currentSpeedKph * (1000 / 3600);
            const distPerStepMeters = speedMps / fps;
            const distPerStepDeg = distPerStepMeters / 111000;

            const p1 = coords[currentStep];
            const p2 = coords[currentStep + 1];
            
            let currentLat = parseFloat(marker.getLatLng().lat);
            let currentLng = parseFloat(marker.getLatLng().lng);

            const dLat = p2[0] - currentLat;
            const dLng = p2[1] - currentLng;
            const distance = Math.sqrt(dLat * dLat + dLng * dLng);

            if (distance < distPerStepDeg) {
                currentStep++;
            } else {
                const ratio = distPerStepDeg / distance;
                currentLat += dLat * ratio;
                currentLng += dLng * ratio;
                let heading = (Math.atan2(dLng, dLat) * 180 / Math.PI);

                marker.setLatLng([currentLat, currentLng]);
                if (typeof marker.setRotationAngle === 'function') marker.setRotationAngle(heading);

                if (this.trackedEntity === taskKey) {
                    this.map.panTo([currentLat, currentLng], { animate: false });
                }

                // إرسال التحديث لـ Dashboard لتحديث الكارت والذاكرة
                if (onUpdate) onUpdate(currentLat, currentLng, heading, currentSpeedKph);
            }
        }, stepTime);
    },

    trafficTimer: null,

    toggleTraffic(isVisible) {
        if (isVisible) {
            this.generateTraffic(); 
            this.map.addLayer(this.trafficLayerGroup);
            this.scheduleNextTrafficUpdate(); 
        } else {
            if (this.trafficLayerGroup) {
                this.map.removeLayer(this.trafficLayerGroup);
            }
            if (this.trafficTimer) {
                clearTimeout(this.trafficTimer);
                this.trafficTimer = null;
            }
        }
    },

    generateTraffic() {
        if (this.trafficLayerGroup) {
            this.trafficLayerGroup.clearLayers(); 
        } else {
            this.trafficLayerGroup = L.layerGroup();
        }

        const bounds = this.map.getBounds();
        const minLat = bounds.getSouthWest().lat;
        const maxLat = bounds.getNorthEast().lat;
        const minLng = bounds.getSouthWest().lng;
        const maxLng = bounds.getNorthEast().lng;

        const numSpots = Math.floor(Math.random() * 15) + 15;

        for (let i = 0; i < numSpots; i++) {
            const startLat = minLat + Math.random() * (maxLat - minLat);
            const startLng = minLng + Math.random() * (maxLng - minLng);
            const endLat = startLat + (Math.random() - 0.5) * 0.01;
            const endLng = startLng + (Math.random() - 0.5) * 0.01;
            const isHeavy = Math.random() > 0.5;
            const color = isHeavy ? '#ef4444' : '#f59e0b';
            const weight = isHeavy ? 5 : 4;

            L.polyline([[startLat, startLng], [endLat, endLng]], {
                color: color, weight: weight, opacity: 0.8
            }).addTo(this.trafficLayerGroup);
        }
    },

    scheduleNextTrafficUpdate() {
        const nextUpdateMs = Math.floor(Math.random() * (600000 - 300000 + 1)) + 300000;
        this.trafficTimer = setTimeout(() => {
            if (this.map.hasLayer(this.trafficLayerGroup)) {
                this.generateTraffic(); 
                this.scheduleNextTrafficUpdate(); 
            }
        }, nextUpdateMs);
    },

    toggleHeatmap(incidentsList, isVisible) {
        if (isVisible) {
            if (this.heatmapLayerGroup) this.map.removeLayer(this.heatmapLayerGroup);
            this.heatmapLayerGroup = L.layerGroup();
            incidentsList.forEach(inc => {
                if(inc.latitude && inc.longitude) {
                    L.circle([inc.latitude, inc.longitude], { color: 'transparent', fillColor: '#ef4444', fillOpacity: 0.1, radius: 1000 }).addTo(this.heatmapLayerGroup);
                    L.circle([inc.latitude, inc.longitude], { color: 'transparent', fillColor: '#f97316', fillOpacity: 0.3, radius: 400 }).addTo(this.heatmapLayerGroup);
                }
            });
            this.map.addLayer(this.heatmapLayerGroup);
        } else if (this.heatmapLayerGroup) {
            this.map.removeLayer(this.heatmapLayerGroup);
        }
    }
};

window.MapEngine = MapEngine;