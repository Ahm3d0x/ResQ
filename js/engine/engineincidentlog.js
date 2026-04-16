// ============================================================================
// 📡 EnQaZ Core Engine - Hardware Incident Log & Watchdog
// ============================================================================

import { supabase, DB_TABLES } from '../config/supabase.js';
import { EngineUI } from './engineui.js';

export const IncidentLog = {
    watchdogQueue: [],
    watchdogTimer: null,

    init() {
        EngineUI.log('LOG', 'IncidentLog Module initialized. Listening for HW signals...', 'info');
        this.subscribeToHardwareRequests();
        this.startWatchdogLoop();
        this.listenForKillSwitch();
    },

    subscribeToHardwareRequests() {
        supabase.channel('hw-requests-monitor')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: DB_TABLES.HARDWARE_REQUESTS }, (payload) => {
                this.handleIncomingSignal(payload.new);
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    EngineUI.log('NET', 'Connected to Hardware Requests channel.', 'success');
                }
            });
    },

    handleIncomingSignal(req) {
        if (req.request_type === 'alert') {
            const exists = this.watchdogQueue.find(item => item.deviceId === req.device_id);
            if (exists) return;

            this.watchdogQueue.push({
                reqId: req.id,
                uid: `DEV-${req.device_id}`,
                deviceId: req.device_id,
                lat: parseFloat(req.lat),
                lng: parseFloat(req.lng),
                payload: req.raw_payload,
                timeLeft: 10 // Exact 10 seconds watchdog timer
            });

            EngineUI.log('HW', `CRASH SIGNAL: Device ${req.device_id}. 10s countdown started.`, 'alert');
            EngineUI.renderWatchdogQueue(this.watchdogQueue);
        } 
        else if (req.request_type === 'cancel') {
            const index = this.watchdogQueue.findIndex(item => item.deviceId === req.device_id);
            if (index !== -1) {
                this.watchdogQueue.splice(index, 1);
                EngineUI.log('HW', `SIGNAL CANCELLED by user (Device ${req.device_id}). Aborting.`, 'warn');
                EngineUI.renderWatchdogQueue(this.watchdogQueue);
            }
        }
    },

    startWatchdogLoop() {
        this.watchdogTimer = setInterval(() => {
            if (this.watchdogQueue.length === 0) return;

            let queueChanged = false;

            for (let i = this.watchdogQueue.length - 1; i >= 0; i--) {
                const item = this.watchdogQueue[i];
                item.timeLeft -= 1;
                queueChanged = true;

                if (item.timeLeft <= 0) {
                    this.confirmIncident(item);
                    this.watchdogQueue.splice(i, 1);
                }
            }

            if (queueChanged) {
                EngineUI.renderWatchdogQueue(this.watchdogQueue);
            }
        }, 1000);
    },

    async confirmIncident(item) {
        EngineUI.log('SYS', `Timeout reached. Confirming Incident for Device ${item.deviceId}...`, 'system');

        try {
            const { data: devData } = await supabase.from(DB_TABLES.DEVICES).select('user_id').eq('id', item.deviceId).single();

            let speed = 0, gforce = 0;
            try {
                const parsed = JSON.parse(item.payload);
                speed = parseFloat(parsed.speed) || 0;
                gforce = parseFloat(parsed.g_force) || 0;
            } catch(e) {}

            const { data: newInc, error } = await supabase.from(DB_TABLES.INCIDENTS).insert([{
                device_id: item.deviceId,
                user_id: devData ? devData.user_id : null,
                hardware_request_id: item.reqId,
                status: 'pending',
                mode: 'auto',
                latitude: item.lat,
                longitude: item.lng,
                g_force: gforce,
                speed: speed
            }]).select().single();

            if (error) throw error;

            await supabase.from(DB_TABLES.HARDWARE_REQUESTS).update({ incident_id: newInc.id }).eq('id', item.reqId);
            
            await supabase.from(DB_TABLES.INCIDENT_LOGS).insert([{
                incident_id: newInc.id,
                action: 'incident_created',
                performed_by: 'system',
                note: 'Incident automatically confirmed after 10s watchdog timeout.'
            }]);

            EngineUI.log('DB', `Incident #${newInc.id} confirmed. Triggering Dispatcher...`, 'success');
            EngineUI.triggerGlobalAlert('new_incident');
            EngineUI.pushTimeline('Incident Created', `Mission #${newInc.id} generated from Watchdog.`, 'alert');

            window.dispatchEvent(new CustomEvent('engine:incident_ready', { detail: newInc }));

        } catch (err) {
            EngineUI.log('ERR', `Failed to create incident: ${err.message}`, 'alert');
        }
    },

    listenForKillSwitch() {
        window.addEventListener('engine:kill_switch', () => {
            if (this.watchdogTimer) clearInterval(this.watchdogTimer);
            this.watchdogQueue = [];
            EngineUI.renderWatchdogQueue([]);
            EngineUI.log('SYS', 'Watchdog Timer HALTED.', 'dim');
        });
    }
};

window.addEventListener('engine:security_cleared', () => {
    if (!window.isSessionValid) return;
    setTimeout(() => IncidentLog.init(), 500);
});