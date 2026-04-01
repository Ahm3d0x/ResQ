// ============================================================================
// 🗺️ ResQ Map & Simulation Engine (Standalone Module)
// ============================================================================

// ⚙️ متغيرات التحكم في المحاكاة (يمكنك تعديلها بحرية)
export const SIM_CONFIG = {
    AMBULANCE_SPEED_KPH: 600, 
    CAR_SPEED_KPH: 200,
    PATROL_RADIUS: 0.03,
    ROAMING_RADIUS: 0.06,
    OSRM_URL: 'https://router.project-osrm.org/route/v1/driving/'
};

export const MapEngine = {
    map: null,
    markers: { hospitals: {}, ambulances: {}, incidents: {}, devices: {} },
    routes: {},
    activeTasks: {},

    init(containerId, centerLat = 30.0444, centerLng = 31.2357, onMarkerClick) {
        this.map = L.map(containerId, { zoomControl: false }).setView([centerLat, centerLng], 12);
        L.control.zoom({ position: 'bottomright' }).addTo(this.map);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(this.map);
        this.onMarkerClick = onMarkerClick; 
    },

    getAmbIcon(color, status) {
        let baseColor = status === 'available' ? '#10b981' : status === 'offline' ? '#6b7280' : '#dc2626';
        return L.divIcon({
            html: `<div style="background-color: ${baseColor}" class="relative w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-white shadow-[0_0_10px_rgba(0,0,0,0.5)] transition-colors duration-300">
                      <i class="fa-solid fa-truck-medical text-xs"></i>
                      <span class="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-gray-900" style="background-color: ${color}"></span>
                   </div>`,
            className: ''
        });
    },
    hospIcon: L.divIcon({ html: '<div class="w-8 h-8 bg-gray-800 rounded-full border-2 border-blue-500 flex items-center justify-center text-blue-400 shadow-lg"><i class="fa-solid fa-hospital text-xs"></i></div>', className: ''}),
    incIcon: L.divIcon({ html: '<div class="leaflet-incident-marker w-8 h-8"></div><div class="absolute inset-0 flex items-center justify-center text-lg">💥</div>', className: ''}),
    carIcon: L.divIcon({ html: '<div class="w-8 h-8 bg-white dark:bg-gray-800 rounded-full border-2 border-gray-400 dark:border-gray-600 flex items-center justify-center shadow-lg"><i class="fa-solid fa-car-side text-gray-700 dark:text-gray-300 text-[12px]"></i></div>', className: ''}),

    updateHospital(id, lat, lng, data) {
        if (!this.markers.hospitals[id]) {
            this.markers.hospitals[id] = L.marker([lat, lng], {icon: this.hospIcon}).addTo(this.map);
            this.markers.hospitals[id].on('click', () => this.onMarkerClick('Hospital', data));
        }
    },

    updateIncident(id, lat, lng, status, data) {
        if (status !== 'pending' && status !== 'confirmed') {
            if (this.markers.incidents[id]) {
                this.map.removeLayer(this.markers.incidents[id]);
                delete this.markers.incidents[id];
            }
            return;
        }
        if (!this.markers.incidents[id]) {
            this.markers.incidents[id] = L.marker([lat, lng], {icon: this.incIcon}).addTo(this.map);
            this.markers.incidents[id].on('click', () => this.onMarkerClick('Incident', data));
        }
    },

    updateAmbulance(id, lat, lng, status, color, data, baseLat, baseLng) {
        if (!this.markers.ambulances[id]) {
            this.markers.ambulances[id] = L.marker([lat || baseLat, lng || baseLng], {icon: this.getAmbIcon(color, status)}).addTo(this.map);
            this.markers.ambulances[id].on('click', () => this.onMarkerClick('Ambulance', data));
            if (status === 'available') this.startAmbulancePatrol(id, baseLat, baseLng);
        } else {
            this.markers.ambulances[id].setIcon(this.getAmbIcon(color, status));
        }
    },

    updateCar(id, lat, lng, data, onDestinationReached) {
        if (!this.markers.devices[id]) {
            this.markers.devices[id] = L.marker([lat, lng], {icon: this.carIcon}).addTo(this.map);
            this.markers.devices[id].on('click', () => this.onMarkerClick('Device', data));
            this.startCarRoaming(id, onDestinationReached); 
        }
    },

    async animateAlongPath(markerId, type, pathCoords, speedKph) {
        const speedMps = speedKph * (1000 / 3600); 
        const taskKey = `${type}_${markerId}`;
        this.activeTasks[taskKey] = true;

        const marker = type === 'amb' ? this.markers.ambulances[markerId] : this.markers.devices[markerId];
        if (!marker) return;

        for (let i = 0; i < pathCoords.length - 1; i++) {
            if (!this.activeTasks[taskKey]) break; 

            let start = pathCoords[i];
            let end = pathCoords[i + 1];
            let dist = this.map.distance(start, end); 
            if (dist < 1) continue;

            let durationMs = (dist / speedMps) * 1000;
            await this._smoothStep(marker, start, end, durationMs, taskKey);
        }
    },

    _smoothStep(marker, start, end, duration, taskKey) {
        return new Promise(resolve => {
            let startTime = performance.now();
            const step = (currentTime) => {
                if (!this.activeTasks[taskKey]) return resolve(); 
                
                let progress = (currentTime - startTime) / duration;
                if (progress >= 1) {
                    marker.setLatLng(end);
                    return resolve();
                }
                
                let currentLat = start[0] + (end[0] - start[0]) * progress;
                let currentLng = start[1] + (end[1] - start[1]) * progress;
                marker.setLatLng([currentLat, currentLng]);
                
                requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        });
    },

    cancelAnimation(id, type) {
        this.activeTasks[`${type}_${id}`] = false;
    },

    async startAmbulancePatrol(id, baseLat, baseLng) {
        await new Promise(r => setTimeout(r, Math.random() * 5000));
        
        while(this.activeTasks[`amb_${id}`] !== false) {
            if (!this.markers.ambulances[id]) break;
            let targetLat = baseLat + (Math.random() - 0.5) * SIM_CONFIG.PATROL_RADIUS;
            let targetLng = baseLng + (Math.random() - 0.5) * SIM_CONFIG.PATROL_RADIUS;
            let currentPos = this.markers.ambulances[id].getLatLng();

            try {
                const res = await fetch(`${SIM_CONFIG.OSRM_URL}${currentPos.lng},${currentPos.lat};${targetLng},${targetLat}?geometries=geojson`);
                const data = await res.json();
                if(data.code === 'Ok') {
                    let coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
                    await this.animateAlongPath(id, 'amb', coords, SIM_CONFIG.AMBULANCE_SPEED_KPH);
                }
            } catch(e) {}
            await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
        }
    },

// 🌟 1. محاكاة حالات الأجهزة المختلفة (في طرق حقيقية فقط) 🌟
    async startCarRoaming(id, onDestinationReached) {
        await new Promise(r => setTimeout(r, Math.random() * 8000));
        
        while(this.activeTasks[`car_${id}`] !== false) {
            if (!this.markers.devices[id]) break; 
            
            // محاكاة الحالة: 20% متوقفة، 30% زحام، 10% طريق سريع، 40% عادي
            let stateRand = Math.random();
            if (stateRand < 0.2) {
                // السيارة متوقفة
                await new Promise(r => setTimeout(r, 10000));
                continue;
            }

            let currentSpeed = stateRand < 0.5 ? SIM_CONFIG.CAR_SPEED_KPH * 0.3 : 
                               stateRand > 0.9 ? SIM_CONFIG.CAR_SPEED_KPH * 1.5 : 
                               SIM_CONFIG.CAR_SPEED_KPH; 

            let currentPos = this.markers.devices[id].getLatLng();
            // اختيار نقطة عشوائية قريبة
            let targetLat = currentPos.lat + (Math.random() - 0.5) * SIM_CONFIG.ROAMING_RADIUS;
            let targetLng = currentPos.lng + (Math.random() - 0.5) * SIM_CONFIG.ROAMING_RADIUS;
            
            try {
                // 🚀 جلب مسار حقيقي من محرك التوجيه لضمان السير على طرق حقيقية
                const res = await fetch(`${SIM_CONFIG.OSRM_URL}${currentPos.lng},${currentPos.lat};${targetLng},${targetLat}?geometries=geojson`);
                const data = await res.json();
                
                if(data.code === 'Ok' && data.routes[0].geometry.coordinates.length > 0) {
                    // تحويل الإحداثيات وتجهيز المسار
                    let path = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
                    
                    // تحريك السيارة على مسار الشارع الحقيقي
                    await this.animateAlongPath(id, 'car', path, currentSpeed);
                    
                    // حفظ الموقع الجديد في قاعدة البيانات بعد انتهاء المشوار
                    if (this.activeTasks[`car_${id}`] !== false && onDestinationReached) {
                        let finalPos = this.markers.devices[id].getLatLng();
                        onDestinationReached(finalPos.lat, finalPos.lng);
                    }
                } else {
                    // لو النقطة العشوائية طلعت في نص البحر أو ملهاش طريق، استنى شوية وجرب نقطة غيرها
                    await new Promise(r => setTimeout(r, 3000));
                    continue;
                }
            } catch(e) {
                // في حالة فشل الاتصال بالسيرفر
                await new Promise(r => setTimeout(r, 5000));
            }

            // استراحة قصيرة قبل المشوار التالي
            await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
        }
    },

    async executeDispatch(amb, inc, hosp, onStageComplete) {
        this.cancelAnimation(amb.id, 'amb'); 
        
        try {
            const currentPos = this.markers.ambulances[amb.id].getLatLng();
            const res = await fetch(`${SIM_CONFIG.OSRM_URL}${currentPos.lng},${currentPos.lat};${inc.longitude},${inc.latitude};${hosp.lng},${hosp.lat}?geometries=geojson`);
            const data = await res.json();
            
            let routeCoords = data.code === 'Ok' ? data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]) : [[currentPos.lat, currentPos.lng], [inc.latitude, inc.longitude], [hosp.lat, hosp.lng]];

            if(this.routes[inc.id]) this.map.removeLayer(this.routes[inc.id]);
            this.routes[inc.id] = L.polyline(routeCoords, { color: amb.routeColor, weight: 5, dashArray: '10, 10' }).addTo(this.map);

            let midPointIndex = Math.floor(routeCoords.length / 2);
            let pathToInc = routeCoords.slice(0, midPointIndex);
            let pathToHosp = routeCoords.slice(midPointIndex);

            await this.animateAlongPath(amb.id, 'amb', pathToInc, SIM_CONFIG.AMBULANCE_SPEED_KPH);
            onStageComplete('reached_incident');

            await this.animateAlongPath(amb.id, 'amb', pathToHosp, SIM_CONFIG.AMBULANCE_SPEED_KPH);

            if(this.routes[inc.id]) this.map.removeLayer(this.routes[inc.id]);
            onStageComplete('completed');
            
            this.startAmbulancePatrol(amb.id, amb.baseLat, amb.baseLng);

        } catch (e) {
            console.error("Dispatch routing failed", e);
            onStageComplete('completed');
        }
    }, // <-- هذا هو مكان الفاصلة التي كانت مفقودة

    trafficLayerGroup: null, // <-- الفاصلة العادية بدلاً من المنقوطة
    heatmapLayerGroup: null,

    // 🌟 2. إنشاء طبقة الزحام المروري الوهمية (Traffic Layer) 🌟
