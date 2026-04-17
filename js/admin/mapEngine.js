// ============================================================================
// 🗺️ EnQaZ Map Engine (Advanced Dynamic Module) - Anti-Jitter Version
// ============================================================================

export const SIM_CONFIG = {
    OSRM_URL: 'https://router.project-osrm.org/route/v1/driving/'
};

export const MapEngine = {
    map: null,
    layerGroups: { hospitals: null, ambulances: null, incidents: null, devices: null, routes: null },
    markers: { hospitals: {}, ambulances: {}, incidents: {}, devices: {} },
    trafficLayerGroup: null,
    heatmapLayerGroup: null,
    trackedEntity: null, 
    incidentRoutes: {},
    
    // 🛡️ درع الحماية: يمنع تداخل الأوامر السريعة مع الانتقال السينمائي
    isFlying: false, 

    // استخراج الإحداثيات الحية بدقة
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
    isMapInteracting: false,
    init(containerId, centerLat = 30.0444, centerLng = 31.2357, onMarkerClick) {
        if(this.map) return; 
        this.map = L.map(containerId, { zoomControl: false }).setView([centerLat, centerLng], 12);
        L.control.zoom({ position: 'bottomright' }).addTo(this.map);
        
        // 🛡️ المعالجة الذكية: حماية الخريطة أثناء الزووم أو الكليك
        const origSetView = this.map.setView.bind(this.map);
        this.map.setView = function(center, zoom, options) {
            // تجاهل أي أمر إذا كانت الخريطة تقوم بـ Zoom أو FlyTo حالياً
            if (MapEngine.isFlying || this._animatingZoom) return this;
            return origSetView(center, zoom, options);
        };
// إضافة مستمعات الأحداث (Event Listeners) لإيقاف الـ CSS Transition أثناء الزووم
        // this.map.on('zoomstart', () => {
        //     this.map.getContainer().classList.add('is-zooming');
        // });
        
        // this.map.on('zoomend', () => {
        //     this.map.getContainer().classList.remove('is-zooming');
        // });
        this.map.on('zoomstart dragstart', () => {
            this.isMapInteracting = true;
            this.map.getContainer().classList.add('is-interacting');
        });
        
        this.map.on('zoomend dragend', () => {
            this.map.getContainer().classList.remove('is-interacting');
            // تأخير نصف ثانية قبل إعادة التتبع لضمان نعومة العودة
            setTimeout(() => { this.isMapInteracting = false; }, 500);
        });
        const origPanTo = this.map.panTo.bind(this.map);
        this.map.panTo = function(center, options) {
            if (MapEngine.isFlying || this._animatingZoom) return this;
            return origPanTo(center, options);
        };

        // 🌟 قائمة مزودي الخرائط
        const mapProviders = [
            'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', 
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', 
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' 
        ];
        
        let currentProviderIndex = 0;
        let baseLayer = L.tileLayer(mapProviders[currentProviderIndex], { maxZoom: 19 }).addTo(this.map);

        baseLayer.on('tileerror', () => {
            currentProviderIndex++;
            if (currentProviderIndex < mapProviders.length) {
                baseLayer.setUrl(mapProviders[currentProviderIndex]);
            }
        });
        
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

    // 🌟 استعادة الأسماء القديمة للكلاسات التي تضمن الثبات أثناء الـ Zoom 🌟
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
            filteredData = dataList.filter(inc => inc.status !== 'completed' && inc.status !== 'CANCELLED' && inc.status !== 'cancelled');
        }

        const currentIds = new Set(filteredData.map(item => String(item.id)));
        
        for (let id in this.markers[type]) {
            if (!currentIds.has(String(id))) {
                this.layerGroups[type].removeLayer(this.markers[type][id]);
                delete this.markers[type][id];
            }
        }
        
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
                    
                    marker.currentStatus = item.status; // 🌟 حفظ الحالة يمنع إعادة رسم الأيقونة عشوائياً
                    
                    if (item.heading && typeof marker.setRotationAngle === 'function') marker.setRotationAngle(item.heading);
                    
                    marker.on('click', () => { if(this.onMarkerClick) this.onMarkerClick(type, id); });
                    marker.addTo(this.layerGroups[type]);
                    this.markers[type][id] = marker;
} else {
                    const marker = this.markers[type][id];
                    
                    // 🛡️ حماية الـ Leaflet أثناء الزووم عند عمل Update All UI
                    const curLatLng = marker.getLatLng();
                    if (curLatLng.lat !== lat || curLatLng.lng !== lng) {
                        // لا نحدث الموقع إذا كانت الخريطة في وضع الـ Animation الخاص بالزووم
                        if (!this.map._animatingZoom) {
                            marker.setLatLng([lat, lng]);
                        }
                    }
                    
                    if (item.heading && typeof marker.setRotationAngle === 'function') {
                        marker.setRotationAngle(item.heading);
                    }
                    
                    // 🌟 لا تقم بتحديث شكل الأيقونة إلا إذا تغيرت حالتها (لحماية الأنيميشن)
                    if(type !== 'devices' && marker.currentStatus !== item.status) {
                        const newIcon = this.getIconForType(type, item);
                        marker.setIcon(newIcon);
                        marker.currentStatus = item.status;
                    }
                }
            }
        });
    },
