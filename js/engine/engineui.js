// ============================================================================
// 🖥️ EnQaZ Core Engine - UI & Telemetry Controller
// ============================================================================
import { supabase } from '../config/supabase.js';

window.telemetry = {
    simulation: { movingEntities: 0, idleEntities: 0, avgSpeed: 0, toIncident: 0, toHospital: 0, activeMissions: 0, entitiesTracked: 0 },
    database: { ambTotal: 0, ambAvail: 0, ambBusy: 0, ambPatrol: 0, incActive: 0, incCompleted: 0, hospOcc: 0, hospTotal: 0 },
    hybrid: { ttIncident: '--', ttHospital: '--', dispRate: 0 },
    osrm: { success: 0, fail: 0, avgTime: 0, requests: 0, totalTime: 0 },
    perf: { fps: 0, latency: 0, tickStart: Date.now(), frames: 0 }
};

export const EngineUI = {
    startTime: Date.now(),
    uptimeInterval: null,
    statInterval: null,
    renderLoopId: null,
    canvas: null,
    ctx: null,

    els: {},

    init() {
        this.cacheDom();
        this.startUptime();
        this.setupEventListeners();
        this.initRadar();
        this.startStatsSync();
        this.listenToActionLogs();
        this.startRenderingLoop();
        this.log('SYS', 'EngineUI Telemetry Grid Initialized.', 'success');
        
        window.addEventListener('engine:radar_update', (e) => {
            this.drawRadar(e.detail);
        });
    },

    cacheDom() {
        const ids = [
            'terminal-output', 'event-timeline', 'db-latency', 'osrm-status', 'sys-tick', 'tel-active-missions',
            'tel-radar-entities', 'tel-radar-paths', 'tel-fps', 'tel-api-latency', 'tel-sim-moving', 
            'tel-sim-idle', 'tel-sim-avgspeed', 'tel-sim-toinc', 'tel-sim-tohosp', 'tel-db-avail', 
            'tel-db-busy', 'tel-db-patrol', 'tel-db-inc-active', 'tel-db-inc-comp', 'tel-db-beds', 
            'tel-hyb-tti', 'tel-hyb-tth', 'tel-hyb-disp', 'tel-osrm-ratio', 'tel-osrm-avg',
            'watchdog-queue', 'routing-queue', 'tel-engine-state'
        ];
        ids.forEach(id => {
            this.els[id] = document.getElementById(id);
        });
    },

    startUptime() {
        this.uptimeInterval = setInterval(() => {
            const diff = Math.floor((Date.now() - this.startTime) / 1000);
            const h = String(Math.floor(diff / 3600)).padStart(2, '0');
            const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
            const s = String(diff % 60).padStart(2, '0');
            // Can update top bar uptime if needed
        }, 1000);
    },
    
    initRadar() {
        this.canvas = document.getElementById('radar-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        
        const resizeCanvas = () => {
            const parent = this.canvas.parentElement;
            this.canvas.width = parent.clientWidth;
            this.canvas.height = parent.clientHeight;
        };
        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();
        this.drawRadar([]);
    },

    drawRadarBackground(w, h, cx, cy) {
        this.ctx.clearRect(0, 0, w, h);

        const grad = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w,h)/2);
        grad.addColorStop(0, 'rgba(0, 255, 65, 0.08)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        this.ctx.fillStyle = grad;
        this.ctx.fillRect(0,0,w,h);

        this.ctx.strokeStyle = '#008f1133';
        this.ctx.lineWidth = 1;
        
        for (let i = 1; i <= 4; i++) {
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, (Math.min(w, h) / 2.2) * (i / 4), 0, 2 * Math.PI);
            this.ctx.stroke();
        }

        this.ctx.setLineDash([5, 5]);
        this.ctx.beginPath();
        this.ctx.moveTo(cx, 0); this.ctx.lineTo(cx, h);
        this.ctx.moveTo(0, cy); this.ctx.lineTo(w, cy);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
    },

    drawRadar(entities) {
        if (!this.ctx) return;
        
        telemetry.simulation.entitiesTracked = entities.length;

        const w = this.canvas.width;
        const h = this.canvas.height;
        const cx = w / 2;
        const cy = h / 2;

        this.drawRadarBackground(w, h, cx, cy);

        const BASE_LAT = 30.0444; 
        const BASE_LNG = 31.2357; 
        const SCALE = Math.min(w, h) * 1.5;

        // Draw Trails (Simulated) & Entities
        entities.forEach(ent => {
            if (isNaN(ent.lat) || isNaN(ent.lng)) return;
            
            const dx = (ent.lng - BASE_LNG) * Math.cos(BASE_LAT * Math.PI / 180);
            const dy = ent.lat - BASE_LAT;

            const x = cx + (dx * SCALE);
            const y = cy - (dy * SCALE);

            let color = '#00ff41'; // Green
            if (ent.type === 'incident') color = '#ff003c'; // Red
            if (ent.type === 'hospital') color = '#3b82f6'; // Blue
            if (ent.stage === 'to_incident') color = '#ff003c'; 
            if (ent.stage === 'to_hospital') color = '#a855f7'; 
            if (ent.stage === 'patrol') color = '#008f11';

            this.ctx.beginPath();
            this.ctx.arc(x, y, 4, 0, 2 * Math.PI);
            this.ctx.fillStyle = color;
            this.ctx.fill();
            this.ctx.strokeStyle = '#fff';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
            
            if (ent.type === 'incident' || ent.speed > 5) {
                 this.ctx.beginPath();
                 const pulseSize = 6 + (Math.sin(Date.now() / 200) * 4);
                 this.ctx.arc(x, y, pulseSize, 0, 2 * Math.PI);
                 this.ctx.strokeStyle = color + '80';
                 this.ctx.lineWidth = 2;
                 this.ctx.stroke();
            }
        });

        const time = Date.now() / 1000;
        this.ctx.beginPath();
        this.ctx.moveTo(cx, cy);
        this.ctx.lineTo(cx + Math.cos(time) * Math.min(w,h), cy + Math.sin(time) * Math.min(w,h));
        this.ctx.strokeStyle = '#00ff41';
        this.ctx.lineWidth = 1.5;
        this.ctx.stroke();
    },

    async startStatsSync() {
        this.syncStats();
        this.statInterval = setInterval(() => this.syncStats(), 5000);
    },

    async syncStats() {
        try {
            const start = Date.now();
            
            // 1. Ambulances
            const { data: amb } = await supabase.from('ambulances').select('status');
            if (amb) {
                telemetry.database.ambTotal = amb.length;
                telemetry.database.ambAvail = amb.filter(a => a.status === 'available').length;
                telemetry.database.ambBusy = amb.filter(a => a.status === 'busy' || a.status === 'assigned' || a.status.includes('en_route') || a.status === 'arrived').length;
                telemetry.database.ambPatrol = amb.filter(a => a.status === 'patrol').length;
            }

            // 2. Incidents
            const { data: inc } = await supabase.from('incidents').select('status');
            if (inc) {
                telemetry.database.incActive = inc.filter(i => i.status === 'assigned' || i.status === 'in_progress').length;
                telemetry.database.incCompleted = inc.filter(i => i.status === 'completed').length;
                
                // Hybrid Calculation
                const total = inc.length;
                telemetry.hybrid.dispRate = total > 0 ? Math.round((telemetry.database.incCompleted / total) * 100) : 0;
            }

            // 3. Hospitals
            const { data: beds } = await supabase.from('hospital_beds').select('status');
            if (beds) {
                telemetry.database.hospTotal = beds.length;
                telemetry.database.hospOcc = beds.filter(b => b.status === 'occupied').length;
            }

            const latency = Date.now() - start;
            telemetry.perf.latency = latency;

        } catch (e) {
            if (window.DEBUG) console.error("Stats Sync Error:", e);
            telemetry.perf.latency = 999;
        }
    },

    startRenderingLoop() {
        const loop = () => {
            telemetry.perf.frames++;
            const now = Date.now();
            if (now - telemetry.perf.tickStart >= 1000) {
                telemetry.perf.fps = telemetry.perf.frames;
                telemetry.perf.frames = 0;
                telemetry.perf.tickStart = now;
            }

            this.updateDomElements();
            this.renderLoopId = requestAnimationFrame(loop);
        };
        this.renderLoopId = requestAnimationFrame(loop);
    },

    updateDomElements() {
        const el = this.els;
        const tel = window.telemetry;

        if (el['db-latency']) {
            el['db-latency'].innerText = `${tel.perf.latency}ms`;
            el['db-latency'].className = tel.perf.latency > 500 ? 'text-term-alert font-bold' : 'text-term-text font-bold';
        }

        if (el['sys-tick']) el['sys-tick'].innerText = `${tel.perf.fps} TPS`;
        if (el['tel-fps']) el['tel-fps'].innerText = tel.perf.fps;
        if (el['tel-api-latency']) {
            el['tel-api-latency'].innerText = `${tel.perf.latency}ms`;
            el['tel-api-latency'].className = tel.perf.latency > 500 ? 'text-base font-bold text-term-alert' : 'text-base font-bold text-term-text';
        }

        if (el['tel-radar-entities']) el['tel-radar-entities'].innerText = tel.simulation.entitiesTracked;
        if (el['tel-active-missions']) el['tel-active-missions'].innerText = tel.simulation.activeMissions;
        
        // Simulation Physics
        if (el['tel-sim-moving']) el['tel-sim-moving'].innerText = tel.simulation.movingEntities;
        if (el['tel-sim-idle']) el['tel-sim-idle'].innerText = tel.simulation.idleEntities;
        if (el['tel-sim-avgspeed']) el['tel-sim-avgspeed'].innerText = `${Math.round(tel.simulation.avgSpeed)} km/h`;
        if (el['tel-sim-toinc']) el['tel-sim-toinc'].innerText = tel.simulation.toIncident;
        if (el['tel-sim-tohosp']) el['tel-sim-tohosp'].innerText = tel.simulation.toHospital;
        if (el['tel-radar-paths']) el['tel-radar-paths'].innerText = tel.simulation.movingEntities;

        // DB Stats
        if (el['tel-db-avail']) el['tel-db-avail'].innerText = tel.database.ambAvail;
        if (el['tel-db-busy']) el['tel-db-busy'].innerText = tel.database.ambBusy;
        if (el['tel-db-patrol']) el['tel-db-patrol'].innerText = tel.database.ambPatrol;
        if (el['tel-db-inc-active']) el['tel-db-inc-active'].innerText = tel.database.incActive;
        if (el['tel-db-inc-comp']) el['tel-db-inc-comp'].innerText = tel.database.incCompleted;
        if (el['tel-db-beds']) el['tel-db-beds'].innerText = `${tel.database.hospOcc} / ${tel.database.hospTotal}`;

        // Hybrid
        if (el['tel-hyb-disp']) el['tel-hyb-disp'].innerText = `${tel.hybrid.dispRate}%`;

        // OSRM
        if (el['tel-osrm-ratio']) el['tel-osrm-ratio'].innerText = `S:${tel.osrm.success} | F:${tel.osrm.fail}`;
        const avgOsrm = tel.osrm.requests > 0 ? (tel.osrm.totalTime / tel.osrm.requests) : 0;
        if (el['tel-osrm-avg']) el['tel-osrm-avg'].innerText = `${Math.round(avgOsrm)}ms`;
    },

    listenToActionLogs() {
        supabase.channel('engine-action-logs')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'incident_logs' }, (payload) => {
                this.pushTimeline(payload.new.action, payload.new.note || 'System Event logged.', 'info');
            }).subscribe();
    },

    log(module, message, level = 'info') {
        const terminal = this.els['terminal-output'];
        if (!terminal) return;
        if (window.DEBUG) console.log(`[${module}] ${message}`);

        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        
        let colorClass = 'text-term-dim'; 
        if (level === 'info') colorClass = 'text-term-text'; 
        if (level === 'warn') colorClass = 'text-term-warn'; 
        if (level === 'error' || level === 'alert') colorClass = 'text-term-alert'; 
        if (level === 'success') colorClass = 'text-blue-500'; 
        if (level === 'system') colorClass = 'text-purple-500'; 

        const entry = document.createElement('div');
        entry.className = `log-entry ${colorClass} leading-tight text-[10px]`;
        entry.innerHTML = `<span class="opacity-50">[${timeStr}]</span> <span class="font-bold">[${module}]</span> ${message}`;

        terminal.appendChild(entry);
        if (terminal.childElementCount > 100) terminal.removeChild(terminal.firstChild);
        terminal.scrollTop = terminal.scrollHeight;
    },

    pushTimeline(action, details, level = 'info') {
        const timeline = this.els['event-timeline'];
        if (!timeline) return;

        let icon = '<i class="fa-solid fa-info-circle"></i>';
        let colorClass = 'text-term-text';
        if (action === 'dispatch' || action === 'assigned') { icon = '<i class="fa-solid fa-bolt"></i>'; colorClass = 'text-purple-500'; }
        if (action.includes('error') || level === 'alert') { icon = '<i class="fa-solid fa-triangle-exclamation"></i>'; colorClass = 'text-term-alert'; }

        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        const entry = document.createElement('div');
        entry.className = `border-l-2 border-term-dim/30 pl-2 py-1 mb-1 log-entry`;
        entry.innerHTML = `<div class="${colorClass} font-bold text-[10px]">${icon} ${action.toUpperCase()} <span class="text-term-dim/50 font-normal text-[8px] ml-1">(${timeStr})</span></div><div class="text-term-dim text-[10px]">${details}</div>`;

        timeline.insertBefore(entry, timeline.firstChild);
        if (timeline.childElementCount > 10) timeline.removeChild(timeline.lastChild);
    },

    triggerGlobalAlert(type) {
        const body = document.getElementById('engine-body');
        if (!body) return;
        body.classList.remove('alert-flash-red', 'alert-flash-yellow');
        void body.offsetWidth; // reflow
        if (type === 'new_incident') body.classList.add('alert-flash-red');
        else if (type === 'driver_timeout') body.classList.add('alert-flash-yellow');
    },

    renderWatchdogQueue(items) {
        const queue = this.els['watchdog-queue'];
        if (!queue) return;
        if (!items || items.length === 0) {
            queue.innerHTML = '<div class="text-center text-term-dim/50 text-[10px] mt-2">Queue is empty</div>';
            return;
        }

        queue.innerHTML = items.map(item => {
            const progressWidth = (item.timeLeft / 10) * 100;
            const colorClass = item.timeLeft <= 3 ? 'bg-term-alert' : 'bg-term-warn';
            return `
            <div class="bg-black border border-term-dim/20 rounded p-1 mb-1">
                <div class="flex justify-between mb-1 text-[9px] uppercase font-bold">
                    <span class="text-term-text">${item.uid}</span>
                    <span class="text-term-dim">${item.timeLeft}s</span>
                </div>
                <div class="w-full bg-gray-900 h-1 rounded overflow-hidden">
                    <div class="h-full ${colorClass} transition-all duration-1000 ease-linear" style="width: ${progressWidth}%"></div>
                </div>
            </div>`;
        }).join('');
    },

    renderRoutingQueue(items) {
        const queue = this.els['routing-queue'];
        if (!queue) return;
        if (!items || items.length === 0) {
            queue.innerHTML = '<div class="text-center text-term-dim/50 mt-2">Queue is idle</div>';
            return;
        }
        queue.innerHTML = items.map(item => `
            <div class="bg-black border border-[#ff00e5]/20 rounded p-1 mb-1 flex justify-between items-center text-[9px] uppercase font-bold">
                <span class="text-[#ff00e5]"><i class="fa-solid fa-microchip mr-1"></i> ${item.ambCode}</span>
                <span class="text-[#ff00e5]/70 animate-pulse">${item.status}</span>
            </div>
        `).join('');
    },

    async forceSync() {
        this.log('SYS', 'FORCE SYNC initiated. Aligning DB...', 'warn');
        try {
            const { data: ambulances } = await supabase.from('ambulances').select('id');
            if (ambulances) {
                window.dispatchEvent(new Event('engine:force_sync'));
                this.log('DB', 'Sync command processed.', 'success');
            }
        } catch(e) {
            this.log('ERR', 'Sync failed.', 'error');
        }
    },

    setupEventListeners() {
        const clearBtn = document.getElementById('clear-logs-btn');
        const killBtn = document.getElementById('btn-kill-switch');
        const btnSync = document.getElementById('btn-force-sync');
        const btnPause = document.getElementById('btn-pause-sim');
        const btnResume = document.getElementById('btn-resume-sim');
        const btnDispatch = document.getElementById('btn-force-dispatch');
        const btnReset = document.getElementById('btn-reset-engine');

        if (clearBtn) clearBtn.addEventListener('click', () => { if (this.els['terminal-output']) this.els['terminal-output'].innerHTML = ''; });
        if (killBtn) killBtn.addEventListener('click', () => {
            this.log('ALERT', 'MASTER KILL SWITCH ACTIVATED! Stopping all loops.', 'alert');
            document.body.classList.add('bg-term-alert/10');
            window.dispatchEvent(new Event('engine:kill_switch'));
            if(this.els['tel-engine-state']) { this.els['tel-engine-state'].innerText = 'HALTED'; this.els['tel-engine-state'].className = 'text-term-alert font-bold animate-pulse'; }
        });
        if (btnSync) btnSync.addEventListener('click', () => this.forceSync());
        if (btnPause) btnPause.addEventListener('click', () => {
             window.dispatchEvent(new Event('engine:pause_sim'));
             this.log('SYS', 'Simulation PAUSED.', 'warn');
             if(this.els['tel-engine-state']) { this.els['tel-engine-state'].innerText = 'PAUSED'; this.els['tel-engine-state'].className = 'text-term-warn font-bold hover:animate-pulse'; }
        });
        if (btnResume) btnResume.addEventListener('click', () => {
             window.dispatchEvent(new Event('engine:resume_sim'));
             this.log('SYS', 'Simulation RESUMED.', 'success');
             if(this.els['tel-engine-state']) { this.els['tel-engine-state'].innerText = 'ONLINE'; this.els['tel-engine-state'].className = 'text-term-text font-bold'; }
        });
        if (btnDispatch) btnDispatch.addEventListener('click', async () => {
             const { data: orphans } = await supabase.from('incidents').select('*').eq('status', 'pending');
             if (orphans && orphans.length > 0) orphans.forEach(inc => window.dispatchEvent(new CustomEvent('engine:incident_ready', { detail: inc })));
             else this.log('DISPATCH', 'No pending incidents.', 'dim');
        });
        if (btnReset) btnReset.addEventListener('click', () => {
             this.log('SYS', 'Engine RESET. Clearing state...', 'alert');
             window.dispatchEvent(new Event('engine:reset'));
        });
    }
};