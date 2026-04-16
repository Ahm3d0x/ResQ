// ============================================================================
// 🏎️ EnQaZ Core Engine - High-Performance Simulator (V4.0)
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
    lastOsrmRequest: new Map(),
    isProcessingOsrm: false,
    isSubscribed: false,
    isPaused: false,
    
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

        await this.restoreActiveMissions();

        this.setupRealtimeListeners();
        this.setupDatabaseListeners();
        
        this.listenForControls();
        this.startEngineLoop(); 

        await this.startIdlePatrols();
        
        setInterval(() => this.syncSettings(), 10000);
    },

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

        for (const inc of activeIncidents) {
            const amb = inc.ambulances;
            const hosp = inc.hospitals;
            if (!amb || !hosp) continue;

            const ambLat = parseFloat(amb.lat);
            const ambLng = parseFloat(amb.lng);
            const incLat = parseFloat(inc.latitude);
            const incLng = parseFloat(inc.longitude);
            const hospLat = parseFloat(hosp.lat);
            const hospLng = parseFloat(hosp.lng);

            EngineUI.log('SIM', `Restoring: Incident #${inc.id} | Unit ${amb.code} | Status: ${amb.status}`, 'warn');

            const missionData = {
                incId: inc.id,
                amb: { id: amb.id, code: amb.code },
                hospCoords: { lat: hospLat, lng: hospLng },
                speedKph: this.config.AMB_SPEED_EMERGENCY
            };

            if (amb.status === 'assigned') {
                this.activeMissions.set(amb.id, { 
                    ...missionData, stage: 'waiting_driver_action', route: [], currentStep: 0, lat: ambLat, lng: ambLng, heading: 0 
                });
            } else if (amb.status === 'en_route_incident') {
                this.queueRouteRequest({
                    ...missionData,
                    startCoords: { lat: ambLat, lng: ambLng },
                    targetCoords: { lat: incLat, lng: incLng },
                    stage: 'to_incident'
                });
            } else if (amb.status === 'arrived') {
                this.activeMissions.set(amb.id, { 
                    ...missionData, stage: 'waiting_pickup', route: [], currentStep: 0, lat: ambLat, lng: ambLng, heading: 0 
                });
            } else if (amb.status === 'en_route_hospital') {
                this.queueRouteRequest({
                    ...missionData,
                    startCoords: { lat: ambLat, lng: ambLng },
                    targetCoords: { lat: hospLat, lng: hospLng },
                    stage: 'to_hospital'
                });
            } else if (amb.status === 'busy') {
                this.activeMissions.set(amb.id, { 
                    ...missionData, stage: 'waiting_hospital_action', route: [], currentStep: 0, lat: ambLat, lng: ambLng, heading: 0 
                });
            }
        }
    },

    setupRealtimeListeners() {
        supabase.channel('simulator-amb-watch')
            .on('postgres_changes', { 
                event: 'UPDATE', schema: 'public', table: DB_TABLES.AMBULANCES 
            }, async (payload) => {
                const ambId = payload.new.id;
                const newStatus = payload.new.status;
                let mission = this.activeMissions.get(ambId);

                // 1. ASSIGNED -> Stop immediately
                if (newStatus === 'assigned') {
                    if (mission) {
                        mission.stage = 'waiting_driver_action';
                        mission.route = []; // Explicitly force speed=0
                    }
                    return;
                }

                // 2. EN_ROUTE_INCIDENT -> Start Moving to Incident
                if (newStatus === 'en_route_incident') {
                    const { data: incData } = await supabase.from(DB_TABLES.INCIDENTS)
                        .select('*, hospitals(*)')
                        .eq('assigned_ambulance_id', ambId)
                        .in('status', ['assigned', 'in_progress'])
                        .order('created_at', { ascending: false }).limit(1).single();

                    if (!incData || !incData.hospitals) return;

                    if (!mission) {
                        mission = { lat: parseFloat(payload.new.lat), lng: parseFloat(payload.new.lng) };
                    }

                    this.queueRouteRequest({
                        incId: incData.id,
                        amb: { id: ambId, code: payload.new.code },
                        startCoords: { lat: mission.lat, lng: mission.lng },
                        targetCoords: { lat: parseFloat(incData.latitude), lng: parseFloat(incData.longitude) },
                        hospCoords: { lat: parseFloat(incData.hospitals.lat), lng: parseFloat(incData.hospitals.lng) },
                        stage: 'to_incident',
                        speedKph: this.config.AMB_SPEED_EMERGENCY
                    });
                    return;
                }

                if (!mission) return; 

                // 3. ARRIVED at Incident
                if (newStatus === 'arrived') {
                    mission.stage = 'waiting_pickup';
                    mission.route = []; // Stop
                }

                // 4. EN_ROUTE_HOSPITAL -> Move to Hospital
                if (newStatus === 'en_route_hospital' && mission.stage !== 'to_hospital') {
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
                
                // 5. ARRIVED at Hospital
                else if (newStatus === 'busy' && mission.stage !== 'waiting_hospital_action') {
                    mission.stage = 'waiting_hospital_action';
                    mission.route = []; // Stop
                }
                
                // 6. AVAILABLE -> Jump to Patrol
                else if (newStatus === 'available') {
                    if (['waiting_hospital_action', 'waiting_driver_action', 'waiting_pickup'].includes(mission.stage)) {
                        this.activeMissions.delete(ambId);
                        this.assignPatrol({ id: ambId, code: payload.new.code, lat: mission.lat, lng: mission.lng });
                    }
                }
            }).subscribe();
    },

    setupDatabaseListeners() {
        supabase.channel('sim-state-monitor')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: DB_TABLES.INCIDENTS }, async (payload) => {
                const newInc = payload.new;
                const oldInc = payload.old;

                // Driver App triggered IN_PROGRESS -> Update ambulance to EN_ROUTE_HOSPITAL automatically
                if (oldInc.status !== 'in_progress' && newInc.status === 'in_progress' && newInc.assigned_ambulance_id) {
                    const ambId = newInc.assigned_ambulance_id;
                    const mission = this.activeMissions.get(ambId);
                    if (mission) {
                        await supabase.from(DB_TABLES.INCIDENT_LOGS).insert([{ incident_id: newInc.id, action: 'pickup', performed_by: 'system', note: 'Patient pickup confirmed.' }]);
                        await supabase.from(DB_TABLES.AMBULANCES).update({ status: 'en_route_hospital' }).eq('id', ambId);
                    }
                }

                // Hospital triggered COMPLETED
                if (oldInc.status !== 'completed' && newInc.status === 'completed' && newInc.assigned_ambulance_id) {
                    const ambId = newInc.assigned_ambulance_id;
                    const mission = this.activeMissions.get(ambId);
                    
                    if (newInc.assigned_hospital_id) {
                        // Find an available bed and occupy it
                        const { data: beds } = await supabase.from('hospital_beds').select('*').eq('hospital_id', newInc.assigned_hospital_id).eq('status', 'available').limit(1);
                        if (beds && beds.length > 0) {
                            await supabase.from('hospital_beds').update({ status: 'occupied', incident_id: newInc.id }).eq('id', beds[0].id);
                        }
                    }

                    await supabase.from(DB_TABLES.INCIDENT_LOGS).insert([{ incident_id: newInc.id, action: 'hospital_confirmed', performed_by: 'hospital', note: 'Patient handover completed.' }]);
                    await supabase.from(DB_TABLES.AMBULANCES).update({ status: 'available' }).eq('id', ambId);

                    if (mission) {
                        this.activeMissions.delete(ambId);
                        this.assignPatrol({ id: ambId, code: mission.amb.code, lat: mission.lat, lng: mission.lng });
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

                    if (parsedConfig && typeof parsedConfig === 'object') {
                        const newSpeed = parseFloat(parsedConfig.AMBULANCE_SPEED_KPH) || 120;
                        const newRadius = parseFloat(parsedConfig.PATROL_RADIUS) || 0.03;

                        if (this.config.AMB_SPEED_EMERGENCY !== newSpeed || this.config.PATROL_RADIUS !== newRadius) {
                            this.config.AMB_SPEED_EMERGENCY = newSpeed;
                            this.config.AMB_SPEED_PATROL = newSpeed * 0.4; 
                            this.config.PATROL_RADIUS = newRadius;
                            
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
        if (this.activeMissions.has(amb.id)) return;
        
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

    async queueRouteRequest(missionData) {
        // Prevent duplicate route tasks
        if(this.activeMissions.has(missionData.amb.id)) {
            const existing = this.activeMissions.get(missionData.amb.id);
            if(existing.stage === missionData.stage && existing.route && existing.route.length > 0) return;
        }

        this.osrmQueue.push(missionData);
        EngineUI.renderRoutingQueue(this.osrmQueue.map(m => ({ ambCode: m.amb.code, status: 'Fetching route...' })));
        this.processOsrmQueue();
    },

    async processOsrmQueue() {
        if (this.isProcessingOsrm || this.osrmQueue.length === 0) {
            if (this.osrmQueue.length === 0) EngineUI.renderRoutingQueue([]);
            return;
        }
        this.isProcessingOsrm = true;

        const task = this.osrmQueue.shift();
        
        // 1 Request / 2 Seconds per Ambulance Rate Limiter
        const lastReqTime = this.lastOsrmRequest.get(task.amb.id) || 0;
        if (Date.now() - lastReqTime < 2000) {
            this.isProcessingOsrm = false;
            this.osrmQueue.unshift(task); // re-queue
            setTimeout(() => this.processOsrmQueue(), 500);
            return;
        }

        // NaN Coordination Fix
        if (isNaN(task.startCoords.lng) || isNaN(task.startCoords.lat) || 
            isNaN(task.targetCoords.lng) || isNaN(task.targetCoords.lat)) {
            EngineUI.log('ERR', `OSRM Aborted. Invalid NaN coords for Unit ${task.amb.code}.`, 'alert');
            this.isProcessingOsrm = false;
            this.processOsrmQueue();
            return;
        }

        this.lastOsrmRequest.set(task.amb.id, Date.now());
        
        let routeCoords = null;
        let osrmStart = Date.now();

        try {
            if (window.telemetry) window.telemetry.osrm.requests++;
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
                    if (window.telemetry) {
                        window.telemetry.osrm.success++;
                        window.telemetry.osrm.totalTime += (Date.now() - osrmStart);
                    }
                }
            } else {
                EngineUI.log('ERR', `OSRM returned HTTP ${res.status}`, 'error');
                if (window.telemetry) window.telemetry.osrm.fail++;
            }
        } catch (err) {
            EngineUI.log('ERR', `OSRM Failure for Unit ID ${task.amb.id}: ${err.message}`, 'alert');
            if (window.telemetry) window.telemetry.osrm.fail++;
        }

        if (!routeCoords || routeCoords.length < 2) {
            this.isProcessingOsrm = false;
            // No valid route -> stop movement immediately
            if(this.activeMissions.has(task.amb.id)){
                const existing = this.activeMissions.get(task.amb.id);
                existing.route = []; 
            }
            setTimeout(() => this.processOsrmQueue(), 500);
            return;
        }

        this.activeMissions.set(task.amb.id, {
            ...task,
            route: routeCoords,
            currentStep: 0,
            lat: parseFloat(task.startCoords.lat),
            lng: parseFloat(task.startCoords.lng),
            heading: 0
        });

        EngineUI.log('SIM', `Route compiled entirely. Unit ${task.amb.code} commencing movement...`, 'success');

        try {
            trackingChannel.send({ 
                type: 'broadcast', 
                event: 'route_established', 
                payload: { 
                    ambId: task.amb.id, 
                    incId: task.incId,
                    stage: task.stage,
                    geometry: routeCoords
                } 
            }).catch(()=>{});

            if (task.incId && (task.stage === 'to_incident' || task.stage === 'to_hospital')) {
                const geoJson = { type: "LineString", coordinates: routeCoords.map(c => [c[1], c[0]]) }; 
                await supabase.from(DB_TABLES.INCIDENTS).update({ route_geometry: JSON.stringify(geoJson) }).eq('id', task.incId);
            }
        } catch (e) {
            console.error("Failed to broadcast/save route", e);
        }

        this.isProcessingOsrm = false;
        setTimeout(() => this.processOsrmQueue(), 500);
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
        if(this.isPaused) return;

        let moving = 0;
        let idle = 0;
        let totalSpeed = 0;
        let toInc = 0;
        let toHosp = 0;

        for (const [ambId, mission] of this.activeMissions.entries()) {
            
            const isIdle = (!mission.route || mission.route.length < 2 || 
                mission.stage === 'waiting_driver_action' || 
                mission.stage === 'waiting_hospital_action' || 
                mission.stage === 'waiting_pickup');

            if (isIdle) idle++; else { moving++; totalSpeed += mission.speedKph; }
            if (mission.stage === 'to_incident') toInc++;
            if (mission.stage === 'to_hospital') toHosp++;

            // Absolutely strictly verify that speed is 0 if no valid path exists
            if (isIdle) {
                continue;
            }

            if (mission.currentStep >= mission.route.length - 1) {
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

        if (window.telemetry) {
            window.telemetry.simulation.activeMissions = this.activeMissions.size;
            window.telemetry.simulation.idleEntities = idle;
            window.telemetry.simulation.movingEntities = moving;
            window.telemetry.simulation.toIncident = toInc;
            window.telemetry.simulation.toHospital = toHosp;
            window.telemetry.simulation.avgSpeed = moving > 0 ? (totalSpeed / moving) : 0;
        }
    },

    broadcastPositions() {
        if (!this.isSubscribed || this.activeMissions.size === 0) return;

        const payloads = [];
        for (const [ambId, mission] of this.activeMissions.entries()) {
            const isWaiting = (!mission.route || mission.route.length < 2 || ['waiting_driver_action', 'waiting_hospital_action', 'waiting_pickup'].includes(mission.stage));
            
            payloads.push({
                id: String(ambId), 
                lat: parseFloat(mission.lat) || 30.0444, 
                lng: parseFloat(mission.lng) || 31.2357,
                heading: parseFloat(mission.heading) || 0, 
                speed: isWaiting ? 0 : (parseFloat(mission.speedKph) || 0), 
                stage: mission.stage,
                type: 'ambulance'
            });
            
            // Inject hospital & incident nodes into local payload for complete radar render
            if (mission.startCoords) {
                payloads.push({ id: 'inc_' + mission.incId, lat: mission.targetCoords.lat, lng: mission.targetCoords.lng, type: 'incident' });
            }
            if (mission.hospCoords) {
                payloads.push({ id: 'hosp_' + mission.incId, lat: mission.hospCoords.lat, lng: mission.hospCoords.lng, type: 'hospital' });
            }
        }
        
        trackingChannel.send({ type: 'broadcast', event: 'fleet_update', payload: payloads }).catch(()=>{});
        
        // Push payload direct to UI local DOM for performance
        window.dispatchEvent(new CustomEvent('engine:radar_update', { detail: payloads }));
    },

    async handleArrival(ambId, mission) {
        if (mission.stage === 'patrol') {
            this.activeMissions.delete(ambId);
            this.assignPatrol({ id: ambId, code: mission.amb.code, lat: mission.lat, lng: mission.lng });
        } 
        else if (mission.stage === 'to_incident') {
            mission.stage = 'waiting_pickup';
            await supabase.from(DB_TABLES.INCIDENT_LOGS).insert([{ incident_id: mission.incId, action: 'arrived', performed_by: 'system', note: 'Ambulance arrived at incident location.' }]);
            await supabase.from(DB_TABLES.AMBULANCES).update({ status: 'arrived', lat: mission.lat, lng: mission.lng }).eq('id', ambId);
        } 
        else if (mission.stage === 'to_hospital') {
            mission.stage = 'waiting_hospital_action';
            await supabase.from(DB_TABLES.INCIDENT_LOGS).insert([{ incident_id: mission.incId, action: 'arrived_hospital', performed_by: 'system', note: 'Ambulance arrived at hospital.' }]);
            await supabase.from(DB_TABLES.AMBULANCES).update({ status: 'busy', lat: mission.lat, lng: mission.lng }).eq('id', ambId);
        }
    },

    listenForControls() {
        window.addEventListener('engine:kill_switch', () => {
            if (this.simLoopId) clearInterval(this.simLoopId);
            this.activeMissions.clear();
        });

        window.addEventListener('engine:pause_sim', () => {
            this.isPaused = true;
        });

        window.addEventListener('engine:resume_sim', () => {
            this.isPaused = false;
        });

        window.addEventListener('engine:force_sync', async () => {
            for (const [ambId, mission] of this.activeMissions.entries()) {
                await supabase.from(DB_TABLES.AMBULANCES).update({ lat: mission.lat, lng: mission.lng }).eq('id', ambId);
            }
        });

        window.addEventListener('engine:reset', () => {
            this.activeMissions.clear();
            this.osrmQueue = [];
            this.isPaused = false;
        });
    }
};

window.addEventListener('engine:security_cleared', () => { 
    if (!window.isSessionValid) return;
    setTimeout(() => EngineSimulator.init(), 800); 
});