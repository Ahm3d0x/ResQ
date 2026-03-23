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
            alert("Access Denied: Admin privileges required.");
            window.location.replace('../pages/login.html');
            return;
        }
    } catch (e) {
        console.error("Auth check error:", e);
        localStorage.removeItem('resq_custom_session');
        window.location.replace('../pages/login.html');
        return;
    }

    // 2. Navigation Logic (SPA Routing) - النسخة المكتملة
    const navLinks = document.querySelectorAll('#sidebarNav a');
    const availableModules = ['dashboard', 'users', 'hospitals', 'ambulances'];

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const moduleName = link.getAttribute('data-module');
            if (!moduleName) return;
            
            // 1. تحديث شكل الزر النشط
            navLinks.forEach(l => {
                l.classList.remove('bg-primary/10', 'text-primary');
                l.classList.add('text-gray-500', 'dark:text-gray-400');
            });
            link.classList.remove('text-gray-500', 'dark:text-gray-400');
            link.classList.add('bg-primary/10', 'text-primary');

            // 2. إظهار الموديول المطلوب وإخفاء الباقي بأمان
            availableModules.forEach(mod => {
                const container = document.getElementById(`module-${mod}`);
                if (container) {
                    if (mod === moduleName) {
                        // إظهار الحاوية
                        container.classList.remove('hidden');
                        
                        // إخفاء زرار تكبير الخريطة لو إحنا بره الداشبورد
                        const maxMapBtn = document.getElementById('maximizeMapBtn');
                        if (maxMapBtn) {
                            if (mod === 'dashboard') maxMapBtn.classList.remove('hidden');
                            else maxMapBtn.classList.add('hidden');
                        }

                        // تشغيل الداتا الخاصة بكل صفحة
                        if (mod === 'users' && window.loadUsersData) window.loadUsersData();
                        if (mod === 'hospitals' && window.loadHospitalsData) window.loadHospitalsData();
                        if (mod === 'ambulances' && window.loadAmbulancesData) window.loadAmbulancesData();
                        
                    } else {
                        // إخفاء باقي الحاويات
                        container.classList.add('hidden');
                    }
                }
            });
        });
    });

    // 3. تشغيل الداشبورد افتراضياً عند تحميل الصفحة
    initDashboard();
});