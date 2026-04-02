import { initDashboard } from './dashboard.js';

document.addEventListener('DOMContentLoaded', () => {
    
    // 1. التحقق من صلاحيات المدير (Custom Auth Check) واستخراج البيانات
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
    const availableModules = ['dashboard', 'users', 'hospitals', 'ambulances', 'devices', 'logs']; 

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
                const container = document.getElementById(`module-${mod}`);
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
                        if (mod === 'logs' && window.loadLogsData) window.loadLogsData();
                        
                    } else {
                        container.classList.add('hidden');
                    }
                }
            });
        });
    });

    initDashboard();
});