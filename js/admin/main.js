import { initDashboard } from './dashboard.js';

document.addEventListener('DOMContentLoaded', () => {
    
    // 1. التحقق من صلاحيات المدير (Custom Auth Check)
    try {
        const sessionString = localStorage.getItem('resq_custom_session');
        if (!sessionString) {
            window.location.replace('../pages/login.html'); 
            return;
        }
        const userData = JSON.parse(sessionString);
        if (userData.role !== 'admin') {
            window.location.replace('../pages/login.html');
            return;
        }
    } catch (e) {
        localStorage.removeItem('resq_custom_session');
        window.location.replace('../pages/login.html');
        return;
    }

    // 2. Navigation Logic (SPA Routing)
    const navLinks = document.querySelectorAll('#sidebarNav a');
    const availableModules = ['dashboard', 'users', 'hospitals', 'ambulances', 'devices']; // تم إضافة devices

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
                        
                    } else {
                        container.classList.add('hidden');
                    }
                }
            });
        });
    });

    initDashboard();
});