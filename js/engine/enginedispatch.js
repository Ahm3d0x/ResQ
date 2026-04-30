// ============================================================================
// 🧠 EnQaZ Core Engine - Elite AI Dispatcher & Rerouting System (V6.0)
// ============================================================================

import { supabase, DB_TABLES, logIncidentAction, isIncidentCancelled } from '../config/supabase.js';
import { EngineUI } from './engineui.js';

export const EngineDispatch = {
    // Structure: { incId: { incident, retries: 0, failedAmbulances: new Set(), timer: null } }
    dispatchState: new Map(),

    init() {
        EngineUI.log('SYS', 'Elite Dispatch Engine V6.0 Online.', 'success');
        this.listenForIncidentReady();
        this.setupDatabaseListeners();
    },

    listenForIncidentReady() {
        window.addEventListener('engine:incident_ready', async (e) => {
            const incident = e.detail;
            EngineUI.log('DISPATCH', `New Mission: Incident #${incident.id}. Identifying resources...`, 'system');
            await this.initializeDispatch(incident);
        });

        window.addEventListener('engine:incident_completed', (e) => {
            const { incidentId } = e.detail;
            this.stopDispatch(incidentId);
        });
    },

    async initializeDispatch(incident) {
        if (this.dispatchState.has(incident.id)) return; // Prevent duplicate init

        const { data: incCheck } = await supabase
            .from(DB_TABLES.INCIDENTS)
            .select('status')
            .eq('id', incident.id)
            .single();
        if (incCheck && isIncidentCancelled(incCheck.status)) {
            console.log(`[DEBUG:DISPATCH_ABORT] initializeDispatch: INC#${incident.id} is already cancelled. Aborting.`);
            return;
        }

        try {
            const incLat = parseFloat(incident.latitude || incident.lat);
            const incLng = parseFloat(incident.longitude || incident.lng);

            if (isNaN(incLat) || isNaN(incLng)) {
                throw new Error("Invalid incident coordinates (NaN). Cannot dispatch.");
            }

            // Initialize minimal dynamic state, clear any ghost failed lists
            this.dispatchState.set(incident.id, {
                incident: incident,
                retries: 0,
                failedAmbulances: new Set(),
                timer: null
            });

            await this.reEvaluateAndDispatch(incident.id);

        } catch (err) {
            EngineUI.log('ERR', `Dispatch Initialization Failure: ${err.message}`, 'alert');
        }
    },

    async reEvaluateAndDispatch(incidentId) {
        if (!this.dispatchState.has(incidentId)) return;
        const state = this.dispatchState.get(incidentId);
        if (!state) return;

        // Ensure no duplicate timers exist during evaluation
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }

        // BEFORE ANY ACTION: FETCH incident.status
        const { data: incCheck } = await supabase.from(DB_TABLES.INCIDENTS).select('status').eq('id', incidentId).single();
        if (incCheck && (isIncidentCancelled(incCheck.status) || incCheck.status === 'completed')) {
            EngineUI.log('DISPATCH', `[DISPATCH] INC#${incidentId} already terminal (${incCheck.status}). Halting.`, 'warn');
            console.log(`[DEBUG:DISPATCH_ABORT] reEvaluateAndDispatch: INC#${incidentId} terminal before attempt. Halting.`);
            this.dispatchState.delete(incidentId);
            return;
        }

        const maxRetries = 5;

        if (state.retries >= maxRetries) {
            EngineUI.log('DISPATCH', `CRITICAL: Incident #${incidentId} FAILED to find resources after ${maxRetries} attempts. Terminating.`, 'alert');
            await supabase.from(DB_TABLES.INCIDENTS).update({ status: 'completed' }).eq('id', incidentId);
            this.stopDispatch(incidentId);
            return;
        }

        const incLat = parseFloat(state.incident.latitude || state.incident.lat);
        const incLng = parseFloat(state.incident.longitude || state.incident.lng);

        EngineUI.log('DISPATCH', `[DISPATCH] RE-EVALUATING AMBULANCES`, 'dim');

        // 1. Fetch ALL currently available ambulances
        const { data: availableAmbs, error: ambErr } = await supabase
            .from(DB_TABLES.AMBULANCES)
            .select('*')
            .in('status', ['available', 'returning']);
        if (ambErr) {
            EngineUI.log('ERR', `Supabase Error fetching ambulances: ${ambErr.message}`, 'error');
        }

        let validAmbs = (availableAmbs || []).filter(a => !isNaN(parseFloat(a.lat)) && !isNaN(parseFloat(a.lng)));

        if (validAmbs.length === 0) {
            this.handleNoResources(state.incident, state.retries + 1);
            return;
        }

        // 2. Filter out recently failed ambulances
        let candidates = validAmbs.filter(a => !state.failedAmbulances.has(a.id));

        // If no ambulances remain after filtering, clear the failed list and retry IMMEDIATELY with full pool
        if (candidates.length === 0) {
            EngineUI.log('DISPATCH', `[DISPATCH] ALL AMBULANCES FAILED, CLEARING LIST & RETRYING WITH FRESH DATA`, 'warn');
            state.failedAmbulances.clear();
            state.retries += 1;
            candidates = validAmbs; 
        }

        EngineUI.log('DISPATCH', `[DISPATCH] NEW DATA FETCHED (${candidates.length} candidates available)`, 'system');

        // 3. Re-sort by Haversine dynamically
        candidates.sort((a, b) => {
            return this.calculateHaversine(incLat, incLng, parseFloat(a.lat), parseFloat(a.lng)) - 
                   this.calculateHaversine(incLat, incLng, parseFloat(b.lat), parseFloat(b.lng));
        });

        const currentAmb = candidates[0];

        try {
            // Re-fetch Hospitals dynamically to ensure bed availability is perfectly up to date
            const { data: hospitals } = await supabase.from(DB_TABLES.HOSPITALS).select('*');
            const bestHosp = this.findBestHospital(incLat, incLng, currentAmb, hospitals || []);

            if (!bestHosp) {
                throw new Error("No available hospitals to satisfy dispatch constraints.");
            }

            // Lock heavily against race conditions
            await this.lockResources(incidentId, currentAmb, bestHosp);
            
            // Re-launch precise watchdog
            this.launchDriverWatchdog(incidentId, currentAmb.id);

        } catch (err) {
            EngineUI.log('ERR', `Execution Error during attempt: ${err.message}`, 'alert');
            this.handleDynamicFailover(incidentId, currentAmb.id);
        }
    },

    // ─── DB-driven fallback: catches terminal transitions even if local events are missed ─────
    setupDatabaseListeners() {
        supabase.channel('dispatch-incident-completion-watch')
            .on('postgres_changes', {
                event: 'UPDATE', schema: 'public', table: DB_TABLES.INCIDENTS
            }, (payload) => {
                const newInc = payload.new;
                const oldInc = payload.old;
                
                // Only react to transitions INTO terminal states
                if (newInc.status === 'completed' && oldInc.status !== 'completed') {
                    console.log(`[LIFECYCLE] DISPATCH: DB-driven stop for completed INC#${newInc.id}`);
                    this.stopDispatch(newInc.id);
                }
                if (isIncidentCancelled(newInc.status) && !isIncidentCancelled(oldInc.status)) {
                    console.log(`[LIFECYCLE] DISPATCH: DB-driven stop for cancelled INC#${newInc.id}`);
                    this.stopDispatch(newInc.id);
                }
            }).subscribe();
    },

    stopDispatch(incidentId) {
        const state = this.dispatchState.get(incidentId);
        if (!state) {
            // Idempotent: already stopped or never tracked — safe no-op
            return;
        }
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }
        this.dispatchState.delete(incidentId);
        EngineUI.log('DISPATCH', `Timers & state for Incident #${incidentId} purged.`, 'dim');
        console.log(`[LIFECYCLE] DISPATCH: State purged for INC#${incidentId}`);
    },

    async lockResources(incidentId, ambulance, hospital) {
        if (!incidentId || isNaN(incidentId)) return;

        // HARDENED: Re-check status atomically before writing.
        // Prevents the race: cancel arrives BETWEEN the status check and actual lock
        const { data: freshCheck } = await supabase
            .from(DB_TABLES.INCIDENTS)
            .select('status')
            .eq('id', incidentId)
            .single();

        if (freshCheck && isIncidentCancelled(freshCheck.status)) {
            EngineUI.log('DISPATCH', `[DISPATCH_ABORT] INC#${incidentId} cancelled just before lockResources. Aborting lock.`, 'warn');
            console.log(`[DEBUG:DISPATCH_ABORT] lockResources aborted: INC#${incidentId} status = ${freshCheck.status}`);
            this.dispatchState.delete(incidentId);
            return;
        }

        const timestamp = new Date().toISOString();

        // Atomic DB Update
        await supabase.from(DB_TABLES.AMBULANCES).update({ status: 'assigned' }).eq('id', ambulance.id);
        
        await supabase.from(DB_TABLES.INCIDENTS).update({
            status: 'assigned',
            assigned_ambulance_id: ambulance.id,
            assigned_hospital_id: hospital.id,
            updated_at: timestamp
        }).eq('id', incidentId);

        await logIncidentAction(incidentId, 'assigned', 'AI_ENGINE', `Unit ${ambulance.code} dispatched. Target: ${hospital.name}`);

        EngineUI.log('DISPATCH', `Unit ${ambulance.code} locked for Incident #${incidentId}. 15s timer started.`, 'info');
        EngineUI.pushTimeline(`Dispatched ${ambulance.code}`, `Mission #${incidentId} assigned.`, 'dispatch');
        
        window.dispatchEvent(new CustomEvent('engine:incident_assigned_for_email', { 
            detail: { 
                incidentId: incidentId, 
                hospitalName: hospital.name, 
                hospLat: parseFloat(hospital.lat), 
                hospLng: parseFloat(hospital.lng) 
            } 
        }));
    },

    launchDriverWatchdog(incidentId, ambulanceId) {
        if (!incidentId || isNaN(incidentId) || !ambulanceId || isNaN(ambulanceId)) return;
        
        const state = this.dispatchState.get(incidentId);
        if (!state) return;

        // Ensure completely clean timer
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }

        EngineUI.log('DISPATCH', `[DISPATCH] WATCHDOG RESET for INC#${incidentId} / AMB#${ambulanceId}`, 'dim');

        // Store timeout ID to prevent ghost executions
        const timeoutId = setTimeout(async () => {
            const currentState = this.dispatchState.get(incidentId);
            if (!currentState) return; // Mission likely stopped/cancelled

            const { data: incCheck } = await supabase.from(DB_TABLES.INCIDENTS).select('status').eq('id', incidentId).single();
            if (incCheck && (isIncidentCancelled(incCheck.status) || incCheck.status === 'completed')) {
                 this.stopDispatch(incidentId);
                 console.log(`[DEBUG:DISPATCH_ABORT] watchdog: INC#${incidentId} is terminal (${incCheck.status}). Clearing mission.`);
                 return;
            }

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
                
                await logIncidentAction(incidentId, 'driver_timeout', 'system', `Ambulance ignored dispatch. Searching next candidate.`);

                this.handleDynamicFailover(incidentId, ambulanceId);
            } else if (ambReq.status === 'en_route_incident') {
                EngineUI.log('DISPATCH', `Mission Accepted by driver. Simulator tracking taking over.`, 'success');
                EngineUI.pushTimeline(`Driver Accepted`, `Unit taking over Mission #${incidentId}`, 'success');
                this.stopDispatch(incidentId); // Success, remove tracking and clear timers
            }
        }, 15000); // 15 seconds window

        state.timer = timeoutId;
    },

    async handleDynamicFailover(incidentId, ambulanceId) {
        const state = this.dispatchState.get(incidentId);
        if (!state) return;

        EngineUI.log('DISPATCH', `[DISPATCH] FAILED AMBULANCE ADDED (${ambulanceId})`, 'warn');
        state.failedAmbulances.add(ambulanceId);
        state.retries += 1;

        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }

        // Release the failed ambulance (must become available again for patrol or later retries)
        await supabase.from(DB_TABLES.AMBULANCES).update({ status: 'available' }).eq('id', ambulanceId);

        EngineUI.log('DISPATCH', `[DISPATCH] RETRY WITH LIVE STATE...`, 'dim');
        await this.reEvaluateAndDispatch(incidentId);
    },

    handleNoResources(incident, attempts) {
        const maxRetries = 5;
        const delayMs = 5000 * Math.pow(2, attempts - 1);

        if (attempts >= maxRetries) {
            EngineUI.log('DISPATCH', `CRITICAL: No units available. FAILED to dispatch.`, 'alert');
            supabase.from(DB_TABLES.INCIDENTS).update({ status: 'completed' }).eq('id', incident.id).catch(()=>{});
            this.dispatchState.delete(incident.id);
            return;
        }

        EngineUI.log('DISPATCH', `No resources found. Retrying in ${delayMs/1000}s... (Attempt ${attempts}/${maxRetries})`, 'alert');

        if (!this.dispatchState.has(incident.id)) {
            this.dispatchState.set(incident.id, { incident, retries: attempts, failedAmbulances: new Set(), timer: null });
        }
        
        const state = this.dispatchState.get(incident.id);
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }

        const timerId = setTimeout(() => {
            if (!this.dispatchState.has(incident.id)) {
                console.log(`[DEBUG:DISPATCH_ABORT] handleNoResources retry cancelled: INC#${incident.id} was stopped during backoff.`);
                return;
            }
            state.retries = attempts; // Sync attempt count
            this.reEvaluateAndDispatch(incident.id);
        }, delayMs);
        state.timer = timerId;
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