focusOnEntity(type, id) {
    // 1. فك التتبع فوراً بمجرد الضغط على أي عنصر جديد
    this.trackedEntity = null;
    this.targetCameraPos = null;

    const coords = this.getEntityLatLng(type, id);
    if (coords) {
        // 2. الانتقال للعنصر الجديد
        this.map.flyTo([coords.lat, coords.lng], 16, { animate: true, duration: 0.8 });
    }
},
targetCameraPos: null,
    currentCameraPos: null,
    isMapInteracting: false,

    // 🎯 دالة التتبع الجديدة (الذكية)
    toggleTracking(type, id) {
        const entityKey = `${type}_${id}`;
        
        // 1. إذا ضغط المستخدم على نفس العنصر الذي يتتبعه حالياً -> إلغاء التتبع
        if (this.trackedEntity === entityKey) {
            this.trackedEntity = null; 
            this.targetCameraPos = null;
            this.currentCameraPos = null;
            return false;
        } else {
            // 2. الانتقال لتتبع عنصر جديد (حتى لو كان هناك عنصر آخر قيد التتبع)
            this.trackedEntity = entityKey;
            
            // جلب الإحداثيات الحالية للعنصر الجديد
            const coords = this.getEntityLatLng(type, id);
            
            if (coords) {
                // إعادة ضبط الكاميرا على الهدف الجديد فوراً
                this.targetCameraPos = coords;
                this.currentCameraPos = { ...coords }; // قفزة مبدئية لمنع الاهتزاز
                
                // الطيران نحو الهدف الجديد بسلاسة
                this.map.flyTo([coords.lat, coords.lng], 16, { animate: true, duration: 0.8 });
            } else {
                this.focusOnEntity(type, id); // Fallback
            }
            return true;
        }
    },

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

        const numSpots = Math.floor(Math.random() * 20) + 10; 

        for (let i = 0; i < numSpots; i++) {
            const startLat = minLat + Math.random() * (maxLat - minLat);
            const startLng = minLng + Math.random() * (maxLng - minLng);
            const endLat = startLat + (Math.random() - 0.5) * 0.01;
            const endLng = startLng + (Math.random() - 0.5) * 0.01;
            const isHeavy = Math.random() > 0.5;
            const color = isHeavy ? '#ef4444' : '#f59e0b'; 

            L.polyline([[startLat, startLng], [endLat, endLng]], {
                color: color, weight: isHeavy ? 5 : 4, opacity: 0.8
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