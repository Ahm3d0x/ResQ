import { initDashboard } from './dashboard.js';
import { supabase, DB_TABLES } from '../config/supabase.js';

async function logSystemAction(action, targetTable, targetId, note) {
    try {
        const sessionString = localStorage.getItem('resq_custom_session');
        const currentAdminId = sessionString ? JSON.parse(sessionString).id : null;
        if (!currentAdminId) return;

        // 🌟 تحويل targetId إلى 0 إذا كان غير رقمي لحل خطأ 400
        const safeTargetId = isNaN(targetId) || targetId === 'GLOBAL' ? 0 : parseInt(targetId);

        await supabase.from('audit_admin_changes').insert([{
            admin_user_id: currentAdminId, 
            action: action, 
            target_table: targetTable, 
            target_id: safeTargetId, 
            note: note
        }]);
    } catch (error) { 
        console.error("Audit Log Failed:", error); 
    }
}

document.addEventListener('DOMContentLoaded', () => {
    
    // =========================================================================
    // 1. التحقق من صلاحيات المدير (Custom Auth Check) واستخراج البيانات
    // =========================================================================
    let userData = null;
    try {
        const sessionString = localStorage.getItem('resq_custom_session');
        if (!sessionString) {
            window.location.replace('../pages/login.html'); 
            return;
        }
        userData = JSON.parse(sessionString);
        if (userData.role !== 'admin') {
            window.location.replace('../pages/login.html');
            return;
        }
    } catch (e) {
        localStorage.removeItem('resq_custom_session');
        window.location.replace('../pages/login.html');
        return;
    }

    // =========================================================================
    // 🌟 1.5 تفعيل القوائم المنسدلة وبيانات المدير (Header Logic) 🌟
    // =========================================================================
    const adminNameDisplay = document.getElementById('adminNameDisplay');
    const adminAvatar = document.getElementById('adminAvatar');
    
    // الآن userData معرفة وجاهزة للاستخدام
    if (adminNameDisplay && userData && userData.name) {
        adminNameDisplay.innerText = userData.name;
        adminAvatar.innerText = userData.name.charAt(0).toUpperCase();
    }

    const notifBtn = document.getElementById('notifToggleBtn');
    const notifDrop = document.getElementById('notifDropdown');
    const profBtn = document.getElementById('profileToggleBtn');
    const profDrop = document.getElementById('profileDropdown');

    function toggleDropdown(dropToOpen) {
        const isClosed = dropToOpen.classList.contains('opacity-0');
        // إغلاق كل القوائم أولاً
        if(notifDrop) notifDrop.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
        if(profDrop) profDrop.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
        // فتح القائمة المطلوبة إذا كانت مغلقة
        if (isClosed) dropToOpen.classList.remove('opacity-0', 'scale-95', 'pointer-events-none');
    }

    if(notifBtn && notifDrop) notifBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleDropdown(notifDrop); });
    if(profBtn && profDrop) profBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleDropdown(profDrop); });

    // إغلاق القوائم عند الضغط في أي مكان خارجها
    document.addEventListener('click', () => {
        if(notifDrop) notifDrop.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
        if(profDrop) profDrop.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
    });

    // منع الإغلاق عند الضغط داخل القائمة نفسها
    if(notifDrop) notifDrop.addEventListener('click', e => e.stopPropagation());
    if(profDrop) profDrop.addEventListener('click', e => e.stopPropagation());

    // 🌟 دالة تسجيل الخروج (باستخدام النافذة المخصصة Confirm Modal) 🌟
    window.handleLogout = function() {
        const isAr = document.documentElement.dir === 'rtl';
        window.openConfirmModal(
            isAr ? "تسجيل الخروج" : "Logout",
            isAr ? "هل أنت متأكد أنك تريد إنهاء الجلسة والخروج من لوحة التحكم؟" : "Are you sure you want to end your session and log out?",
            () => {
                localStorage.removeItem('resq_custom_session');
                window.location.replace('../pages/login.html');
            }
        );
    };

    // =========================================================================
    // 2. Navigation Logic (SPA Routing)
    // =========================================================================
    const navLinks = document.querySelectorAll('#sidebarNav a');
    
    // 🌟 تم إضافة 'settings' هنا لكي تعمل صفحة الإعدادات 🌟
    const availableModules = ['dashboard', 'users', 'hospitals', 'ambulances', 'devices', 'incidents', 'logs', 'applications', 'settings']; 

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const moduleName = link.getAttribute('data-module');
            if (!moduleName) return;
            
            navLinks.forEach(l => {
                l.classList.remove('bg-primary/10', 'text-primary');
                l.classList.add('text-gray-500', 'dark:text-gray-400');
            });
            link.classList.remove('text-gray-500', 'dark:text-gray-400');
            link.classList.add('bg-primary/10', 'text-primary');

            availableModules.forEach(mod => {
                // 🌟 حماية مزدوجة: للبحث عن module-settings أو settings مباشرة 🌟
                const container = document.getElementById(`module-${mod}`) || document.getElementById(mod);
                if (container) {
                    if (mod === moduleName) {
                        container.classList.remove('hidden');
                        
                        const maxMapBtn = document.getElementById('maximizeMapBtn');
                        if (maxMapBtn) {
                            if (mod === 'dashboard') maxMapBtn.classList.remove('hidden');
                            else maxMapBtn.classList.add('hidden');
                        }

                        // تشغيل دوال تحميل البيانات
                        if (mod === 'users' && window.loadUsersData) window.loadUsersData();
                        if (mod === 'hospitals' && window.loadHospitalsData) window.loadHospitalsData();
                        if (mod === 'ambulances' && window.loadAmbulancesData) window.loadAmbulancesData();
                        if (mod === 'devices' && window.loadDevicesData) window.loadDevicesData();
                        if (mod === 'applications' && window.loadApplicationsData) window.loadApplicationsData();
                        if (mod === 'incidents' && window.loadIncidentsData) window.loadIncidentsData();
                        if (mod === 'logs' && window.loadLogsData) window.loadLogsData();
                        
                    } else {
                        container.classList.add('hidden');
                    }
                }
            });
        });
    });

    // =========================================================================
    // ⚙️ 3. نظام الإعدادات والمحاكاة المدمج (Settings & Simulation Logic)
    // =========================================================================
    const savedMode = localStorage.getItem('resq_sys_mode') || 'simulation';
    const modeRadios = document.querySelectorAll('input[name="systemMode"]');
    const simPanel = document.getElementById('simSettingsPanel');

    // أ. تحديد الوضع المحفوظ عند تحميل الشاشة
    modeRadios.forEach(r => {
        if(r.value === savedMode) r.checked = true;
        r.addEventListener('change', (e) => {
            if(simPanel) simPanel.style.display = e.target.value === 'simulation' ? 'block' : 'none';
        });
    });
    
    if(simPanel) simPanel.style.display = savedMode === 'simulation' ? 'block' : 'none';

    // ب. تحميل قيم المحاكاة المحفوظة في شرائط التمرير (Sliders)
    const savedConfig = JSON.parse(localStorage.getItem('resq_sim_config') || '{}');
    if (document.getElementById('simAmbSpeed')) {
        document.getElementById('simAmbSpeed').value = savedConfig.AMBULANCE_SPEED_KPH || 600;
        const ambValEl = document.getElementById('ambSpeedVal');
        if(ambValEl) ambValEl.innerText = (savedConfig.AMBULANCE_SPEED_KPH || 600) + ' km/h';
        
        document.getElementById('simCarSpeed').value = savedConfig.CAR_SPEED_KPH || 200;
        const carValEl = document.getElementById('carSpeedVal');
        if(carValEl) carValEl.innerText = (savedConfig.CAR_SPEED_KPH || 200) + ' km/h';
        
        document.getElementById('simPatrolRad').value = savedConfig.PATROL_RADIUS || 0.03;
        const patrolValEl = document.getElementById('patrolRadVal');
        if(patrolValEl) patrolValEl.innerText = savedConfig.PATROL_RADIUS || 0.03;
    }

    // ج. معالجة حفظ الإعدادات ورفعها إلى Supabase
    const saveSettingsBtn = document.getElementById('saveSettingsBtn') || document.getElementById('saveGlobalSettingsBtn');
    saveSettingsBtn?.addEventListener('click', async () => {
        const btn = saveSettingsBtn;
        const originalText = btn.innerHTML;
        
        try {
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري تحديث النظام...';
            btn.disabled = true;

            const modeRadioChecked = document.querySelector('input[name="systemMode"]:checked');
            const selectedMode = modeRadioChecked ? modeRadioChecked.value : 'simulation';
            
            const config = {
                AMBULANCE_SPEED_KPH: parseInt(document.getElementById('simAmbSpeed')?.value || 600),
                CAR_SPEED_KPH: parseInt(document.getElementById('simCarSpeed')?.value || 200),
                PATROL_RADIUS: parseFloat(document.getElementById('simPatrolRad')?.value || 0.03)
            };

            // 1. الحفظ المركزي في قاعدة البيانات (Supabase)
            const { error } = await supabase.from(DB_TABLES.SETTINGS).upsert([
                { setting_key: 'system_mode', setting_value: `"${selectedMode}"` },
                { setting_key: 'simulation_config', setting_value: config }
            ]);

            if (error) throw error;

            // 2. الحفظ المحلي للسرعة (لتسريع واجهة المستخدم)
            localStorage.setItem('resq_sys_mode', selectedMode);
            localStorage.setItem('resq_sim_config', JSON.stringify(config));

            // 3. تسجيل التغيير في سجل النظام (Audit Log)
            await logSystemAction('UPDATE', 'system_settings', 'GLOBAL', `System mode changed to ${selectedMode}`);

            if (window.showToast) {
                window.showToast('تم تطبيق الإعدادات المركزية بنجاح. جاري إعادة التشغيل...', 'success');
            } else {
                alert('تم الحفظ بنجاح.');
            }
            
            // إعادة تحميل الصفحة لتطبيق الإعدادات على محرك الخريطة
            setTimeout(() => window.location.reload(), 1500);

        } catch (error) {
            console.error("Settings Save Error:", error);
            if (window.showToast) {
                window.showToast("خطأ في حفظ الإعدادات: " + error.message, "error");
            } else {
                alert("خطأ: " + error.message);
            }
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    });

    // =========================================================================
    // 4. تهيئة لوحة التحكم الرئيسية (Dashboard)
    // =========================================================================
    initDashboard();
});