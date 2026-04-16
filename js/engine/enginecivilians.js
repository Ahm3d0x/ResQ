// ============================================================================
// 🚙 EnQaZ Core Engine - Civilian Traffic Simulator (V3.8 - CORS Fix)
// ============================================================================

import { supabase, DB_TABLES } from '../config/supabase.js';
import { EngineUI } from './engineui.js';
import { trackingChannel } from './enginesimulator.js';

export const EngineCivilians = {
    allDevices: new Map(),
    movingCivilians: new Map(),
    busyDeviceIds: new Set(),
    
    osrmQueue: [], 
    isProcessingOsrm: false,
    
    lastBroadcastTime: 0,
    simLoopId: null,

    config: {
        CAR_SPEED_KPH: 80 
    },

    async init() {
        if (this.simLoopId) return; // منع التشغيل المزدوج

        EngineUI.log('CIV', 'Civilian Traffic Simulator initializing...', 'dim');
        
        await this.syncSettings();
        await this.loadInitialData();
        
        this.setupRealtimeListeners();
        this.startTrafficLoop();
        this.startRandomizer(); 

        setInterval(() => this.syncSettings(), 10000);
    },

    async syncSettings() {
        try {
            const { data } = await supabase.from(DB_TABLES.SETTINGS).select('*');
            if (data) {
                const simRow = data.find(s => s.setting_key === 'simulation_config');
                if (simRow && simRow.setting_value) {
                    let parsedConfig = simRow.setting_value;
                    if (typeof parsedConfig === 'string') { try { parsedConfig = JSON.parse(parsedConfig); } catch(e){} }
                    if (typeof parsedConfig === 'string') { try { parsedConfig = JSON.parse(parsedConfig); } catch(e){} }

                    if (parsedConfig && typeof parsedConfig === 'object') {
                        const newSpeed = parseFloat(parsedConfig.CAR_SPEED_KPH) || 80;
                        if (this.config.CAR_SPEED_KPH !== newSpeed) {
                            this.config.CAR_SPEED_KPH = newSpeed;
                            EngineUI.log('CIV', `Civilians Speed Applied: ${this.config.CAR_SPEED_KPH}km/h`, 'success');
                            for (const car of this.movingCivilians.values()) {
                                car.speedKph = this.config.CAR_SPEED_KPH;
                            }
                        }
                    }
                }
            }
        } catch (err) {}
    },

    async loadInitialData() {
        const [devRes, incRes] = await Promise.all([
            supabase.from(DB_TABLES.DEVICES).select('id, lat, lng'),
            supabase.from(DB_TABLES.INCIDENTS).select('device_id').in('status', ['pending', 'assigned', 'in_progress'])
        ]);

        if (devRes.data) {
            devRes.data.forEach(d => {
                const lat = parseFloat(d.lat) || (30.0444 + (Math.random() - 0.5) * 0.1);
                const lng = parseFloat(d.lng) || (31.2357 + (Math.random() - 0.5) * 0.1);
                this.allDevices.set(d.id, { lat, lng });
            });
            EngineUI.log('CIV', `Loaded ${devRes.data.length} civilian devices.`, 'info');
        }
        if (incRes.data) {
            incRes.data.forEach(inc => this.busyDeviceIds.add(inc.device_id));
        }
    },

    setupRealtimeListeners() {
        window.addEventListener('engine:incident_ready', (e) => {
            const devId = e.detail.device_id;
            this.busyDeviceIds.add(devId);
            this.movingCivilians.delete(devId); 
            this.osrmQueue = this.osrmQueue.filter(req => req.id !== devId);
        });
    },

    startRandomizer() {
        setInterval(() => {
            const idleDevices = Array.from(this.allDevices.keys()).filter(id => 
                !this.busyDeviceIds.has(id) && 
                !this.movingCivilians.has(id) &&
                !this.osrmQueue.find(req => req.id === id)
            );
            
            const numToMove = Math.min(idleDevices.length, 3);
            
            for (let i = 0; i < numToMove; i++) {
                const randomId = idleDevices[Math.floor(Math.random() * idleDevices.length)];
                const device = this.allDevices.get(randomId);
                
                const targetLat = device.lat + (Math.random() - 0.5) * 0.03;
                const targetLng = device.lng + (Math.random() - 0.5) * 0.03;
                
                this.osrmQueue.push({
                    id: randomId,
                    startLat: device.lat,
                    startLng: device.lng,
                    targetLat: targetLat,
                    targetLng: targetLng,
                    speedKph: this.config.CAR_SPEED_KPH
                });
            }

            this.processOsrmQueue();
        }, 2000); 
    },

    async processOsrmQueue() {
        if (this.isProcessingOsrm || this.osrmQueue.length === 0) return;
        this.isProcessingOsrm = true;

        const task = this.osrmQueue.shift();
        let routeCoords = null;

        try {
            const url = `https://router.project-osrm.org/route/v1/driving/${task.startLng},${task.startLat};${task.targetLng},${task.targetLat}?overview=full&geometries=geojson`;
            
            // 🛡️ إضافة headers لتجاوز قيود CORS قدر الإمكان
            const res = await fetch(url, {
                method: 'GET',
                mode: 'cors',
                headers: {
                    'Accept': 'application/json, text/plain, */*'
                }
            });
            
            if (res.ok) {
                const data = await res.json();
                if (data.routes && data.routes.length > 0) {
                    routeCoords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
                }
            }
        } catch (err) {
            // 🛡️ كتم الخطأ بصمت لتفعيل مسار الطوارئ فوراً دون إزعاج في الكونسول
        }

        // مسار مستقيم كـ Fallback في حال فشل OSRM
        if (!routeCoords || routeCoords.length < 2) {
            routeCoords = [
                [parseFloat(task.startLat), parseFloat(task.startLng)],
                [parseFloat(task.targetLat), parseFloat(task.targetLng)]
            ];
        }

        this.movingCivilians.set(task.id, {
            id: task.id,
            route: routeCoords,
            currentStep: 0,
            lat: parseFloat(task.startLat),
            lng: parseFloat(task.startLng),
            speedKph: task.speedKph,
            heading: 0
        });

        this.isProcessingOsrm = false;

        if (this.osrmQueue.length > 0) {
            // 🐢 إبطاء الوتيرة قليلاً لتخفيف الضغط على سيرفر الخرائط
            setTimeout(() => this.processOsrmQueue(), 1500); 
        }
    },

    startTrafficLoop() {
        let lastTime = Date.now();
        
        this.simLoopId = setInterval(() => {
            const currentTime = Date.now();
            const deltaTime = (currentTime - lastTime) / 1000;
            lastTime = currentTime;

            const safeDeltaTime = Math.min(deltaTime, 1.5);

            this.updatePhysics(safeDeltaTime);

            if (currentTime - this.lastBroadcastTime >= 1000) {
                this.broadcastPositions();
                this.lastBroadcastTime = currentTime;
            }
        }, 100); 
    },

    updatePhysics(dt) {
        for (const [id, car] of this.movingCivilians.entries()) {
            if (!car.route || car.currentStep >= car.route.length - 1) {
                this.movingCivilians.delete(id);
                continue;
            }

            const speedMps = car.speedKph * (1000 / 3600);
            const distToMoveMeters = speedMps * dt;
            
            const latRatio = Math.cos(car.lat * Math.PI / 180) || 1;
            
            const p1 = [car.lat, car.lng];
            const p2 = car.route[car.currentStep + 1];

            if(!p2) continue;

            const dLat = p2[0] - p1[0];
            const dLng = p2[1] - p1[1];
            
            const dLatMeters = dLat * 111320;
            const dLngMeters = dLng * 111320 * latRatio;
            const distanceMeters = Math.sqrt(dLatMeters * dLatMeters + dLngMeters * dLngMeters);

            if (distanceMeters < 0.5 || distanceMeters < distToMoveMeters) {
                car.currentStep++;
            } else {
                const ratio = distToMoveMeters / distanceMeters;
                car.lat += dLat * ratio;
                car.lng += dLng * ratio;
                car.heading = (Math.atan2(dLngMeters, dLatMeters) * 180 / Math.PI);
                
                const dev = this.allDevices.get(id);
                if (dev) {
                    dev.lat = car.lat;
                    dev.lng = car.lng;
                }
            }
        }
    },

    broadcastPositions() {
        if (this.movingCivilians.size === 0 || trackingChannel.state !== 'joined') return;

        const payloads = [];
        for (const [id, car] of this.movingCivilians.entries()) {
            const safeLat = parseFloat(car.lat) || 30.0444;
            const safeLng = parseFloat(car.lng) || 31.2357;
            const safeHeading = parseFloat(car.heading) || 0;
            const safeSpeed = parseFloat(car.speedKph) || 0;

            payloads.push({
                id: String(id),
                lat: safeLat,
                lng: safeLng,
                heading: safeHeading,
                speed: safeSpeed
            });
        }

        trackingChannel.send({
            type: 'broadcast',
            event: 'civilians_update',
            payload: payloads
        }).catch(() => {}); 
    }
};

window.addEventListener('engine:security_cleared', () => {
    if (!window.isSessionValid) return;
    setTimeout(() => {
        EngineCivilians.init().catch(err => console.error("CIV Init Failed:", err));
    }, 1500);
});