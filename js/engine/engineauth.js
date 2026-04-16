// ============================================================================
// 🛡️ EnQaZ Core Engine - Isolated Authentication Logic
// ============================================================================

import { supabase, DB_TABLES } from '../config/supabase.js';

const ENGINE_SECRET_KEY = "0xENQAZ_CORE";

document.addEventListener('DOMContentLoaded', () => {
    // If somehow already valid, kick them straight to engine without logic
    const session = localStorage.getItem("ENGINE_SESSION");
    if (session && session.length > 10) {
        window.location.replace('engine.html');
        return;
    }

    const loginForm = document.getElementById('engine-login-form');
    const keyInput = document.getElementById('engine-key-input');
    const alertBox = document.getElementById('auth-alert');
    const btnSubmit = document.getElementById('btn-submit');

    if (!loginForm) return;

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        btnSubmit.innerText = "VERIFYING...";
        alertBox.classList.add('hidden');

        const val = keyInput.value.trim();
        if (val === ENGINE_SECRET_KEY) {
            try {
                // STEP 1: Deactivate ALL sessions
                await supabase.from(DB_TABLES.ENGINE_SESSIONS)
                    .update({ is_active: false })
                    .eq('is_active', true);

                // STEP 2: Create new session
                const newSessionId = crypto.randomUUID();
                const { error } = await supabase.from(DB_TABLES.ENGINE_SESSIONS).insert([{
                    session_id: newSessionId,
                    is_active: true,
                    last_ping: new Date().toISOString()
                }]);

                if (error) throw error;

                console.log("[session_created] New globally active session registered.");

                // STEP 3: Store locally
                localStorage.setItem("ENGINE_SESSION", newSessionId);
                
                btnSubmit.innerText = "ACCESS GRANTED";
                btnSubmit.classList.add('border-term-dim', 'text-term-dim');
                btnSubmit.classList.remove('border-term-text', 'text-term-text');
                
                setTimeout(() => window.location.replace('engine.html'), 500);

            } catch (err) {
                console.error("DB Error:", err);
                btnSubmit.innerText = "Execute Boot Sequence";
                alertBox.innerText = "DATABASE REFUSED CONNECTION";
                alertBox.classList.remove('hidden');
                keyInput.value = '';
            }
        } else {
            // Invalid Key
            setTimeout(() => {
                btnSubmit.innerText = "Execute Boot Sequence";
                alertBox.innerText = "ACCESS DENIED";
                alertBox.classList.remove('hidden');
                keyInput.value = '';
            }, 800);
        }
    });
});
