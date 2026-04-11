// ============================================================================
// 🎛️ EnQaZ Dashboard Controller (Ultimate Architected Version)
// ============================================================================

import { supabase, DB_TABLES } from '../config/supabase.js';
import { t } from '../core/language.js';
import { MapEngine, SIM_CONFIG } from './mapEngine.js';

export const SysSettings = { 
    mode: localStorage.getItem('resq_sys_mode') || 'simulation',
    trackCivilians: JSON.parse(localStorage.getItem('resq_live_config') || '{"TRACK_CIVILIANS": true}').TRACK_CIVILIANS
};

const sessionString = localStorage.getItem('resq_custom_session');
const currentAdminId = sessionString ? JSON.parse(sessionString).id : null;

window.rawData = { hospitals: {}, ambulances: {}, incidents: {}, devices: {} };
window.simCacheRestored = false; 
window.currentOpenPanel = { type: null, id: null }; 

const simCache = JSON.parse(localStorage.getItem('resq_sim_positions') || '{}');

async function logSystemAction(action, targetTable, targetId, note) {
    if (!currentAdminId) return;
    try {
        const safeTargetId = isNaN(targetId) || targetId === 'GLOBAL' ? 0 : parseInt(targetId);
        await supabase.from('audit_admin_changes').insert([{
            admin_user_id: currentAdminId, action: action, target_table: targetTable, target_id: safeTargetId, note: note
        }]);
    } catch (error) { console.error("Audit Log Failed:", error); }
}

const getCoords = (obj) => ({
    lat: parseFloat(obj.lat || obj.latitude),
    lng: parseFloat(obj.lng || obj.longitude)
});

export async function initDashboard() {
    try {
        const { data: settings } = await supabase.from(DB_TABLES.SETTINGS).select('*');
        if (settings) {
            settings.forEach(s => {
                if (s.setting_key === 'system_mode') SysSettings.mode = typeof s.setting_value === 'string' ? s.setting_value.replace(/"/g, '') : s.setting_value;
                if (s.setting_key === 'simulation_config') Object.assign(SIM_CONFIG, s.setting_value);
                if (s.setting_key === 'live_config') SysSettings.trackCivilians = s.setting_value.TRACK_CIVILIANS;
            });
        }
    } catch (err) { console.warn("Failed to load global settings", err); }

    MapEngine.init('adminMap', 30.0444, 31.2357, (type, id) => window.openPanel(type, id));
    
    const mapToggleBtn = document.getElementById('toggleUsersMap');
    if (SysSettings.trackCivilians === false) {
        MapEngine.toggleLayer('devices', false);
        if(mapToggleBtn) mapToggleBtn.checked = false;
    } else {
        MapEngine.toggleLayer('devices', true);
        if(mapToggleBtn) mapToggleBtn.checked = true;
    }

    await loadEntities();
    await loadDevices();
    setupRealtime();

    if (SysSettings.mode === 'simulation') {
        setInterval(window.processSystemQueues, 2000);
    }
    window.addEventListener('languageChanged', () => window.updateAllUI());
}

async function loadEntities() {
    const [hospRes, ambRes, incRes] = await Promise.all([
        supabase.from(DB_TABLES.HOSPITALS).select('*'), 
        supabase.from(DB_TABLES.AMBULANCES).select('*, users(name, phone)'),
        supabase.from(DB_TABLES.INCIDENTS).select('*, devices(device_uid, users(name, phone)), hospitals(name), ambulances(code)').order('created_at', { ascending: false }).limit(50)
    ]);

    if (hospRes.data) hospRes.data.forEach(h => window.rawData.hospitals[h.id] = h);
    if (ambRes.data) ambRes.data.forEach(a => window.rawData.ambulances[a.id] = a);
    if (incRes.data) incRes.data.forEach(i => window.rawData.incidents[i.id] = i);

    window.updateAllUI();
}

async function loadDevices() {
    const { data } = await supabase.from(DB_TABLES.DEVICES).select('*, users(name, phone)');
    if (data) {
        data.forEach(d => window.rawData.devices[d.id] = d);
        window.updateAllUI();
    }
}

function setupRealtime() {
    supabase.channel('dashboard-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: DB_TABLES.INCIDENTS }, payload => {
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                let newInc = payload.new;

                if (newInc.status === 'pending' && SysSettings.trackCivilians && !newInc._snapped) {
                    const devId = String(newInc.device_id);
                    const liveCoords = MapEngine.getEntityLatLng('devices', devId); 

                    if (liveCoords) {
                        if (MapEngine.activeTasks[`devices_${devId}`]) {
                            clearInterval(MapEngine.activeTasks[`devices_${devId}`]);
                            delete MapEngine.activeTasks[`devices_${devId}`];
                        }
                        if (window.rawData.devices[devId]) window.rawData.devices[devId].currentSpeed = 0;

                        newInc.latitude = liveCoords.lat;
                        newInc.longitude = liveCoords.lng;
                        newInc._snapped = true;

                        supabase.from(DB_TABLES.INCIDENTS).update({
                            latitude: liveCoords.lat,
                            longitude: liveCoords.lng
                        }).eq('id', newInc.id);
                    }
                }

                window.rawData.incidents[newInc.id] = { ...window.rawData.incidents[newInc.id], ...newInc };
                window.updateAllUI(); 
            }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: DB_TABLES.AMBULANCES }, payload => {
            if (payload.eventType === 'UPDATE') {
                if (window.rawData.ambulances[payload.new.id]) {
                    window.rawData.ambulances[payload.new.id] = { ...window.rawData.ambulances[payload.new.id], ...payload.new };
                    window.updateAllUI();
                }
            }
        }).subscribe();
}

