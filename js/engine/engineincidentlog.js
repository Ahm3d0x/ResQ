// ============================================================================
// 📡 EnQaZ Core Engine - Hardware Incident Log & Watchdog
// ============================================================================

import { supabase, DB_TABLES, logIncidentAction, isIncidentTerminal } from '../config/supabase.js';
import { EngineUI } from './engineui.js';
import { EngineDispatch } from './enginedispatch.js';

export const IncidentLog = {
    watchdogQueue: [],
    watchdogTimer: null,
    // Keyed by INCIDENT ID (not device_id) to prevent false-blocking new incidents
    // for the same device. Populated AFTER the active incident is fetched.
    cancellationsInProgress: new Set(),

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
                // Cancel arrived BEFORE watchdog confirmed — remove from queue, no incident exists yet
                this.watchdogQueue.splice(index, 1);
                EngineUI.log('HW', `SIGNAL CANCELLED by device (Device ${req.device_id}). Aborting watchdog.`, 'warn');
                EngineUI.renderWatchdogQueue(this.watchdogQueue);
                // NOTE: No incident exists yet, so we do NOT call logIncidentAction (incidentId would be null)
                // This is correct by design — the watchdog queue IS the pre-incident state record.
                console.log('[DEBUG:CANCEL_FLOW]', { stage: 'pre_incident_cancel', device_id: req.device_id });
            } else {
                // Cancel arrived AFTER incident was created — process full cancellation
                this.processIncidentCancellation(req.device_id, req.raw_payload);
            }
        }
    },

    async processIncidentCancellation(device_id, payload) {
        // ── Phase 1: Device-level debounce (fast-fail before hitting the DB)
        // This prevents the async function from being entered twice for the SAME device
        // in rapid succession (e.g., hardware cancel + admin cancel within milliseconds)
        // The true atomic lock is the PostgreSQL RPC's FOR UPDATE SKIP LOCKED.
        const deviceLockKey = `dev_${device_id}`;
        if (this.cancellationsInProgress.has(deviceLockKey)) {
            console.log(`[DEBUG:ENGINE_LOCK] Device-level debounce: cancel for device ${device_id} already in-flight. Dropping.`);
            return;
        }
        this.cancellationsInProgress.add(deviceLockKey);

        try {
            // ── Phase 2: Fetch the active incident for this device
            const { data: incident, error: fetchErr } = await supabase
                .from(DB_TABLES.INCIDENTS)
                .select('id, status, assigned_ambulance_id, assigned_hospital_id, device_id')
                .eq('device_id', device_id)
                // Exclude only valid terminal statuses — 'failed' is NOT in incident_status_enum
                .neq('status', 'completed')
                .neq('status', 'cancelled')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (fetchErr) throw fetchErr;

            if (!incident) {
                EngineUI.log('HW', `No active incident found for Device ${device_id}. Cancel signal ignored.`, 'dim');
                console.log('[DEBUG:CANCEL_FLOW]', { stage: 'no_active_incident', device_id });
                return; // Idempotent: clean exit
            }

            // ── Phase 3: Incident-level lock (prevents concurrent cancels for SAME incident
            // from different sources: hardware, admin, simulator)
            const incidentLockKey = `inc_${incident.id}`;
            if (this.cancellationsInProgress.has(incidentLockKey)) {
                console.log(`[DEBUG:ENGINE_LOCK] Incident-level lock: cancel for INC#${incident.id} already in-flight. Dropping.`);
                return;
            }
            this.cancellationsInProgress.add(incidentLockKey);

            // Determine source for logging
            let source = 'device';
            try {
                const parsed = JSON.parse(payload);
                if (parsed.source) source = parsed.source;
            } catch(e) { /* raw_payload may not be JSON */ }

            EngineUI.log('SYS', `[CANCEL_FLOW] Atomic cancellation for Incident #${incident.id}. Source: ${source}.`, 'warn');
            console.log('[DEBUG:CANCEL_FLOW]', { incident_id: incident.id, stage: 'rpc_call_start', source, device_id });

            // ── Phase 4: Atomic DB update via RPC (single transaction)
            // The RPC handles: status update, ambulance release, log insert
            // It uses FOR UPDATE SKIP LOCKED, so it is safe against concurrent calls.
            const { data: rpcResult, error: rpcErr } = await supabase.rpc('rpc_cancel_incident_atomic', {
                target_incident_id: incident.id,
                requester_source: source
            });

            if (rpcErr) throw rpcErr;

            if (rpcResult === false) {
                // RPC returned false = incident was already in terminal state or locked by another TX
                EngineUI.log('SYS', `[CANCEL_FLOW] INC#${incident.id} was already terminal or locked. RPC returned false.`, 'dim');
                console.log('[DEBUG:CANCEL_FLOW]', { incident_id: incident.id, stage: 'rpc_skipped_already_terminal', source });
                return;
            }

            // ── Phase 5: Stop ALL in-memory Engine dispatch timers for this incident
            // This ensures no ghost timers survive to re-trigger lockResources() after cancel.
            EngineDispatch.stopDispatch(incident.id);
            console.log('[DEBUG:DISPATCH_ABORT]', { incident_id: incident.id, stage: 'dispatch_stopped', source });

            EngineUI.log('SYS', `[CANCEL_FLOW] Incident #${incident.id} fully cancelled. All timers cleared.`, 'success');
            console.log('[DEBUG:CANCEL_FLOW]', { incident_id: incident.id, stage: 'atomic_completed', source });

        } catch (err) {
            EngineUI.log('ERR', `Hardened Cancellation Failed: ${err.message}`, 'alert');
            console.error('[DEBUG:CANCEL_FLOW] ERROR:', err);
        } finally {
            // Always release BOTH locks
            this.cancellationsInProgress.delete(`dev_${device_id}`);
            // Note: inc_ lock is released too (it was added inside the try block)
            // We can't directly reference incident.id here if fetch failed, so we clean all inc_ entries
            // for safety by iterating (max 1-2 entries in practice)
            for (const key of this.cancellationsInProgress) {
                if (key.startsWith('inc_')) this.cancellationsInProgress.delete(key);
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
            
            await logIncidentAction(newInc.id, 'incident_created', 'system', 'Incident automatically confirmed after 10s watchdog timeout.');

            EngineUI.log('DB', `Incident #${newInc.id} confirmed. Triggering Dispatcher...`, 'success');
            EngineUI.triggerGlobalAlert('new_incident');
            EngineUI.pushTimeline('Incident Created', `Mission #${newInc.id} generated from Watchdog.`, 'alert');

            window.dispatchEvent(new CustomEvent('engine:incident_ready', { detail: newInc }));

        } catch (err) {
            EngineUI.log('ERR', `Failed to create incident: ${err.message}`, 'alert');
        }
    },

    listenForKillSwitch() {
        window.addEventListener('engine:incident_assigned_for_email', (e) => {
            const { incidentId, hospitalName, hospLat, hospLng } = e.detail;
            this.sendEmergencyAlerts(incidentId, hospitalName, hospLat, hospLng);
        });
        
        window.addEventListener('engine:kill_switch', () => {
            if (this.watchdogTimer) clearInterval(this.watchdogTimer);
            this.watchdogQueue = [];
            EngineUI.renderWatchdogQueue([]);
            EngineUI.log('SYS', 'Watchdog Timer HALTED.', 'dim');
        });
    },

    async sendEmergencyAlerts(incidentId, hospitalName, hospLat, hospLng) {
        try {
            // 1. Fetch Incident and Device Data
            const { data: incident } = await supabase.from('incidents')
                .select('lat, longitude, latitude, longitude, devices(application_id, users(name))')
                .eq('id', incidentId)
                .single();
                
            if (!incident || !incident.devices || !incident.devices.application_id) return;

            const lat = parseFloat(incident.lat || incident.latitude);
            const lng = parseFloat(incident.longitude);
            const app_id = incident.devices.application_id;

            // 2. Fetch Application for emergency contacts
            const { data: app } = await supabase.from('device_applications')
                .select('emergency1_name, emergency1_email, emergency2_name, emergency2_email, email, car_plate, car_model, car_brand')
                .eq('id', app_id)
                .single();

            if (!app) return;

            // 3. Prepare the dynamic HTML message
            const gmapsInc = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
            const gmapsHosp = (hospLat && hospLng) ? `https://www.google.com/maps/search/?api=1&query=${hospLat},${hospLng}` : '';
            const currentYear = new Date().getFullYear();
            
            const msgHtml = `
            <!DOCTYPE html>
            <html lang="ar" dir="rtl">
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; }
                    .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
                    .header { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 30px 20px; text-align: center; color: white; }
                    .header img { width: 80px; margin-bottom: 15px; background: white; padding: 10px; border-radius: 50%; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                    .header h1 { margin: 0; font-size: 24px; font-weight: 800; text-shadow: 0 2px 4px rgba(0,0,0,0.2); }
                    .content { padding: 30px; text-align: right; color: #334155; }
                    .content p { font-size: 16px; line-height: 1.6; margin-bottom: 20px; }
                    .highlight { font-weight: bold; color: #ef4444; }
                    .card { background: #fef2f2; border: 1px solid #fca5a5; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
                    .card-item { margin-bottom: 12px; font-size: 15px; border-bottom: 1px dashed #fecaca; padding-bottom: 12px; }
                    .card-item:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
                    .card-item strong { display: inline-block; width: 120px; color: #991b1b; }
                    .btn { display: inline-block; background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: bold; text-align: center; }
                    .btn-red { background: #ef4444; }
                    .footer { background: #0f172a; color: #94a3b8; text-align: center; padding: 20px; font-size: 13px; line-height: 1.5; }
                    .footer strong { color: #f8fafc; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <img src="https://i.ibb.co/3W6nQ8k/logo.png" alt="EnQaZ Logo">
                        <h1>🚨 إنذار طوارئ عاجل 🚨</h1>
                    </div>
                    
                    <div class="content">
                        <p>عزيزي المشترك،<br>تم رصد <span class="highlight">حادث اصطدام</span> لمركبة مسجلة في نظام إنقاذ باسم: <strong>${incident.devices.users?.name || 'مجهول'}</strong>.</p>
                        
                        <div class="card">
                            <div class="card-item"><strong>رقم الحادث:</strong> #${incidentId}</div>
                            <div class="card-item"><strong>المركبة:</strong> ${app.car_brand} ${app.car_model} (${app.car_plate})</div>
                            <div class="card-item"><strong>المستشفى الموجه إليه:</strong> ${hospitalName || 'جاري التحديد'}</div>
                            <div class="card-item" style="margin-top: 15px;">
                                <a href="${gmapsInc}" class="btn btn-red" style="color:white !important;">📍 موقع الحادث</a>
                                ${gmapsHosp ? `<a href="${gmapsHosp}" class="btn" style="color:white !important; margin-right: 5px;">🏥 موقع المستشفى</a>` : ''}
                            </div>
                        </div>
                        
                        <p style="font-size: 14px; color: #64748b;">فرق الإسعاف التابعة للنظام في طريقها الآن للتعامل مع الحالة. يرجى التوجه إلى المستشفى المذكور أو التواصل مع الجهات المعنية.</p>
                    </div>
                    
                    <div class="footer">
                        <p>إدارة تحت إشراف <strong>فريق إنقاذ</strong></p>
                        <p>جميع الحقوق محفوظة لفريق إنقاذ &copy; ${currentYear}</p>
                    </div>
                </div>
            </body>
            </html>
            `;

            const serviceID = "service_j22noer"; 
            const templateID = "template_79afdrq"; 
            const publicKey = "YKJgvPCGxkJif7-o3";

            const contacts = [];
            if (app.emergency1_email && app.emergency1_email.trim() !== '') {
                contacts.push({ name: app.emergency1_name, email: app.emergency1_email });
            }
            if (app.emergency2_email && app.emergency2_email.trim() !== '') {
                contacts.push({ name: app.emergency2_name, email: app.emergency2_email });
            }
            
            // Fallback to user email if no emergency emails are provided
            if (contacts.length === 0 && app.email) {
                contacts.push({ name: incident.devices.users?.name || 'مستخدم النظام', email: app.email });
            }

            for (const contact of contacts) {
                const emailParams = {
                    name: 'EnQaZ Emergency System',
                    to_name: contact.name || 'جهة اتصال الطوارئ',
                    to_email: contact.email,
                    reason: '',
                    message: msgHtml
                };
                await emailjs.send(serviceID, templateID, emailParams, publicKey);
            }
            EngineUI.log('SYS', `Emergency Alert Emails Sent (${contacts.length} recipients) via EmailJS for Incident #${incidentId}`, 'success');

        } catch (error) {
            console.error("Failed to send emergency alerts:", error);
            EngineUI.log('ERR', `Failed to send Emergency Email: ${error.message}`, 'alert');
        }
    }
};

window.addEventListener('engine:security_cleared', () => {
    if (!window.isSessionValid) return;
    setTimeout(() => IncidentLog.init(), 500);
});