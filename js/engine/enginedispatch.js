// ============================================================================
// 🧠 EnQaZ Core Engine - Elite AI Dispatcher & Rerouting System (V5.0)
// ============================================================================

import { supabase, DB_TABLES } from '../config/supabase.js';
import { EngineUI } from './engineui.js';

export const EngineDispatch = {
    // Structure: { incId: { candidates: [], currentIdx: 0, retries: 0 } }
    dispatchState: new Map(),

    init() {
        EngineUI.log('SYS', 'Elite Dispatch Engine V5.0 Online.', 'success');
        this.listenForIncidentReady();
    },

    listenForIncidentReady() {
        window.addEventListener('engine:incident_ready', async (e) => {
            const incident = e.detail;
            EngineUI.log('DISPATCH', `New Mission: Incident #${incident.id}. Identifying resources...`, 'system');
            await this.initializeDispatch(incident);
        });
    },

    async initializeDispatch(incident) {
        if (this.dispatchState.has(incident.id)) return; // Prevent duplicate init

        try {
            const incLat = parseFloat(incident.latitude || incident.lat);
            const incLng = parseFloat(incident.longitude || incident.lng);

            if (isNaN(incLat) || isNaN(incLng)) {
                throw new Error("Invalid incident coordinates (NaN). Cannot dispatch.");
            }

            // 1. Fetch available ambulances (Patrol is simulated via 'available')
            const { data: availableAmbs, error: ambErr } = await supabase
                .from(DB_TABLES.AMBULANCES)
                .select('*')
                .in('status', ['available', 'returning']);
            if (ambErr) throw ambErr;

            if (!availableAmbs || availableAmbs.length === 0) {
                this.handleNoResources(incident, 1);
                return;
            }

            // 2. Filter invalid coords & Sort by Haversine
            const validAmbs = availableAmbs.filter(a => !isNaN(parseFloat(a.lat)) && !isNaN(parseFloat(a.lng)));
            validAmbs.sort((a, b) => {
                return this.calculateHaversine(incLat, incLng, parseFloat(a.lat), parseFloat(a.lng)) - 
                       this.calculateHaversine(incLat, incLng, parseFloat(b.lat), parseFloat(b.lng));
            });

            // 3. Select Top 2 ambulances ONLY
            const candidates = validAmbs.slice(0, 2);
            if (candidates.length === 0) {
                this.handleNoResources(incident, 1);
                return;
            }

            // Initialize state for alternating dispatch
            this.dispatchState.set(incident.id, {
                incident: incident,
                candidates: candidates,
                currentIdx: 0,
                retries: 0
            });

            await this.executeDispatchAttempt(incident.id);

        } catch (err) {
            EngineUI.log('ERR', `Dispatch Initialization Failure: ${err.message}`, 'alert');
        }
    },

    async executeDispatchAttempt(incidentId) {
        const state = this.dispatchState.get(incidentId);
        if (!state) return;

        const { incident, candidates, currentIdx, retries } = state;
        const maxRetries = 5;

        if (retries >= maxRetries) {
            EngineUI.log('DISPATCH', `CRITICAL: Incident #${incident.id} FAILED to find resources after ${maxRetries} attempts. Terminating logic.`, 'alert');
            await supabase.from(DB_TABLES.INCIDENTS).update({ status: 'failed' }).eq('id', incident.id);
            this.dispatchState.delete(incidentId);
            return;
        }

        const currentAmb = candidates[currentIdx % candidates.length];
        
        try {
            const incLat = parseFloat(incident.latitude);
            const incLng = parseFloat(incident.longitude);

            // Fetch Hospitals
            const { data: hospitals } = await supabase.from(DB_TABLES.HOSPITALS).select('*');
            const bestHosp = this.findBestHospital(incLat, incLng, currentAmb, hospitals || []);

            if (!bestHosp) {
                throw new Error("No available hospitals to satisfy dispatch constraints.");
            }

            // Assignment
            await this.lockResources(incident.id, currentAmb, bestHosp);
            this.launchDriverWatchdog(incidentId, currentAmb.id);

        } catch (err) {
            EngineUI.log('ERR', `Execution Error during attempt: ${err.message}`, 'alert');
            this.failoverAttempt(incidentId);
        }
    },

    async lockResources(incidentId, ambulance, hospital) {
        if (!incidentId || isNaN(incidentId)) return;
        
        const timestamp = new Date().toISOString();

        // Atomic DB Update
        await supabase.from(DB_TABLES.AMBULANCES).update({ status: 'assigned' }).eq('id', ambulance.id);
        
        await supabase.from(DB_TABLES.INCIDENTS).update({
            status: 'assigned',
            assigned_ambulance_id: ambulance.id,
            assigned_hospital_id: hospital.id,
            updated_at: timestamp
        }).eq('id', incidentId);

        await supabase.from(DB_TABLES.INCIDENT_LOGS).insert([{
            incident_id: incidentId,
            action: 'assigned',
            performed_by: 'AI_ENGINE',
            note: `Unit ${ambulance.code} dispatched. Target: ${hospital.name}`
        }]);

        EngineUI.log('DISPATCH', `Unit ${ambulance.code} locked for Incident #${incidentId}. 15s timer started.`, 'info');
        EngineUI.pushTimeline(`Dispatched ${ambulance.code}`, `Mission #${incidentId} assigned.`, 'dispatch');
    },

    launchDriverWatchdog(incidentId, ambulanceId) {
        if (!incidentId || isNaN(incidentId) || !ambulanceId || isNaN(ambulanceId)) return;
        
        setTimeout(async () => {
            const state = this.dispatchState.get(incidentId);
            if (!state) return; // Mission likely completed/cancelled

            const { data: ambReq, error } = await supabase
                .from(DB_TABLES.AMBULANCES)
                .select('status')
                .eq('id', ambulanceId)
                .single();

            if (error) {
                EngineUI.log('ERR', `Supabase Error checking status: ${error.message}`, 'error');
            }

            if (!ambReq || ambReq.status === 'assigned') {
                // Driver failed to accept in 15 seconds
                EngineUI.log('DISPATCH', `Unit failed to respond. Triggering Failover...`, 'alert');
                EngineUI.pushTimeline(`Driver Timeout`, `Unit missed 15s window. Reassigning.`, 'alert');
                EngineUI.triggerGlobalAlert('driver_timeout');
                
                await supabase.from(DB_TABLES.INCIDENT_LOGS).insert([{
                    incident_id: incidentId,
                    action: 'driver_timeout',
                    performed_by: 'system',
                    note: `Ambulance ignored dispatch. Searching next candidate.`
                }]);

                // Free the failed ambulance (must become available again)
                await supabase.from(DB_TABLES.AMBULANCES).update({ status: 'available' }).eq('id', ambulanceId);
                
                this.failoverAttempt(incidentId);
            } else if (ambReq.status === 'en_route_incident') {
                EngineUI.log('DISPATCH', `Mission Accepted by driver. Simulator tracking taking over.`, 'success');
                EngineUI.pushTimeline(`Driver Accepted`, `Unit taking over Mission #${incidentId}`, 'success');
                this.dispatchState.delete(incidentId); // Success, remove tracking state
            }
        }, 15000); // 15 seconds window
    },

    async failoverAttempt(incidentId) {
        const state = this.dispatchState.get(incidentId);
        if (!state) return;

        state.retries += 1;
        state.currentIdx += 1;

        const maxR = 5;
        if (state.retries >= maxR) {
            this.executeDispatchAttempt(incidentId); // Will trigger failure block
            return;
        }

        // Exponential backoff
        // Retries so far: 1->5s, 2->10s, 3->20s, 4->40s
        const backoffMultiplier = Math.pow(2, state.retries - 1);
        const delayMs = 5000 * backoffMultiplier;

        await supabase.from(DB_TABLES.INCIDENT_LOGS).insert([{
            incident_id: incidentId,
            action: 'reassigned',
            performed_by: 'system',
            note: `Attempting reassignment with Candidate ${state.currentIdx % state.candidates.length === 0 ? 'A' : 'B'}.`
        }]);

        EngineUI.log('DISPATCH', `Failover triggered. Attempting next candidate in ${delayMs/1000}s... (Retry ${state.retries}/${maxR})`, 'warn');
        
        setTimeout(() => {
            this.executeDispatchAttempt(incidentId);
        }, delayMs);
    },

    handleNoResources(incident, attempts) {
        const delayMs = 5000 * Math.pow(2, attempts - 1); // Exponential retry even when zero resources initially found
        const maxRetries = 5;

        if (attempts >= maxRetries) {
            EngineUI.log('DISPATCH', `CRITICAL: No units available. FAILED to dispatch.`, 'alert');
            supabase.from(DB_TABLES.INCIDENTS).update({ status: 'failed' }).eq('id', incident.id).catch(()=>{});
            return;
        }

        EngineUI.log('DISPATCH', `No resources found. Retrying in ${delayMs/1000}s... (Attempt ${attempts}/${maxRetries})`, 'alert');
        setTimeout(() => {
            this.initializeDispatch(incident);
        }, delayMs);
    },

    // Haversine only
    calculateHaversine(lat1, lon1, lat2, lon2) {
        const R = 6371; 
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c; 
    },

    findBestHospital(incLat, incLng, amb, list) {
        if (!list || list.length === 0) return null;
        let best = null;
        let bestScore = -Infinity;

        const ambLat = parseFloat(amb.lat);
        const ambLng = parseFloat(amb.lng);

        list.forEach(item => {
            const hospLat = parseFloat(item.lat);
            const hospLng = parseFloat(item.lng);
            
            if(isNaN(hospLat) || isNaN(hospLng)) return;

            const distAmbToInc = this.calculateHaversine(ambLat, ambLng, incLat, incLng);
            const distIncToHosp = this.calculateHaversine(incLat, incLng, hospLat, hospLng);
            const totalDist = distAmbToInc + distIncToHosp;

            const beds = item.available_beds || 0;
            const score = (beds * 10) - totalDist; 
            
            if (score > bestScore) {
                bestScore = score;
                best = item;
            }
        });
        
        if (best) EngineUI.log('DISPATCH', `Selected Hospital ${best.name} (Score: ${bestScore.toFixed(2)}).`, 'info');
        return best;
    }
};

window.addEventListener('engine:security_cleared', () => {
    if (!window.isSessionValid) return;
    setTimeout(() => EngineDispatch.init(), 1000);
});