window.updateAllUI = function() {
    if (typeof window.renderIncidents === 'function') window.renderIncidents();
    if (typeof window.renderAmbulances === 'function') window.renderAmbulances();
    if (typeof window.renderDevices === 'function') window.renderDevices();
    
    const allIncidents = Object.values(window.rawData.incidents);
    const visibleIncidents = allIncidents.filter(inc => inc.status === 'pending' || inc.status === 'assigned');
    MapEngine.updateMarkers('incidents', visibleIncidents);
    
    MapEngine.updateMarkers('hospitals', Object.values(window.rawData.hospitals));
    MapEngine.updateMarkers('ambulances', Object.values(window.rawData.ambulances));
    
    const busyStatuses = ['pending', 'assigned', 'in_progress', 'completed']; 
    const busyDeviceIds = allIncidents.filter(inc => busyStatuses.includes(inc.status)).map(inc => String(inc.device_id));
    const visibleDevices = Object.values(window.rawData.devices).filter(dev => !busyDeviceIds.includes(String(dev.id)));
    
    MapEngine.updateMarkers('devices', visibleDevices);
    
    if (typeof window.refreshCurrentPanel === 'function') window.refreshCurrentPanel();
};

window.refreshCurrentPanel = function() {
    if (window.currentOpenPanel.type && window.currentOpenPanel.id) {
        if (window.rawData[window.currentOpenPanel.type][window.currentOpenPanel.id]) {
            window.openPanel(window.currentOpenPanel.type, window.currentOpenPanel.id);
        }
    }
};

// 🌟 تحديث حي للكارت كل نصف ثانية لاستقرار الرقم وحماية المتصفح 🌟
window.lastUiUpdateTime = 0;
window.updateLiveSpeedUI = function(type, id, speed) {
    if (window.currentOpenPanel.type === type && window.currentOpenPanel.id === String(id)) {
        const now = Date.now();
        if (now - window.lastUiUpdateTime > 500) { 
            const speedEl = document.getElementById('liveSpeedDisplay');
            if (speedEl && !speedEl.innerHTML.includes('غير متوفرة')) {
                speedEl.innerText = Math.round(speed) + ' km/h';
                window.lastUiUpdateTime = now;
            }
        }
    }
};

window.renderIncidents = function() {
    const list = document.getElementById('incidentsBody');
    if(!list) return;
    
    const activeIncidents = Object.values(window.rawData.incidents)
        .filter(inc => inc.status !== 'completed' && inc.status !== 'canceled')
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (activeIncidents.length === 0) {
        list.innerHTML = `<div class="p-6 text-center text-gray-500 text-sm">لا توجد حوادث نشطة حالياً.</div>`;
        return;
    }
    
    list.innerHTML = activeIncidents.map(inc => {
        const timeClass = inc.status === 'pending' ? 'text-red-500 animate-pulse' : 'text-blue-500';
        return `
            <div class="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 cursor-pointer hover:border-primary transition-colors" onclick="MapEngine.focusOnEntity('incidents', '${inc.id}'); window.openPanel('incidents', '${inc.id}')">
                <div class="flex justify-between items-start mb-2">
                    <span class="px-2 py-1 bg-red-100 text-red-600 dark:bg-red-900/30 text-xs font-bold rounded uppercase">${inc.status}</span>
                    <span class="text-xs font-mono font-bold ${timeClass} incident-timer" data-created="${inc.created_at}" data-status="${inc.status}">جاري الحساب...</span>
                </div>
                <div class="text-sm font-bold truncate">${inc.devices?.users?.name || inc.device_id}</div>
                <div class="text-xs text-gray-500 mt-1 truncate"><i class="fa-solid fa-hospital text-green-500"></i> ${inc.hospitals?.name || 'جاري التوجيه...'}</div>
            </div>
        `;
    }).join('');
};

