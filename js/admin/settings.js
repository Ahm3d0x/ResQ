import { supabase, DB_TABLES } from '../config/supabase.js';

const sessionString = localStorage.getItem('resq_custom_session');
const currentAdminId = sessionString ? JSON.parse(sessionString).id : null;

document.addEventListener('DOMContentLoaded', async () => {
    const modeRadios = document.querySelectorAll('input[name="systemMode"]');
    const simPanel = document.getElementById('simSettingsPanel');
    const saveBtn = document.getElementById('saveGlobalSettingsBtn');
    
    // Sliders
    const simAmbSpeed = document.getElementById('simAmbSpeed');
    const simCarSpeed = document.getElementById('simCarSpeed');
    const simPatrolRad = document.getElementById('simPatrolRad');
    const trackCiviliansToggle = document.getElementById('settingTrackCivilians');

    // Labels
    const ambSpeedVal = document.getElementById('ambSpeedVal');
    const carSpeedVal = document.getElementById('carSpeedVal');
    const patrolRadVal = document.getElementById('patrolRadVal');

    // تحديث النصوص
    if(simAmbSpeed) simAmbSpeed.addEventListener('input', (e) => ambSpeedVal.innerText = e.target.value + ' km/h');
    if(simCarSpeed) simCarSpeed.addEventListener('input', (e) => carSpeedVal.innerText = e.target.value + ' km/h');
    if(simPatrolRad) simPatrolRad.addEventListener('input', (e) => patrolRadVal.innerText = e.target.value);

    // تبديل اللوحات
    modeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if(simPanel) {
                if(e.target.value === 'simulation') simPanel.classList.remove('opacity-50', 'pointer-events-none');
                else simPanel.classList.add('opacity-50', 'pointer-events-none');
            }
        });
    });

    // جلب الإعدادات الحالية
    try {
        const { data: settings, error } = await supabase.from(DB_TABLES.SETTINGS).select('*');
        if (!error && settings) {
            settings.forEach(s => {
                if (s.setting_key === 'system_mode') {
                    const mode = typeof s.setting_value === 'string' ? s.setting_value.replace(/"/g, '') : s.setting_value;
                    const radio = document.querySelector(`input[name="systemMode"][value="${mode}"]`);
                    if(radio) { radio.checked = true; radio.dispatchEvent(new Event('change')); }
                }
                if (s.setting_key === 'simulation_config') {
                    const config = s.setting_value;
                    if(simAmbSpeed && config.AMBULANCE_SPEED_KPH) { simAmbSpeed.value = config.AMBULANCE_SPEED_KPH; ambSpeedVal.innerText = config.AMBULANCE_SPEED_KPH + ' km/h'; }
                    if(simCarSpeed && config.CAR_SPEED_KPH) { simCarSpeed.value = config.CAR_SPEED_KPH; carSpeedVal.innerText = config.CAR_SPEED_KPH + ' km/h'; }
                    if(simPatrolRad && config.PATROL_RADIUS) { simPatrolRad.value = config.PATROL_RADIUS; patrolRadVal.innerText = config.PATROL_RADIUS; }
                }
                if (s.setting_key === 'live_config') {
                    const liveConfig = s.setting_value;
                    if(trackCiviliansToggle && typeof liveConfig.TRACK_CIVILIANS !== 'undefined') trackCiviliansToggle.checked = liveConfig.TRACK_CIVILIANS;
                }
            });
        }
    } catch (err) { console.warn("Failed to load settings to UI", err); }

    // حفظ الإعدادات
    saveBtn?.addEventListener('click', async () => {
        const originalContent = saveBtn.innerHTML;
        try {
            saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xl"></i> جاري مزامنة النظام...';
            saveBtn.disabled = true;

            const modeRadioChecked = document.querySelector('input[name="systemMode"]:checked');
            const selectedMode = modeRadioChecked ? modeRadioChecked.value : 'simulation';
            
            const simConfig = {
                AMBULANCE_SPEED_KPH: parseInt(simAmbSpeed?.value || 600),
                CAR_SPEED_KPH: parseInt(simCarSpeed?.value || 200),
                PATROL_RADIUS: parseFloat(simPatrolRad?.value || 0.03)
            };

            const liveConfig = { TRACK_CIVILIANS: trackCiviliansToggle ? trackCiviliansToggle.checked : false };

            const { error } = await supabase.from(DB_TABLES.SETTINGS).upsert([
                { setting_key: 'system_mode', setting_value: `"${selectedMode}"` },
                { setting_key: 'simulation_config', setting_value: simConfig },
                { setting_key: 'live_config', setting_value: liveConfig }
            ]);

            if (error) throw error;

            localStorage.setItem('resq_sys_mode', selectedMode);
            localStorage.setItem('resq_sim_config', JSON.stringify(simConfig));
            localStorage.setItem('resq_live_config', JSON.stringify(liveConfig));

            if (currentAdminId) {
                await supabase.from('audit_admin_changes').insert([{
                    admin_user_id: currentAdminId, action: 'UPDATE', target_table: 'system_settings', target_id: 0, note: `Updated system mode to: ${selectedMode}`
                }]);
            }

            window.showToast('تم تطبيق الإعدادات المركزية وتحديث الخوادم بنجاح.', 'success');
            setTimeout(() => window.location.reload(), 1500);
        } catch (error) {
            window.showToast("حدث خطأ أثناء مزامنة الإعدادات: " + error.message, "error");
        } finally {
            saveBtn.innerHTML = originalContent;
            saveBtn.disabled = false;
        }
    });
});