async toggleTraffic() {
        if (!this.trafficLayerGroup) {
            this.trafficLayerGroup = L.layerGroup().addTo(this.map);
            const center = this.map.getCenter();
            
            if (window.showToast) window.showToast("Fetching live traffic data...", "success");

            // جلب 4 مسارات حقيقية عشوائية حول مركز الخريطة باستخدام محرك OSRM
            for(let i = 0; i < 4; i++) {
                let lat1 = center.lat + (Math.random() - 0.5) * 0.08;
                let lng1 = center.lng + (Math.random() - 0.5) * 0.08;
                let lat2 = center.lat + (Math.random() - 0.5) * 0.08;
                let lng2 = center.lng + (Math.random() - 0.5) * 0.08;

                try {
                    const res = await fetch(`${SIM_CONFIG.OSRM_URL}${lng1},${lat1};${lng2},${lat2}?geometries=geojson`);
                    const data = await res.json();
                    
                    if(data.code === 'Ok') {
                        let coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
                        
                        // تقسيم المسار الحقيقي لتلوينه (أحمر للزحام الشديد، برتقالي للمتوسط)
                        let chunkLength = Math.floor(coords.length / 3);
                        if (chunkLength > 0) {
                            L.polyline(coords.slice(0, chunkLength), { color: '#ef4444', weight: 5, opacity: 0.7 }).addTo(this.trafficLayerGroup); // أحمر
                            L.polyline(coords.slice(chunkLength - 1, chunkLength * 2), { color: '#f97316', weight: 5, opacity: 0.7 }).addTo(this.trafficLayerGroup); // برتقالي
                            L.polyline(coords.slice(chunkLength * 2 - 1), { color: '#ef4444', weight: 5, opacity: 0.7 }).addTo(this.trafficLayerGroup); // أحمر
                        }
                    }
                } catch(e) {
                    console.error("Traffic simulation error");
                }
            }
        } else {
            if (this.map.hasLayer(this.trafficLayerGroup)) {
                this.map.removeLayer(this.trafficLayerGroup);
            } else {
                this.map.addLayer(this.trafficLayerGroup);
            }
        }
    },

    // 🌟 3. إنشاء الخريطة الحرارية (Incident Heatmap) 🌟
    toggleHeatmap(incidentsList) {
        if (!this.heatmapLayerGroup) {
            this.heatmapLayerGroup = L.layerGroup().addTo(this.map);
            incidentsList.forEach(inc => {
                if(inc.latitude && inc.longitude) {
                    L.circle([inc.latitude, inc.longitude], { color: 'transparent', fillColor: '#ef4444', fillOpacity: 0.1, radius: 1000 }).addTo(this.heatmapLayerGroup);
                    L.circle([inc.latitude, inc.longitude], { color: 'transparent', fillColor: '#f97316', fillOpacity: 0.3, radius: 400 }).addTo(this.heatmapLayerGroup);
                }
            });
        } else {
            if (this.map.hasLayer(this.heatmapLayerGroup)) this.map.removeLayer(this.heatmapLayerGroup);
            else this.map.addLayer(this.heatmapLayerGroup);
        }
    }
};