window.renderAmbulances = function() {
    const list = document.getElementById('ambBody');
    if(!list) return;

    const searchTerm = (document.getElementById('ambulanceSearchInput')?.value || '').toLowerCase();
    let dataToRender = Object.values(window.rawData.ambulances);
    
    if (searchTerm) {
        dataToRender = dataToRender.filter(a => (a.code || '').toLowerCase().includes(searchTerm) || (a.users?.name || '').toLowerCase().includes(searchTerm));
    }

    if(dataToRender.length === 0) {
        list.innerHTML = `<div class="p-4 text-center text-gray-500 text-sm">لا يوجد إسعاف مطابق.</div>`;
        return;
    }

    list.innerHTML = dataToRender.map(amb => {
       const statusColor = amb.status === 'available' ? 'bg-blue-500' : (amb.status === 'returning' ? 'bg-gray-500' : 'bg-warning');
        return `
            <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-100 dark:border-gray-700 cursor-pointer hover:bg-gray-100 dark:hover:bg-white/10" onclick="MapEngine.focusOnEntity('ambulances', '${amb.id}'); window.openPanel('ambulances', '${amb.id}')">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full ${statusColor} text-white flex items-center justify-center shadow-md"><i class="fa-solid fa-truck-medical text-xs"></i></div>
                    <div>
                        <div class="text-sm font-bold text-gray-800 dark:text-white">${amb.code}</div>
                        <div class="text-[10px] text-gray-500">${amb.users?.name || 'بدون سائق'}</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
};

window.renderDevices = function() {
    const list = document.getElementById('devicesPanelList');
    if(!list) return;

    const searchTerm = (document.getElementById('deviceSearchInput')?.value || '').toLowerCase();
    let dataToRender = Object.values(window.rawData.devices);

    if (searchTerm) {
        dataToRender = dataToRender.filter(d => (d.device_uid || '').toLowerCase().includes(searchTerm) || (d.users?.name || '').toLowerCase().includes(searchTerm));
    }

    if(dataToRender.length === 0) {
        list.innerHTML = `<div class="p-4 text-center text-gray-500 text-sm">لا توجد مركبات مطابقة.</div>`;
        return;
    }

    const allIncidents = Object.values(window.rawData.incidents);
    const busyStatuses = ['pending', 'assigned', 'in_progress', 'completed'];
    
    list.innerHTML = dataToRender.map(dev => {
        const hasIncident = allIncidents.find(inc => String(inc.device_id) === String(dev.id) && busyStatuses.includes(inc.status));
        const isMoving = MapEngine.activeTasks[`devices_${dev.id}`];
        
        const iconClass = hasIncident ? 'fa-car-burst animate-bounce' : 'fa-car';
        const bgClass = hasIncident ? 'bg-red-600' : 'bg-gray-500';
        const statusIcon = hasIncident ? 'fa-triangle-exclamation text-red-500' : (isMoving ? 'fa-truck-fast text-green-500 animate-pulse' : 'fa-parking text-gray-400');

        return `
            <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-100 dark:border-gray-700 cursor-pointer hover:bg-gray-100 dark:hover:bg-white/10" onclick="MapEngine.focusOnEntity('devices', '${dev.id}'); window.openPanel('devices', '${dev.id}')">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full ${bgClass} text-white flex items-center justify-center shadow-md"><i class="fa-solid ${iconClass} text-xs"></i></div>
                    <div>
                        <div class="text-sm font-bold ${hasIncident ? 'text-red-500' : 'text-gray-800 dark:text-white'}">${dev.users?.name || 'مستخدم غير معروف'}</div>
                        <div class="text-[10px] text-gray-500 font-mono">${dev.device_uid || dev.id}</div>
                    </div>
                </div>
                <div class="text-xs"><i class="fa-solid ${statusIcon}"></i></div>
            </div>
        `;
    }).join('');
};

window.openPanel = function(type, id) {
    window.currentOpenPanel = { type, id };
    const data = window.rawData[type][id];
    const panel = document.getElementById('detailsPanel');
    const content = document.getElementById('panelContent');
    if (!panel || !content || !data) return;

    let html = '';

    if (type === 'hospitals') {
        html = `
            <div class="bg-white dark:bg-gray-800 rounded-xl p-5 border-l-4 border-green-500 shadow-md">
                <h3 class="text-xl font-black mb-4 flex items-center gap-2"><i class="fa-solid fa-hospital text-green-500"></i> بيانات المستشفى</h3>
                <div class="grid grid-cols-1 gap-3 text-sm">
                    <div class="flex justify-between border-b border-gray-100 dark:border-gray-700 pb-2"><span class="text-gray-500">الاسم</span><span class="font-bold text-gray-800 dark:text-white">${data.name}</span></div>
                    <div class="flex justify-between border-b border-gray-100 dark:border-gray-700 pb-2"><span class="text-gray-500">المدينة / المنطقة</span><span class="font-bold text-gray-800 dark:text-gray-300">${data.city || '-'}</span></div>
                    <div class="flex justify-between border-b border-gray-100 dark:border-gray-700 pb-2"><span class="text-gray-500">الهاتف</span><span class="font-mono text-gray-800 dark:text-gray-300" dir="ltr">${data.phone || 'غير مسجل'}</span></div>
                </div>
            </div>
        `;
    }
    else if (type === 'devices') {
        const busyStatuses = ['pending', 'assigned', 'in_progress', 'completed'];
        const activeIncident = Object.values(window.rawData.incidents).find(inc => String(inc.device_id) === String(data.id) && busyStatuses.includes(inc.status));
        const isMoving = MapEngine.activeTasks[`devices_${data.id}`];
        const isTracked = MapEngine.trackedEntity === `devices_${data.id}`; 

        let movementStatus = isMoving ? 'في طريق (مشوار)' : 'متوقفة';
        let movementColor = isMoving ? 'text-primary animate-pulse' : 'text-gray-400';
        let speedText = isMoving ? Math.round(data.currentSpeed || SIM_CONFIG.CAR_SPEED_KPH || 80) + ' km/h' : '0 km/h';

        if (activeIncident) {
            movementStatus = '🚨 متورطة في حادث (في انتظار العلاج) 🚨';
            movementColor = 'text-red-600 font-black animate-pulse';
            speedText = '<span class="text-red-500">0 km/h (غير متوفرة)</span>';
        }

        html = `
            <div class="bg-white dark:bg-gray-800 rounded-xl p-5 border-l-4 ${activeIncident ? 'border-red-600' : 'border-gray-500'} shadow-md">
                <h3 class="text-xl font-black mb-4 flex items-center gap-2"><i class="fa-solid ${activeIncident ? 'fa-car-burst text-red-600' : 'fa-car text-gray-500'}"></i> بيانات المركبة المدنية</h3>
                <div class="grid grid-cols-1 gap-3 text-sm">
                    <div class="flex justify-between border-b border-gray-100 dark:border-gray-700 pb-2"><span class="text-gray-500">صاحب المركبة</span><span class="font-bold text-gray-800 dark:text-white">${data.users?.name || 'مستخدم غير معروف'}</span></div>
                    <div class="flex justify-between border-b border-gray-100 dark:border-gray-700 pb-2"><span class="text-gray-500">السرعة الحالية</span><span class="font-mono font-bold text-green-600" id="liveSpeedDisplay">${speedText}</span></div>
                    <div class="flex justify-between"><span class="text-gray-500">حالة الحركة</span><span class="${movementColor}">${movementStatus}</span></div>
                </div>
                <div class="mt-4 border-t border-gray-100 dark:border-gray-700 pt-4 flex gap-2">
                    <button onclick="const state = MapEngine.toggleTracking('devices', '${data.id}'); window.refreshCurrentPanel();" class="flex-1 ${isTracked ? 'bg-red-600' : 'bg-blue-600 hover:bg-blue-500'} text-white py-2 rounded-lg font-bold transition-colors text-xs"><i class="fa-solid fa-crosshairs"></i> ${isTracked ? 'إلغاء التتبع' : 'تتبع المركبة'}</button>
                </div>
            </div>
        `;
    } 
    else if (type === 'ambulances') {
        const isPatrolling = MapEngine.activeTasks[`ambulances_${data.id}`];
        const isTracked = MapEngine.trackedEntity === `ambulances_${data.id}`; 
        
        let statusColor = 'text-blue-500';
        let currentTask = 'متوقفة';
        let displaySpeed = isPatrolling ? (data.currentSpeed || SIM_CONFIG.AMBULANCE_SPEED_KPH || 120) : 0;

        if (data.status === 'available') {
            statusColor = 'text-blue-500';
            currentTask = isPatrolling ? 'دورية استطلاعية' : 'متوقفة (جاهزة)';
        } else if (data.status === 'assigned') {
            statusColor = 'text-warning';
            currentTask = '🚨 متجه لموقع الحادث 🚨';
            displaySpeed = data.currentSpeed || (SIM_CONFIG.AMBULANCE_SPEED_KPH * 1.5) || 150;
        } else if (data.status === 'in_progress') {
            statusColor = 'text-purple-500';
            currentTask = '🏥 نقل المصاب للمستشفى 🏥';
            displaySpeed = data.currentSpeed || (SIM_CONFIG.AMBULANCE_SPEED_KPH * 1.5) || 150;
        } else if (data.status === 'returning') {
            statusColor = 'text-gray-500';
            currentTask = '↩️ عائد للقاعدة';
        }

        html = `
            <div class="bg-white dark:bg-gray-800 rounded-xl p-5 border-l-4 border-blue-500 shadow-md">
                <h3 class="text-xl font-black mb-4 flex items-center gap-2"><i class="fa-solid fa-truck-medical text-blue-500"></i> وحدة إسعاف</h3>
                <div class="grid grid-cols-1 gap-3 text-sm">
                    <div class="flex justify-between border-b border-gray-100 dark:border-gray-700 pb-2"><span class="text-gray-500">كود الوحدة / السائق</span><span class="font-black text-lg text-gray-800 dark:text-white">${data.code} <span class="text-xs font-normal text-gray-500 block">${data.users?.name || 'بدون سائق'}</span></span></div>
                    <div class="flex justify-between border-b border-gray-100 dark:border-gray-700 pb-2"><span class="text-gray-500">الحالة</span><span class="font-bold uppercase ${statusColor}">${data.status}</span></div>
                    <div class="flex justify-between border-b border-gray-100 dark:border-gray-700 pb-2"><span class="text-gray-500">السرعة</span><span class="font-mono font-bold text-green-600" id="liveSpeedDisplay">${Math.round(displaySpeed)} km/h</span></div>
                    <div class="flex justify-between"><span class="text-gray-500">المهمة الحالية</span><span class="font-bold ${statusColor}">${currentTask}</span></div>
                </div>
                <div class="mt-4 border-t border-gray-100 dark:border-gray-700 pt-4 flex gap-2">
                    <button onclick="const state = MapEngine.toggleTracking('ambulances', '${data.id}'); window.refreshCurrentPanel();" class="flex-1 ${isTracked ? 'bg-red-600' : 'bg-blue-600 hover:bg-blue-500'} text-white py-2 rounded-lg font-bold transition-colors text-xs"><i class="fa-solid fa-crosshairs"></i> ${isTracked ? 'إلغاء التتبع' : 'تتبع الإسعاف'}</button>
                </div>
            </div>
        `;
    }
    else if (type === 'incidents') {
        const amb = data.assigned_ambulance_id ? window.rawData.ambulances[data.assigned_ambulance_id] : null;
        const hosp = data.assigned_hospital_id ? window.rawData.hospitals[data.assigned_hospital_id] : null;
        const dev = data.device_id ? window.rawData.devices[data.device_id] : null;

        const ambDisplay = amb ? `<span class="cursor-pointer text-blue-500 hover:text-blue-700 underline decoration-dotted" onclick="MapEngine.focusOnEntity('ambulances', '${amb.id}'); window.openPanel('ambulances', '${amb.id}')">${amb.code}</span>` : 'جاري التوجيه...';
        const hospDisplay = hosp ? `<span class="cursor-pointer text-green-600 hover:text-green-800 underline decoration-dotted" onclick="MapEngine.focusOnEntity('hospitals', '${hosp.id}'); window.openPanel('hospitals', '${hosp.id}')">${hosp.name}</span>` : 'جاري التحديد...';
        const userDisplay = dev ? `<span class="cursor-pointer text-gray-800 dark:text-white hover:text-primary underline decoration-dotted" onclick="MapEngine.focusOnEntity('devices', '${dev.id}'); window.openPanel('devices', '${dev.id}')">${dev.users?.name || 'مجهول'}</span>` : 'مجهول';

        const color = window.routeColors ? (window.routeColors[data.id % window.routeColors.length] || '#ef4444') : '#ef4444';
        const isRouteVisible = !!MapEngine.incidentRoutes[data.id];
        const routeBtnText = isRouteVisible ? 'إخفاء المسار' : 'عرض المسار';
        const routeBtnClass = isRouteVisible ? 'bg-gray-600 hover:bg-gray-500' : 'bg-blue-600 hover:bg-blue-500';

        html = `
            <div class="bg-white dark:bg-gray-800 rounded-xl p-5 border-l-4 border-red-500 shadow-md">
                <h3 class="text-xl font-black mb-4 flex items-center gap-2 text-red-600"><i class="fa-solid fa-car-burst"></i> تفاصيل الحادث</h3>
                <div class="space-y-3 text-sm">
                    <div class="flex justify-between border-b border-gray-100 dark:border-gray-700 pb-2"><span class="text-gray-500">الحالة:</span> <span class="font-bold uppercase text-red-500 incident-timer" data-created="${data.created_at}" data-status="${data.status}">${data.status}</span></div>
                    <div class="flex justify-between border-b border-gray-100 dark:border-gray-700 pb-2"><span class="text-gray-500">الإسعاف الموجه:</span> <span class="font-bold">${ambDisplay}</span></div>
                    <div class="flex justify-between border-b border-gray-100 dark:border-gray-700 pb-2"><span class="text-gray-500">المستشفى الهدف:</span> <span class="font-bold">${hospDisplay}</span></div>
                    <div class="flex justify-between border-b border-gray-100 dark:border-gray-700 pb-2"><span class="text-gray-500">المصاب:</span> <span class="font-bold">${userDisplay}</span></div>
                </div>
                <div class="mt-4 border-t border-gray-100 dark:border-gray-700 pt-4 flex gap-2">
                    <button onclick="window.cancelIncident('${data.id}')" class="flex-1 bg-gray-200 dark:bg-gray-700 hover:bg-red-500 hover:text-white text-gray-700 dark:text-gray-300 py-2 rounded-lg font-bold transition-colors text-xs">إلغاء البلاغ</button>
                    <button onclick="window.toggleIncidentRouteAction('${data.id}', '${color}')" class="flex-1 ${routeBtnClass} text-white py-2 rounded-lg font-bold transition-colors text-xs"><i class="fa-solid fa-route"></i> ${routeBtnText}</button>
                </div>
            </div>
        `;
    }

    content.innerHTML = html;
    panel.classList.remove(document.documentElement.dir === 'rtl' ? '-translate-x-[120%]' : 'translate-x-[120%]');
};

document.getElementById('ambulanceSearchInput')?.addEventListener('input', () => window.renderAmbulances());
document.getElementById('deviceSearchInput')?.addEventListener('input', () => window.renderDevices());

window.routeColors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];
window.toggleIncidentRouteAction = function(incId, color) {
    const inc = window.rawData.incidents[incId];
    if (!inc || !inc.assigned_ambulance_id || !inc.assigned_hospital_id) {
        alert("لم يتم تعيين إسعاف أو مستشفى لهذا الحادث بعد.");
        return;
    }
    const amb = window.rawData.ambulances[inc.assigned_ambulance_id];
    const hosp = window.rawData.hospitals[inc.assigned_hospital_id];
    const isVisible = !MapEngine.incidentRoutes[incId]; 

    if (isVisible) {
        MapEngine.toggleIncidentRoute(incId, amb.lat, amb.lng, inc.latitude, inc.longitude, hosp.lat, hosp.lng, color, true);
    } else {
        MapEngine.toggleIncidentRoute(incId, null, null, null, null, null, null, null, false);
    }
    window.refreshCurrentPanel();
};

window.toggleHeatmapAction = async function(isChecked) {
    if (isChecked) {
        const { data } = await supabase.from(DB_TABLES.INCIDENTS).select('latitude, longitude');
        MapEngine.toggleHeatmap(data || [], true);
    } else {
        MapEngine.toggleHeatmap([], false);
    }
};

window.toggleTrafficAction = function(isChecked) {
    MapEngine.toggleTraffic(isChecked);
};

// 🌟 استخدام النافذة المخصصة وتفريغ المستشفى 🌟
window.cancelIncident = function(incId) {
    if(window.openConfirmModal) {
        window.openConfirmModal(
            "إلغاء البلاغ الطارئ", 
            "هل أنت متأكد من إلغاء هذا البلاغ؟ سيتم فك ارتباط الإسعاف وإعادته للقاعدة، وإلغاء حجز سرير المستشفى.", 
            async () => executeCancel(incId)
        );
    } else {
        if(confirm("هل أنت متأكد من إلغاء البلاغ؟ سيتم فك ارتباط الإسعاف.")) executeCancel(incId);
    }
};

async function executeCancel(incId) {
    const inc = window.rawData.incidents[incId];
    if (inc) {
        inc.status = 'canceled';
        if (inc.assigned_ambulance_id) {
            const ambId = inc.assigned_ambulance_id;
            if (MapEngine.activeTasks[`ambulances_${ambId}`]) {
                clearInterval(MapEngine.activeTasks[`ambulances_${ambId}`]);
                delete MapEngine.activeTasks[`ambulances_${ambId}`];
            }
            window.rawData.ambulances[ambId].status = 'returning';
            await supabase.from(DB_TABLES.AMBULANCES).update({ status: 'returning' }).eq('id', ambId);
        }
        // تحرير المستشفى والإسعاف
        inc.assigned_hospital_id = null;
        inc.assigned_ambulance_id = null;
        MapEngine.toggleIncidentRoute(incId, null, null, null, null, null, null, null, false);
    }

    await supabase.from(DB_TABLES.INCIDENTS).update({ 
        status: 'canceled', assigned_hospital_id: null, assigned_ambulance_id: null 
    }).eq('id', incId);
    
    await logSystemAction('UPDATE', 'incidents', incId, 'Admin canceled the incident');
    
    window.updateAllUI(); 
    document.getElementById('detailsPanel').classList.add(document.documentElement.dir === 'rtl' ? '-translate-x-[120%]' : 'translate-x-[120%]');
}

window.processSystemQueues = async function() {
    if (SysSettings.mode !== 'simulation') return;

    let uiNeedsUpdate = false; 

    if (!window.simCacheRestored) {
        const cache = JSON.parse(localStorage.getItem('resq_sim_positions') || '{}');
        ['ambulances', 'devices'].forEach(type => {
            if (window.rawData[type]) {
                Object.values(window.rawData[type]).forEach(item => {
                    if (cache[`${type}_${item.id}`]) {
                        item.lat = cache[`${type}_${item.id}`].lat;
                        item.lng = cache[`${type}_${item.id}`].lng;
                        item.currentSpeed = cache[`${type}_${item.id}`].speed || 0;
                    }
                });
            }
        });
        window.simCacheRestored = true;
        uiNeedsUpdate = true;
    }

    const now = new Date().getTime();

    if (SysSettings.trackCivilians) {
        const allIncidentsList = Object.values(window.rawData.incidents);
        const busyStatuses = ['pending', 'assigned', 'in_progress', 'completed'];

        Object.values(window.rawData.devices).forEach(dev => {
            const strDevId = String(dev.id);
            const activeInc = allIncidentsList.find(inc => String(inc.device_id) === strDevId && busyStatuses.includes(inc.status));

            if (activeInc) {
                if (MapEngine.activeTasks[`devices_${dev.id}`]) {
                    clearInterval(MapEngine.activeTasks[`devices_${dev.id}`]);
                    delete MapEngine.activeTasks[`devices_${dev.id}`];
                }
                if (dev.currentSpeed !== 0) { dev.currentSpeed = 0; uiNeedsUpdate = true; }

                if (activeInc.status === 'pending' && !activeInc._snapped) {
                    activeInc.latitude = dev.lat;
                    activeInc.longitude = dev.lng;
                    activeInc._snapped = true;
                    
                    supabase.from(DB_TABLES.INCIDENTS).update({
                        latitude: dev.lat,
                        longitude: dev.lng
                    }).eq('id', activeInc.id);
                    
                    uiNeedsUpdate = true;
                }
                return; 
            }

            if (!MapEngine.activeTasks[`devices_${dev.id}`]) {
                if (Math.random() < 0.10) { 
                    let startLat = parseFloat(dev.lat) || 30.0444 + (Math.random() - 0.5) * 0.05;
                    let startLng = parseFloat(dev.lng) || 31.2357 + (Math.random() - 0.5) * 0.05;
                    let targetLat = startLat + (Math.random() - 0.5) * 0.1;
                    let targetLng = startLng + (Math.random() - 0.5) * 0.1;
                    
                    MapEngine.simulateMovementAlongRoad('devices', String(dev.id), startLat, startLng, targetLat, targetLng, SIM_CONFIG.CAR_SPEED_KPH || 80, (lat, lng, heading, speed) => {
                        dev.lat = lat; dev.lng = lng; dev.heading = heading; dev.currentSpeed = speed; 
                        
                        const nowMs = Date.now();
                        if (!dev._lastSave || nowMs - dev._lastSave > 1000) {
                            simCache[`devices_${dev.id}`] = {lat, lng, heading, speed};
                            localStorage.setItem('resq_sim_positions', JSON.stringify(simCache));
                            dev._lastSave = nowMs;
                        }
                        
                        window.updateLiveSpeedUI('devices', dev.id, speed); 
                    }, true); 
                }
            }
        });
    }

    const pendingIncidents = Object.values(window.rawData.incidents).filter(inc => inc.status === 'pending');
    for (const inc of pendingIncidents) {
        let createdAt = new Date(inc.created_at).getTime();
        if (isNaN(createdAt)) createdAt = now - 11000; 
        const timeDiff = (now - createdAt) / 1000;
        
        if (timeDiff >= 10 || timeDiff < 0) { 
            const incCoords = getCoords(inc);
            if (isNaN(incCoords.lat) || isNaN(incCoords.lng)) continue; 

            let nearestAmb = null; let minAmbDist = Infinity;
            Object.values(window.rawData.ambulances).filter(a => a.status === 'available').forEach(a => {
                const aCoords = getCoords(a);
                if (!isNaN(aCoords.lat) && !isNaN(aCoords.lng)) {
                    const dist = Math.sqrt(Math.pow(aCoords.lat - incCoords.lat, 2) + Math.pow(aCoords.lng - incCoords.lng, 2));
                    if (dist < minAmbDist) { minAmbDist = dist; nearestAmb = a; }
                }
            });

            let nearestHosp = null; let minHospDist = Infinity;
            const hospArray = Object.values(window.rawData.hospitals);
            if (hospArray.length > 0) {
                hospArray.forEach(h => {
                    const hCoords = getCoords(h);
                    if (!isNaN(hCoords.lat) && !isNaN(hCoords.lng)) {
                        const dist = Math.sqrt(Math.pow(hCoords.lat - incCoords.lat, 2) + Math.pow(hCoords.lng - incCoords.lng, 2));
                        if (dist < minHospDist) { minHospDist = dist; nearestHosp = h; }
                    }
                });
            } else {
                nearestHosp = { id: null, lat: incCoords.lat + 0.02, lng: incCoords.lng + 0.02, name: "مستشفى طوارئ (افتراضي)" };
            }

            if (nearestAmb) {
                if (!nearestAmb.base_lat) { nearestAmb.base_lat = nearestAmb.lat; nearestAmb.base_lng = nearestAmb.lng; }

                window.rawData.incidents[inc.id].status = 'assigned';
                window.rawData.incidents[inc.id].assigned_ambulance_id = nearestAmb.id;
                window.rawData.incidents[inc.id].assigned_hospital_id = nearestHosp.id || null;
                window.rawData.incidents[inc.id].assigned_at = new Date().toISOString();
                
                window.rawData.ambulances[nearestAmb.id].status = 'assigned';
                window.rawData.ambulances[nearestAmb.id].base_lat = nearestAmb.base_lat;
                window.rawData.ambulances[nearestAmb.id].base_lng = nearestAmb.base_lng;
                
                supabase.from(DB_TABLES.AMBULANCES).update({ status: 'assigned', base_lat: nearestAmb.base_lat, base_lng: nearestAmb.base_lng }).eq('id', nearestAmb.id);
                supabase.from(DB_TABLES.INCIDENTS).update({ 
                    status: 'assigned', 
                    assigned_ambulance_id: nearestAmb.id, 
                    assigned_hospital_id: nearestHosp.id || null, 
                    assigned_at: new Date().toISOString() 
                }).eq('id', inc.id);
                
                uiNeedsUpdate = true;
            }
        }
    }

    const activeIncidents = Object.values(window.rawData.incidents).filter(inc => inc.status !== 'completed' && inc.status !== 'canceled');

Object.values(window.rawData.ambulances).forEach(amb => {
        const assignedInc = activeIncidents.find(inc => inc.assigned_ambulance_id === amb.id);

        if (assignedInc && !MapEngine.activeTasks[`ambulances_${amb.id}`]) {
            let targetLat, targetLng;
            const incCoords = getCoords(assignedInc);
            const ambCoords = getCoords(amb);
            const distToInc = Math.sqrt(Math.pow(ambCoords.lat - incCoords.lat, 2) + Math.pow(ambCoords.lng - incCoords.lng, 2));

            if (amb.status === 'assigned') {
                if (distToInc <= 0.005) {
                    window.rawData.incidents[assignedInc.id].status = 'in_progress';
                    window.rawData.ambulances[amb.id].status = 'in_progress';
                    supabase.from(DB_TABLES.INCIDENTS).update({ status: 'in_progress' }).eq('id', assignedInc.id);
                    supabase.from(DB_TABLES.AMBULANCES).update({ status: 'in_progress' }).eq('id', amb.id);
                    MapEngine.toggleIncidentRoute(assignedInc.id, null, null, null, null, null, null, null, false);
                    uiNeedsUpdate = true; return; 
                }
                targetLat = incCoords.lat; targetLng = incCoords.lng;
            } 
            else if (amb.status === 'in_progress') {
                let targetHosp = window.rawData.hospitals[assignedInc.assigned_hospital_id];
                if (!targetHosp) targetHosp = { lat: incCoords.lat + 0.02, lng: incCoords.lng + 0.02 }; 
                
                const hCoords = getCoords(targetHosp);
                const distToHosp = Math.sqrt(Math.pow(ambCoords.lat - hCoords.lat, 2) + Math.pow(ambCoords.lng - hCoords.lng, 2));
                
                if (distToHosp <= 0.005) {
                    window.rawData.incidents[assignedInc.id].status = 'completed';
                    window.rawData.ambulances[amb.id].status = 'returning';
                    supabase.from(DB_TABLES.INCIDENTS).update({ status: 'completed', resolved_at: new Date().toISOString() }).eq('id', assignedInc.id);
                    supabase.from(DB_TABLES.AMBULANCES).update({ status: 'returning' }).eq('id', amb.id);
                    uiNeedsUpdate = true; return;
                }
                targetLat = hCoords.lat; targetLng = hCoords.lng;
            }

            if (targetLat && targetLng && !isNaN(targetLat) && !isNaN(targetLng)) {
                MapEngine.simulateMovementAlongRoad('ambulances', String(amb.id), amb.lat, amb.lng, targetLat, targetLng, SIM_CONFIG.AMBULANCE_SPEED_KPH * 1.5, (lat, lng, heading, speed) => {
                    amb.lat = lat; amb.lng = lng; amb.heading = heading; amb.currentSpeed = speed; 
                    
                    const nowMs = Date.now();
                    if (!amb._lastSave || nowMs - amb._lastSave > 1000) {
                        simCache[`ambulances_${amb.id}`] = {lat, lng, heading, speed};
                        localStorage.setItem('resq_sim_positions', JSON.stringify(simCache));
                        amb._lastSave = nowMs;
                    }
                    
                    window.updateLiveSpeedUI('ambulances', amb.id, speed); 
                }, true); 
            }
        } 
        else if (amb.status === 'returning' && !MapEngine.activeTasks[`ambulances_${amb.id}`]) {
            const baseLat = parseFloat(amb.base_lat) || 30.0444; const baseLng = parseFloat(amb.base_lng) || 31.2357;
            const ambCoords = getCoords(amb);
            const distToBase = Math.sqrt(Math.pow(ambCoords.lat - baseLat, 2) + Math.pow(ambCoords.lng - baseLng, 2));
            
            if (distToBase <= 0.005) {
                window.rawData.ambulances[amb.id].status = 'available';
                supabase.from(DB_TABLES.AMBULANCES).update({ status: 'available' }).eq('id', amb.id);
                uiNeedsUpdate = true; return;
            }

            MapEngine.simulateMovementAlongRoad('ambulances', String(amb.id), amb.lat, amb.lng, baseLat, baseLng, SIM_CONFIG.AMBULANCE_SPEED_KPH, (lat, lng, heading, speed) => {
                amb.lat = lat; amb.lng = lng; amb.heading = heading; amb.currentSpeed = speed; 
                
                const nowMs = Date.now();
                if (!amb._lastSave || nowMs - amb._lastSave > 1000) {
                    simCache[`ambulances_${amb.id}`] = {lat, lng, heading, speed};
                    localStorage.setItem('resq_sim_positions', JSON.stringify(simCache));
                    amb._lastSave = nowMs;
                }

                window.updateLiveSpeedUI('ambulances', amb.id, speed);
            }, true); 
        }
        // 🌟 الميزة الجديدة: نظام الدوريات الاستطلاعية للإسعافات المتاحة 🌟
        else if (amb.status === 'available' && !MapEngine.activeTasks[`ambulances_${amb.id}`]) {
            // إعطاء فرصة 15% فقط لبدء مشوار جديد في كل دورة (لمنع الضغط على السيرفر ولتأخذ السيارات فترة توقف منطقية)
            if (Math.random() < 0.15) { 
                const baseLat = parseFloat(amb.base_lat) || parseFloat(amb.lat) || 30.0444; 
                const baseLng = parseFloat(amb.base_lng) || parseFloat(amb.lng) || 31.2357;
                const patrolRadius = SIM_CONFIG.PATROL_RADIUS || 0.03;
                
                // اختيار نقطة عشوائية حول القاعدة
                let targetLat = baseLat + (Math.random() - 0.5) * patrolRadius * 2;
                let targetLng = baseLng + (Math.random() - 0.5) * patrolRadius * 2;
                
                // سرعة الدورية أبطأ من الطوارئ (تساوي 50% من السرعة العادية)
                const patrolSpeed = (SIM_CONFIG.AMBULANCE_SPEED_KPH || 120) * 0.5;

                MapEngine.simulateMovementAlongRoad('ambulances', String(amb.id), amb.lat, amb.lng, targetLat, targetLng, patrolSpeed, (lat, lng, heading, speed) => {
                    amb.lat = lat; amb.lng = lng; amb.heading = heading; amb.currentSpeed = speed; 
                    
                    const nowMs = Date.now();
                    if (!amb._lastSave || nowMs - amb._lastSave > 1000) {
                        simCache[`ambulances_${amb.id}`] = {lat, lng, heading, speed};
                        localStorage.setItem('resq_sim_positions', JSON.stringify(simCache));
                        amb._lastSave = nowMs;
                    }

                    window.updateLiveSpeedUI('ambulances', amb.id, speed);
                }, true); // المشي على شوارع حقيقية فقط
            }
        }
    });

    if (uiNeedsUpdate) window.updateAllUI();
};

setInterval(() => {
    document.querySelectorAll('.incident-timer').forEach(timer => {
        const status = timer.getAttribute('data-status');
        if (status === 'pending') {
            let createdAt = new Date(timer.getAttribute('data-created')).getTime();
            if(isNaN(createdAt)) createdAt = new Date().getTime(); 
            const now = new Date().getTime();
            let timeLeft = 10 - Math.floor((now - createdAt) / 1000); 
            
            if (timeLeft <= 0) {
                if (timer.innerText !== 'جاري التوجيه...') {
                    timer.innerText = 'جاري التوجيه...';
                    timer.classList.replace('text-red-500', 'text-warning');
                }
            } else {
                const txt = `00:${timeLeft < 10 ? '0'+timeLeft : timeLeft}`;
                if (timer.innerText !== txt) timer.innerText = txt;
            }
        }
    });
}, 1000);