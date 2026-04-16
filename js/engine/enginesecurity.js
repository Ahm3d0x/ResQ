// ============================================================================
// 🛡️ EnQaZ Core Engine - Absolute Single Active Session Control
// ============================================================================
import { supabase, DB_TABLES } from '../config/supabase.js';

window.isSessionValid = false;

export const EngineSecurity = {
    sessionId: null, 
    heartbeatLoop: null,
    dbSessionChannel: null,

    els: {
        overlay: null,
        statusText: null,
        btnTakeover: null,
        btnExit: null
    },

    async init() {
        this.cacheDOM();

        // MULTI-TAB PREVENTION: Self-destruct if session overlaps
        window.addEventListener('storage', (e) => {
            if (e.key === "ENGINE_SESSION") {
                this.blockMultiTab();
            }
        });

        try {
            this.updateStatus("Authenticating Authority...");
            await this.verifyAuthentication();

            this.updateStatus("Verifying Single Session Matrix...");
            await this.handleSessionLock();

        } catch (error) {
            this.lockdown(error.message);
        }
    },

    cacheDOM() {
        this.els.overlay = document.getElementById('engine-ui-security-layer');
        this.els.statusText = document.getElementById('sec-layer-text');
        this.els.btnTakeover = document.getElementById('sec-btn-takeover');
        this.els.btnExit = document.getElementById('sec-btn-exit');

        if (this.els.btnTakeover) {
            this.els.btnTakeover.addEventListener('click', () => this.executeTakeover());
        }
        if (this.els.btnExit) {
            this.els.btnExit.addEventListener('click', () => {
                localStorage.removeItem("ENGINE_SESSION");
                window.location.replace('../index.html');
            });
        }
    },

    updateStatus(msg) {
        if (this.els.statusText) this.els.statusText.innerText = msg;
        console.log(`[SECURITY] ${msg}`);
    },

    async verifyAuthentication() {
        const sessionKey = localStorage.getItem("ENGINE_SESSION");
        if (!sessionKey || sessionKey.trim() === '') {
            window.location.replace('engine-login.html');
            throw new Error('Valid Engine Key Missing.');
        }

        this.sessionId = sessionKey;
    },

    async handleSessionLock() {
        // GLOBAL SESSION LOCK LOGIC
        const { data: activeSessions, error } = await supabase
            .from(DB_TABLES.ENGINE_SESSIONS)
            .select('*')
            .eq('is_active', true)
            .limit(1);

        if (error) {
            throw new Error("Unable to read session states. Database offline?");
        }

        if (activeSessions && activeSessions.length > 0) {
            const activeSession = activeSessions[0];
            
            // Check DEAD SESSION CLEANUP (10 seconds timeout)
            const now = Date.now();
            const tz = new Date(activeSession.last_ping).getTime();
            if ((now - tz) > 10000) {
                // Dead - Auto-release and take over silently
                console.log("[session_expired] Old session purged silently.");
                await supabase.from(DB_TABLES.ENGINE_SESSIONS).update({ is_active: false }).eq('id', activeSession.id);
                await this.registerNewSession();
                return;
            }

            if (activeSession.session_id === this.sessionId) {
                // ALLOW 
                this.grantAccess();
            } else {
                // BLOCK ENGINE COMPLETELY 
                this.showConflictResolution();
                console.log("[session_blocked] Execution halted. Another origin running.");
            }
        } else {
            // No sessions running - allow!
            await this.registerNewSession();
        }
    },

    async registerNewSession() {
        try {
            await supabase.from(DB_TABLES.ENGINE_SESSIONS).insert([{
                session_id: this.sessionId,
                is_active: true,
                last_ping: new Date().toISOString()
            }]);

            this.grantAccess();
        } catch (e) {
            throw new Error(`DB Rejection. Run the SQL fix for user_id! Err: ${e.message}`);
        }
    },

    showConflictResolution() {
        this.updateStatus("Access Control: ⚠️ Engine globally locked by another active session.");
        
        if (this.els.btnTakeover) this.els.btnTakeover.classList.remove('hidden');
        if (this.els.btnExit) this.els.btnExit.classList.remove('hidden');
    },

    async executeTakeover() {
        this.updateStatus("Executing System Hijack...");
        if (this.els.btnTakeover) this.els.btnTakeover.classList.add('hidden');
        if (this.els.btnExit) this.els.btnExit.classList.add('hidden');

        // STEP 1: Deactivate DB active sessions
        await supabase.from(DB_TABLES.ENGINE_SESSIONS).update({ is_active: false }).eq('is_active', true);
        
        // STEP 2: Generate brand new local session footprint to break cache bounds
        this.sessionId = crypto.randomUUID();
        localStorage.setItem("ENGINE_SESSION", this.sessionId);

        console.log("[session_taken_over] Network overridden.");

        setTimeout(async () => {
             await this.registerNewSession();
        }, 800);
    },

    grantAccess() {
        this.updateStatus("Authorization complete. Engine running.");
        window.isSessionValid = true;

        if (this.els.overlay) {
            this.els.overlay.classList.add('opacity-0');
            setTimeout(() => this.els.overlay.style.display = 'none', 500);
        }

        this.startHeartbeat();
        this.subscribeToEviction();
        this.setupUnloadTrap();

        window.dispatchEvent(new Event('engine:security_cleared'));
    },

    lockdown(reason) {
        window.isSessionValid = false;
        this.updateStatus(`CRITICAL STOP: ${reason}`);
        if (this.els.overlay) {
            this.els.overlay.style.display = 'flex';
            this.els.overlay.classList.add('bg-term-alert/20');
        }
        if (this.els.btnExit) this.els.btnExit.classList.remove('hidden');
        if (this.els.btnTakeover) this.els.btnTakeover.classList.add('hidden');
    },

    blockMultiTab() {
        window.isSessionValid = false;
        clearInterval(this.heartbeatLoop);
        window.dispatchEvent(new Event('engine:kill_switch'));

        // Rip entire page body output into a blocked slate per requested instruction fail-safe
        document.body.innerHTML = `
            <div class="fixed inset-0 z-[999999] bg-black flex flex-col justify-center items-center">
                <i class="fa-solid fa-triangle-exclamation text-8xl text-red-600 mb-6 animate-pulse"></i>
                <h1 class="text-4xl font-bold text-red-600 tracking-widest uppercase mb-4 text-center">Engine Terminated</h1>
                <p class="text-gray-400 text-lg uppercase tracking-wide">Multi-Tab replication is strictly prohibited.</p>
            </div>
        `;
    },

    startHeartbeat() {
        // Ping every 5 seconds
        this.heartbeatLoop = setInterval(async () => {
            if (!window.isSessionValid) return;
            const { error } = await supabase.from(DB_TABLES.ENGINE_SESSIONS)
                .update({ last_ping: new Date().toISOString() })
                .eq('session_id', this.sessionId)
                .eq('is_active', true);

            if (error) console.error("Heartbeat sync failed.");
        }, 5000);
    },

    subscribeToEviction() {
        // REAL-TIME SESSION KILL
        this.dbSessionChannel = supabase.channel('engine-security-kill')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: DB_TABLES.ENGINE_SESSIONS }, (payload) => {
                if (payload.new.session_id === this.sessionId && payload.new.is_active === false) {
                    console.log("[session_killed] Realtime deactivation caught.");
                    this.enforceKillSwitch("SESSION REVOKED INTERNALLY");
                }
            }).subscribe();
    },

    enforceKillSwitch(reason) {
        window.isSessionValid = false;
        clearInterval(this.heartbeatLoop);
        window.dispatchEvent(new Event('engine:kill_switch')); // Halts simulator loops

        if (this.els.overlay) {
            this.els.overlay.style.display = 'flex';
            this.els.overlay.className = "fixed inset-0 z-[9999] bg-black bg-opacity-95 backdrop-blur-md flex flex-col justify-center items-center text-term-alert border-[12px] border-term-alert/50";
            if (this.els.btnTakeover) this.els.btnTakeover.classList.add('hidden');
            if (this.els.btnExit) this.els.btnExit.classList.remove('hidden');
            this.updateStatus(`[FATAL] ${reason}. Simulator execution Halted.`);
        }
    },

    setupUnloadTrap() {
        window.addEventListener('beforeunload', () => {
            if (window.isSessionValid) {
                supabase.from(DB_TABLES.ENGINE_SESSIONS).update({ is_active: false }).eq('session_id', this.sessionId).then();
            }
        });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    EngineSecurity.init();
});
