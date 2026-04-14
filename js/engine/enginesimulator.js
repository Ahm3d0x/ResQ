// ============================================================================
// 🏎️ EnQaZ Core Engine - High-Performance Simulator (V4.0 - Resilience & Pauses)
// ============================================================================

import { supabase, DB_TABLES } from '../config/supabase.js';
import { EngineUI } from './engineui.js';

export const trackingChannel = supabase.channel('live-tracking', {
    config: { broadcast: { ack: false } }
});

export const EngineSimulator = {
    activeMissions: new Map(), 
    lastBroadcastTime: 0,
    simLoopId: null,
    osrmQueue: [], 
    isProcessingOsrm: false,
    isSubscribed: false,
    
    config: {
        AMB_SPEED_EMERGENCY: 120,
        AMB_SPEED_PATROL: 48,
        PATROL_RADIUS: 0.03
    },

    async init() {
        EngineUI.log('SIM', 'Initializing Simulation Engine...', 'info');
        
        await this.syncSettings();
        
        trackingChannel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                this.isSubscribed = true;
                EngineUI.log('SIM', 'Live tracking channel is fully CONNECTED.', 'success');
            }
        });

        // 🌟 1. استرداد المهام المعلقة في حالة إعادة تشغيل السيرفر
        await this.restoreActiveMissions();

        this.listenForDispatch();
        this.setupDatabaseListeners(); // 🌟 الاستماع لإشارات السائق والمستشفى
        
        this.listenForControls();
        this.startEngineLoop(); 

        await this.startIdlePatrols();
        
        setInterval(() => this.syncSettings(), 10000);
    },

// ==========================================
    // 🌟 1. استرداد المهام المعلقة (Recovery System)
    // ==========================================
    async restoreActiveMissions() {
        EngineUI.log('SIM', 'Scanning for active missions to recover...', 'dim');
        
        const { data: activeIncidents, error } = await supabase
            .from(DB_TABLES.INCIDENTS)
            .select('*, ambulances (*), hospitals (*)')
            .in('status', ['assigned', 'in_progress']);

        if (error || !activeIncidents || activeIncidents.length === 0) {
            EngineUI.log('SIM', 'No interrupted missions found. Starting clean.', 'dim');
            return;
        }

        EngineUI.log('SIM', `Found ${activeIncidents.length} active missions. Resuming simulation...`, 'system');

        activeIncidents.forEach(inc => {
            const amb = inc.ambulances;
            const hosp = inc.hospitals;
            if (!amb || !hosp) return;

            const ambLat = parseFloat(amb.lat);
            const ambLng = parseFloat(amb.lng);
            const incLat = parseFloat(inc.latitude);
            const incLng = parseFloat(inc.longitude);
            const hospLat = parseFloat(hosp.lat);
            const hospLng = parseFloat(hosp.lng);

            // البيانات الأساسية للمهمة
            const missionData = {
                incId: inc.id,
                amb: { id: amb.id, code: amb.code },
                hospCoords: { lat: hospLat, lng: hospLng },
                speedKph: this.config.AMB_SPEED_EMERGENCY
            };

            // 🚀 استئناف الحركة بناءً على الحالة الحالية
            if (amb.status === 'assigned' || amb.status === 'en_route_incident') {
                EngineUI.log('SIM', `Resuming Unit ${amb.code} to INCIDENT #${inc.id}...`, 'warn');
                this.queueRouteRequest({
                    ...missionData,
                    startCoords: { lat: ambLat, lng: ambLng },
                    targetCoords: { lat: incLat, lng: incLng },
                    stage: 'to_incident'
                });
            } 
            else if (amb.status === 'en_route_hospital') {
                EngineUI.log('SIM', `Resuming Unit ${amb.code} to HOSPITAL...`, 'blue');
                // توجيه الإسعاف من مكانه الحالي إلى المستشفى!
                this.queueRouteRequest({
                    ...missionData,
                    startCoords: { lat: ambLat, lng: ambLng },
                    targetCoords: { lat: hospLat, lng: hospLng },
                    stage: 'to_hospital'
                });
            } 
            else if (amb.status === 'busy') {
                EngineUI.log('SIM', `Recovered: Unit ${amb.code} waiting at Hospital.`, 'dim');
                this.activeMissions.set(amb.id, { 
                    ...missionData, 
                    stage: 'waiting_hospital_action', 
                    route: [], currentStep: 0, lat: ambLat, lng: ambLng, heading: 0 
                });
            }
        });
    },

