import { initDashboard } from './dashboard.js'; // تم مسح cleanupDashboard من هنا

document.addEventListener('DOMContentLoaded', () => {
    // 1. Navigation Logic (SPA Routing)
    const navLinks = document.querySelectorAll('#sidebarNav a');
    const mainContainer = document.getElementById('mainContainer');

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const moduleName = link.getAttribute('data-module');
            
            // Update Active Class
            navLinks.forEach(l => {
                l.classList.remove('bg-primary/10', 'text-primary');
                l.classList.add('text-gray-500');
            });
            link.classList.remove('text-gray-500');
            link.classList.add('bg-primary/10', 'text-primary');

            // Load Module (Currently focusing on Dashboard)
            if (moduleName === 'dashboard') {
                document.getElementById('module-dashboard').classList.remove('hidden');
                initDashboard();
            } else {
                document.getElementById('module-dashboard').classList.add('hidden');
                // TODO: Load other CRUD modules here later
            }
        });
    });

    // Initialize Default
    initDashboard();
});