// ==========================================
    // 📡 2. مراقب الأوامر الحية (Live State Watcher - Ultimate Fix)
    // ==========================================
    setupRealtimeListeners() {
        supabase.channel('simulator-amb-watch')
            .on('postgres_changes', { 
                event: 'UPDATE', schema: 'public', table: DB_TABLES.AMBULANCES 
            }, async (payload) => {
                const ambId = payload.new.id;
                const newStatus = payload.new.status;
                let mission = this.activeMissions.get(ambId);

                // 🚨 1. الفرملة الفورية: تم تعيين المهمة، يجب أن يتوقف لانتظار السائق
                if (newStatus === 'assigned') {
                    if (mission) {
                        EngineUI.log('SIM', `Unit ${payload.new.code} ASSIGNED. Halting movement...`, 'warn');
                        mission.stage = 'waiting_driver_action';
                        mission.route = []; // توقف فوري
                    }
                    return;
                }

                // 🚑 2. السائق أكد الاستلام: يجب أن يتحرك للحادث! (هنا كان النقص)
                if (newStatus === 'en_route_incident') {
                    EngineUI.log('SIM', `[ACTION] Unit ${payload.new.code} accepted. Routing to Incident...`, 'info');

                    // جلب بيانات الحادث والمستشفى بشكل موثوق من الداتابيز
                    const { data: incData } = await supabase
                        .from(DB_TABLES.INCIDENTS)
                        .select('*, hospitals(*)')
                        .eq('assigned_ambulance_id', ambId)
                        .in('status', ['assigned', 'in_progress'])
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .single();

                    if (incData && incData.hospitals) {
                        // إذا لم يكن الإسعاف مسجلاً كنشط، ننشئ له سجلاً للحركة
                        if (!mission) {
                            mission = { 
                                lat: parseFloat(payload.new.lat) || 30.0444, 
                                lng: parseFloat(payload.new.lng) || 31.2357, 
                                heading: 0 
                            };
                        }

                        // توجيه المحاكي للحادث
                        this.queueRouteRequest({
                            incId: incData.id,
                            amb: { id: ambId, code: payload.new.code },
                            startCoords: { lat: mission.lat, lng: mission.lng },
                            targetCoords: { lat: incData.latitude, lng: incData.longitude },
                            hospCoords: { lat: incData.hospitals.lat, lng: incData.hospitals.lng },
                            stage: 'to_incident',
                            speedKph: this.config.AMB_SPEED_EMERGENCY
                        });
                    }
                    return;
                }

                // --------- المراحل القادمة تتطلب وجود مهمة نشطة مسبقاً ---------
                if (!mission) return; 

                // 🚀 3. السائق استلم المصاب: يتحرك للمستشفى
                if (newStatus === 'en_route_hospital' && mission.stage !== 'to_hospital') {
                    EngineUI.log('SIM', `[ACTION] Unit ${payload.new.code} picked up patient. Routing to Hospital...`, 'info');
                    if (mission.hospCoords) {
                        this.queueRouteRequest({
                            incId: mission.incId,
                            amb: mission.amb,
                            startCoords: { lat: mission.lat, lng: mission.lng },
                            targetCoords: mission.hospCoords,
                            hospCoords: mission.hospCoords,
                            stage: 'to_hospital',
                            speedKph: this.config.AMB_SPEED_EMERGENCY
                        });
                    }
                }
                
                // 🛑 4. وصل المستشفى: يتوقف وينتظر الاستلام
                else if (newStatus === 'busy' && mission.stage !== 'waiting_hospital_action') {
                    EngineUI.log('SIM', `[ACTION] Unit ${payload.new.code} arrived at Hospital. Waiting handover.`, 'warn');
                    mission.stage = 'waiting_hospital_action';
                    mission.route = []; // توقف تام في المستشفى
                }
                
                // ✅ 5. المستشفى أكدت الاستلام (أو سُحبت المهمة من السائق لعدم الرد): يعود للعمل
                else if (newStatus === 'available') {
                    if (mission.stage === 'waiting_hospital_action' || mission.stage === 'waiting_driver_action') {
                        EngineUI.log('SIM', `[ACTION] Unit ${payload.new.code} is now Free. Returning to patrol.`, 'success');
                        this.activeMissions.delete(ambId);
                        this.assignPatrol({ id: ambId, code: payload.new.code, lat: mission.lat, lng: mission.lng });
                    }
                }
            })
            .subscribe();
    },
    // 🌟 الاستماع اللحظي لتأكيدات السائق والمستشفى من قاعدة البيانات
    setupDatabaseListeners() {
        supabase.channel('sim-state-monitor')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: DB_TABLES.INCIDENTS }, (payload) => {
                const newInc = payload.new;
                const oldInc = payload.old;

                // 1. السائق أكد استلام المريض (assigned -> in_progress)
                if (oldInc.status === 'assigned' && newInc.status === 'in_progress' && newInc.assigned_ambulance_id) {
                    const mission = this.activeMissions.get(newInc.assigned_ambulance_id);
                    if (mission && mission.stage === 'waiting_driver_action') {
                        EngineUI.log('SIM', `Driver confirmed pickup for #${newInc.id}. Routing to hospital...`, 'success');
                        // استئناف الرحلة وتوجيهها للمستشفى
                        this.queueRouteRequest({
                            incId: mission.incId,
                            amb: mission.amb,
                            startCoords: { lat: mission.lat, lng: mission.lng },
                            targetCoords: mission.hospCoords,
                            hospCoords: mission.hospCoords,
                            stage: 'to_hospital',
                            speedKph: this.config.AMB_SPEED_EMERGENCY
                        });
                    }
                }

                // 2. المستشفى أكدت استلام المريض (in_progress -> completed)
                if (oldInc.status === 'in_progress' && newInc.status === 'completed' && newInc.assigned_ambulance_id) {
                    const ambId = newInc.assigned_ambulance_id;
                    const mission = this.activeMissions.get(ambId);
                    if (mission && mission.stage === 'waiting_hospital_action') {
                        EngineUI.log('SIM', `Hospital confirmed arrival for #${newInc.id}. Freeing Unit ${mission.amb.code}.`, 'system');
                        this.activeMissions.delete(ambId);
                        
                        // تحديث حالة الإسعاف لـ available وإطلاق دورية جديدة
                        supabase.from(DB_TABLES.AMBULANCES).update({ status: 'available' }).eq('id', ambId).then(() => {
                            this.assignPatrol({ id: ambId, code: mission.amb.code, lat: mission.lat, lng: mission.lng });
                        });
                    }
                }
            }).subscribe();
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
                        const newSpeed = parseFloat(parsedConfig.AMBULANCE_SPEED_KPH) || 120;
                        const newRadius = parseFloat(parsedConfig.PATROL_RADIUS) || 0.03;

                        if (this.config.AMB_SPEED_EMERGENCY !== newSpeed || this.config.PATROL_RADIUS !== newRadius) {
                            this.config.AMB_SPEED_EMERGENCY = newSpeed;
                            this.config.AMB_SPEED_PATROL = newSpeed * 0.4; 
                            this.config.PATROL_RADIUS = newRadius;
                            
                            EngineUI.log('SIM', `Settings Applied: Emergency: ${this.config.AMB_SPEED_EMERGENCY}km/h | Patrol: ${this.config.AMB_SPEED_PATROL}km/h`, 'success');

                            for (const mission of this.activeMissions.values()) {
                                mission.speedKph = mission.stage === 'patrol' ? this.config.AMB_SPEED_PATROL : this.config.AMB_SPEED_EMERGENCY;
                            }
                        }
                    }
                }
            }
        } catch (err) {}
    },

    async startIdlePatrols() {
        // لا نطلق دوريات للإسعافات التي لها مهام نشطة قمنا باستردادها
        const busyAmbIds = Array.from(this.activeMissions.keys());
        
        let query = supabase.from(DB_TABLES.AMBULANCES).select('*').in('status', ['available', 'returning']);
        const { data } = await query;
        
        if (data) {
            data.forEach(amb => {
                if (!busyAmbIds.includes(amb.id)) {
                    this.assignPatrol(amb);
                }
            });
        }
    },

    assignPatrol(amb) {
        const currentLat = parseFloat(amb.lat) || 30.0444;
        const currentLng = parseFloat(amb.lng) || 31.2357;
        
        const r = this.config.PATROL_RADIUS * Math.sqrt(Math.random());
        const theta = Math.random() * 2 * Math.PI;
        const targetLat = currentLat + (r * Math.cos(theta));
        const targetLng = currentLng + (r * Math.sin(theta) / Math.cos(currentLat * Math.PI / 180));

        this.queueRouteRequest({
            amb: amb,
            startCoords: { lat: currentLat, lng: currentLng },
            targetCoords: { lat: targetLat, lng: targetLng },
            stage: 'patrol',
            speedKph: this.config.AMB_SPEED_PATROL
        });
    },

    listenForDispatch() {
        // window.addEventListener('engine:dispatch_complete', async (e) => {
        //     const { incident, ambulance, hospital } = e.detail;
        //     this.queueRouteRequest({
        //         incId: incident.id,
        //         amb: ambulance,
        //         startCoords: { lat: parseFloat(ambulance.lat) || 30.0444, lng: parseFloat(ambulance.lng) || 31.2357 },
        //         targetCoords: { lat: parseFloat(incident.latitude) || 30.0444, lng: parseFloat(incident.longitude) || 31.2357 },
        //         hospCoords: { lat: parseFloat(hospital.lat) || 30.0444, lng: parseFloat(hospital.lng) || 31.2357 },
        //         stage: 'to_incident',
        //         speedKph: this.config.AMB_SPEED_EMERGENCY
        //     });
        // });
    },

    async queueRouteRequest(missionData) {
        this.osrmQueue.push(missionData);
        this.processOsrmQueue();
    },

    async processOsrmQueue() {
        if (this.isProcessingOsrm || this.osrmQueue.length === 0) return;
        this.isProcessingOsrm = true;

        const task = this.osrmQueue.shift();
        let routeCoords = null;

        try {
            const url = `https://router.project-osrm.org/route/v1/driving/${task.startCoords.lng},${task.startCoords.lat};${task.targetCoords.lng},${task.targetCoords.lat}?overview=full&geometries=geojson`;
            
            const res = await fetch(url, {
                method: 'GET',
                mode: 'cors',
                headers: { 'Accept': 'application/json, text/plain, */*' }
            });
            
            if (res.ok) {
                const data = await res.json();
                if (data.routes && data.routes.length > 0) {
                    routeCoords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
                }
            }
        } catch (err) {}

        if (!routeCoords || routeCoords.length < 2) {
            routeCoords = [
                [parseFloat(task.startCoords.lat), parseFloat(task.startCoords.lng)],
                [parseFloat(task.targetCoords.lat), parseFloat(task.targetCoords.lng)]
            ];
        }

        this.activeMissions.set(task.amb.id, {
            ...task,
            route: routeCoords,
            currentStep: 0,
            lat: parseFloat(task.startCoords.lat),
            lng: parseFloat(task.startCoords.lng),
            heading: 0
        });

        this.isProcessingOsrm = false;
        setTimeout(() => this.processOsrmQueue(), 1500);
    },

    startEngineLoop() {
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
        for (const [ambId, mission] of this.activeMissions.entries()) {
            
            // 🌟 لا تتحرك إذا كانت في وضع الانتظار
            if (mission.stage === 'waiting_driver_action' || mission.stage === 'waiting_hospital_action') {
                continue;
            }

            if (!mission.route || mission.currentStep >= mission.route.length - 1) {
                this.handleArrival(ambId, mission);
                continue;
            }

            const speedMps = mission.speedKph * (1000 / 3600);
            const distToMoveMeters = speedMps * dt;
            
            const latRatio = Math.cos(mission.lat * Math.PI / 180) || 1;

            const p1 = [mission.lat, mission.lng];
            const p2 = mission.route[mission.currentStep + 1];

            if(!p2) continue;

            const dLat = p2[0] - p1[0];
            const dLng = p2[1] - p1[1];
            
            const dLatMeters = dLat * 111320;
            const dLngMeters = dLng * 111320 * latRatio;
            const distanceMeters = Math.sqrt(dLatMeters * dLatMeters + dLngMeters * dLngMeters);

            if (distanceMeters < 0.5 || distanceMeters < distToMoveMeters) {
                mission.currentStep++;
            } else {
                const ratio = distToMoveMeters / distanceMeters;
                mission.lat += dLat * ratio;
                mission.lng += dLng * ratio;
                mission.heading = (Math.atan2(dLngMeters, dLatMeters) * 180 / Math.PI);
            }
        }
    },

    broadcastPositions() {
        if (!this.isSubscribed || this.activeMissions.size === 0) return;

        const payloads = [];
        for (const [ambId, mission] of this.activeMissions.entries()) {
            
            // نجعل السرعة 0 في البث إذا كان الإسعاف متوقفاً للانتظار
            const isWaiting = (mission.stage === 'waiting_driver_action' || mission.stage === 'waiting_hospital_action');

            payloads.push({
                id: String(ambId), 
                lat: parseFloat(mission.lat) || 30.0444, 
                lng: parseFloat(mission.lng) || 31.2357,
                heading: parseFloat(mission.heading) || 0, 
                speed: isWaiting ? 0 : (parseFloat(mission.speedKph) || 0), 
                stage: mission.stage
            });
        }
        
        trackingChannel.send({ type: 'broadcast', event: 'fleet_update', payload: payloads }).catch(()=>{});
    },

    // 🌟 التعامل مع الوصول (تغيير السلوك الجذري)
    async handleArrival(ambId, mission) {
        if (mission.stage === 'patrol') {
            this.activeMissions.delete(ambId);
            this.assignPatrol({ id: ambId, code: mission.amb.code, lat: mission.lat, lng: mission.lng });
        } 
        else if (mission.stage === 'to_incident') {
            // توقف الإسعاف ولا تتحرك.. انتظر تدخل السائق
            EngineUI.log('SIM', `Ambulance ${mission.amb.code} arrived at incident. Waiting for driver pickup...`, 'warn');
            mission.stage = 'waiting_driver_action';
            
            // يمكننا تحديث حالة الإسعاف برمجياً ليعلم النظام بوقوفه
            await supabase.from(DB_TABLES.AMBULANCES).update({ lat: mission.lat, lng: mission.lng }).eq('id', ambId);
        } 
        else if (mission.stage === 'to_hospital') {
            // توقف الإسعاف عند المستشفى.. انتظر تأكيد المستشفى
            EngineUI.log('SIM', `Ambulance ${mission.amb.code} arrived at hospital. Waiting for hospital hand-off...`, 'warn');
            mission.stage = 'waiting_hospital_action';

            await supabase.from(DB_TABLES.AMBULANCES).update({ lat: mission.lat, lng: mission.lng }).eq('id', ambId);
        }
    },

    // أداة مساعدة لحساب المسافة الدقيقة بالمتر (مهمة للاسترداد)
    calculateDistanceMeters(lat1, lon1, lat2, lon2) {
        const R = 6371000; // نصف قطر الأرض بالمتر
        const dLat = (lat2 - lat1) * (Math.PI/180);
        const dLon = (lon2 - lon1) * (Math.PI/180); 
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * (Math.PI/180)) * Math.cos(lat2 * (Math.PI/180)) * Math.sin(dLon/2) * Math.sin(dLon/2); 
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
        return R * c; 
    },

    listenForControls() {
        window.addEventListener('engine:kill_switch', () => {
            if (this.simLoopId) clearInterval(this.simLoopId);
            this.activeMissions.clear();
        });
    }
};

document.addEventListener('DOMContentLoaded', () => { setTimeout(() => EngineSimulator.init(), 800); });