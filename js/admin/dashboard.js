// ============================================================================
// 🎛️ EnQaZ Dashboard Controller (Luxury View & Telemetry Receiver) - V4.0
// ============================================================================

import { supabase, DB_TABLES, logIncidentAction, isIncidentTerminal, isIncidentVisible } from '../config/supabase.js';
import { MapEngine, SIM_CONFIG } from './mapEngine.js';
    const SMOOTHING_FACTOR = 0.001; // نعومة فائقة للحركة

// 📡 إنشاء الاتصال بقناة البث اللحظي القادمة من المايكرو-سيرفر (Engine)
export const trackingChannel = supabase.channel('live-tracking');

// إعدادات النظام الحالية
export const SysSettings = { 
    mode: localStorage.getItem('resq_sys_mode') || 'simulation',
    trackCivilians: JSON.parse(localStorage.getItem('resq_live_config') || '{"TRACK_CIVILIANS": true}').TRACK_CIVILIANS
};

const sessionString = localStorage.getItem('resq_custom_session');
const currentAdminId = sessionString ? JSON.parse(sessionString).id : null;

// الذاكرة المؤقتة للواجهة (In-Memory State)
window.rawData = { hospitals: {}, ambulances: {}, incidents: {}, devices: {} };
window.currentOpenPanel = { type: null, id: null }; 
window.lastUiUpdateTime = 0;

// متغيرات التحكم في الكاميرا
let targetCameraPos = null;
let currentCameraPos = null;
window.isUserInteracting = false;
window.interactionTimeout = null;

// 🎥 نظام الكاميرا السينمائي المطور (Anti-Fight System)
function startSmoothCameraLoop() {
    const mapContainer = document.getElementById('adminMap');
    if (mapContainer) {
        // 🌟 إيقاف الكاميرا فوراً بمجرد لمس المستخدم للشاشة لمنع التقطيع
        const pauseTracking = () => { window.isUserInteracting = true; };
        // 🌟 استئناف الكاميرا بعد التوقف عن اللمس بـ 1.5 ثانية
        const resumeTracking = () => { 
            clearTimeout(window.interactionTimeout);
            window.interactionTimeout = setTimeout(() => { window.isUserInteracting = false; }, 1500); 
        };

        mapContainer.addEventListener('mousedown', pauseTracking);
        mapContainer.addEventListener('touchstart', pauseTracking, {passive: true});
        mapContainer.addEventListener('wheel', pauseTracking, {passive: true});
        
        window.addEventListener('mouseup', resumeTracking);
        window.addEventListener('touchend', resumeTracking);
        mapContainer.addEventListener('wheel', resumeTracking, {passive: true});
    }


    const loop = () => {
        // التتبع يعمل فقط إذا كان هناك هدف، والمستخدم لا يلمس الخريطة حالياً
        if (MapEngine.trackedEntity && MapEngine.targetCameraPos && !window.isUserInteracting) {
            
            if (!MapEngine.currentCameraPos) {
                MapEngine.currentCameraPos = { ...MapEngine.targetCameraPos };
            }

            // معادلة التحريك الخطي (Lerp)
            MapEngine.currentCameraPos.lat += (MapEngine.targetCameraPos.lat - MapEngine.currentCameraPos.lat) * SMOOTHING_FACTOR;
            MapEngine.currentCameraPos.lng += (MapEngine.targetCameraPos.lng - MapEngine.currentCameraPos.lng) * SMOOTHING_FACTOR;

            const distLat = Math.abs(MapEngine.targetCameraPos.lat - MapEngine.currentCameraPos.lat);
            const distLng = Math.abs(MapEngine.targetCameraPos.lng - MapEngine.currentCameraPos.lng);

            // تحديث الكاميرا فقط إذا كانت المسافة تستحق (لتخفيف الضغط وتقليل الـ Jitter)
            if (distLat > 0.00001 || distLng > 0.00001) {
                MapEngine.map.setView(
                    [MapEngine.currentCameraPos.lat, MapEngine.currentCameraPos.lng], 
                    MapEngine.map.getZoom(), 
                    { animate: false }
                );
            }
        }
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}

/**
 * 📝 تسجيل إجراءات الإدارة في سجل النظام
 */
async function logSystemAction(action, targetTable, targetId, note) {
    if (!currentAdminId) return;
    try {
        const safeTargetId = isNaN(targetId) || targetId === 'GLOBAL' ? null : parseInt(targetId);
        if (targetTable === 'incidents' && safeTargetId) {
            await logIncidentAction(safeTargetId, action, `Admin ID: ${currentAdminId}`, note);
        } else {
            // Non-incident logs can remain raw inserts
            await supabase.from(DB_TABLES.INCIDENT_LOGS).insert([{
                incident_id: null,
                action: action,
                performed_by: `Admin ID: ${currentAdminId}`,
                note: note
            }]);
        }
    } catch (error) { console.error("Audit Log Failed:", error); }
}

/**
 * 🚀 دالة التهيئة الرئيسية (نقطة الانطلاق)
 */
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
    
    // 🌟 استدعاء واجهة البوصلة المطورة
    addCompassUI();

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
    
    setupDatabaseRealtime(); 
    setupLiveTelemetry();    
    startSmoothCameraLoop(); 

    window.addEventListener('languageChanged', () => window.updateAllUI());
}

/**
 * 🧭 دالة إضافة واجهة البوصلة (Compass UI) المحدثة بالدوران الحر
 */
function addCompassUI() {
    const mapContainer = document.getElementById('mapContainer');
    if (!mapContainer || document.getElementById('compassUI')) return;

    const compassHtml = `
        <div id="compassUI" class="absolute top-4 left-1/2 transform -translate-x-1/2 z-[500] bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl px-5 py-3 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col items-center gap-3 transition-all duration-300 w-64">
            <div class="flex items-center justify-between w-full">
                <div class="text-[10px] font-black text-gray-500 uppercase tracking-widest"><i class="fa-regular fa-compass"></i> البوصلة</div>
                <div class="flex items-center gap-1">
                    <button onclick="window.rotateMap(0)" class="w-6 h-6 bg-gray-100 dark:bg-gray-800 hover:bg-primary hover:text-white text-gray-700 dark:text-gray-300 rounded-full font-black text-[9px] transition-all shadow-sm">N</button>
                    <button onclick="window.rotateMap(90)" class="w-6 h-6 bg-gray-100 dark:bg-gray-800 hover:bg-primary hover:text-white text-gray-700 dark:text-gray-300 rounded-full font-black text-[9px] transition-all shadow-sm">E</button>
                    <button onclick="window.rotateMap(180)" class="w-6 h-6 bg-gray-100 dark:bg-gray-800 hover:bg-primary hover:text-white text-gray-700 dark:text-gray-300 rounded-full font-black text-[9px] transition-all shadow-sm">S</button>
                    <button onclick="window.rotateMap(270)" class="w-6 h-6 bg-gray-100 dark:bg-gray-800 hover:bg-primary hover:text-white text-gray-700 dark:text-gray-300 rounded-full font-black text-[9px] transition-all shadow-sm">W</button>
                </div>
            </div>
            <div class="w-full border-t border-gray-200 dark:border-gray-700"></div>
            <div class="flex items-center gap-3 w-full">
                <i class="fa-solid fa-rotate text-gray-400 text-[10px]"></i>
                <input type="range" id="freeRotationSlider" min="0" max="360" value="0" step="1" class="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-primary" oninput="window.rotateMap(this.value, true)">
                <span id="rotationValueDisplay" class="text-[10px] font-mono font-black text-primary w-8 text-right">0°</span>
            </div>
        </div>
    `;
    mapContainer.insertAdjacentHTML('beforeend', compassHtml);
}

// 🔄 دوال التحكم في دوران الخريطة والبوصلة (Global)
window.rotateMap = function(angle, fromSlider = false) {
    const mapEl = document.getElementById('adminMap');
    const slider = document.getElementById('freeRotationSlider');
    const display = document.getElementById('rotationValueDisplay');
    
    let safeAngle = parseInt(angle) || 0;
    if (safeAngle === 360) safeAngle = 0;

    if (mapEl) {
        // نستخدم Scale ثابت لتجنب الارتجاج عند استخدام السلايدر
        const scale = safeAngle === 0 ? 1 : 1.4; 
        mapEl.style.transition = fromSlider ? 'none' : 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
        mapEl.style.transform = `scale(${scale}) rotate(${safeAngle}deg)`;
    }

    if (slider && !fromSlider) slider.value = safeAngle;
    if (display) display.innerText = safeAngle + '°';
};

window.resetMapRotation = function() {
    window.rotateMap(0);
};

/**
 * 📥 جلب البيانات الأساسية من الداتابيز
 */
async function loadEntities() {
    window.rawData.hospitals = {};
    window.rawData.ambulances = {};
    window.rawData.incidents = {};

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
    window.rawData.devices = {};
    const { data } = await supabase.from(DB_TABLES.DEVICES).select('*, users(name, phone)');
    if (data) {
        data.forEach(d => window.rawData.devices[d.id] = d);
        window.updateAllUI();
    }
}

/**
 * 📡 الاستماع للتحديثات الجوهرية من قاعدة البيانات
 */
function setupDatabaseRealtime() {
    // ─── INCIDENTS REALTIME FIX ───
    supabase.channel('admin-incidents')
        .on('postgres_changes', { event: '*', schema: 'public', table: DB_TABLES.INCIDENTS }, payload => {
            console.log('[REALTIME:PAYLOAD]', payload);
            const newInc = payload.new;
            const oldInc = payload.old;

            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                // To satisfy DEVICE STATE RULE (devices must stay busy during hospital phase),
                // we MUST keep the incident in rawData until it is strictly TERMINAL.
                // The UI (renderIncidents & map markers) will hide it based on isIncidentVisible().
                if (!isIncidentTerminal(newInc.status)) {
                    window.rawData.incidents[newInc.id] = newInc;
                } else {
                    delete window.rawData.incidents[newInc.id];
                    // Also trigger route cleanup
                    MapEngine.toggleIncidentRoute(newInc.id, null, null, null, null, null, null, null, false);
                }
            }

            if (payload.eventType === 'DELETE') {
                delete window.rawData.incidents[oldInc.id];
            }

            window.updateAllUI();
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('[REALTIME:CONNECTED] Incidents channel connected');
            }
        });

    // ─── DEVICES REALTIME FIX ───
    supabase.channel('admin-devices')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: DB_TABLES.DEVICES }, payload => {
            console.log('[REALTIME:PAYLOAD]', payload);
            const dev = payload.new;
            
            // G) RACE CONDITION FIX: Always allow object modification without checking existence
            window.rawData.devices[dev.id] = { ...(window.rawData.devices[dev.id] || {}), ...dev };
            
            console.log('[REALTIME] Device updated', dev.id);
            window.updateAllUI();
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('[REALTIME:CONNECTED] Devices channel connected');
            }
        });

    // ─── AMBULANCES REALTIME FIX ───
    supabase.channel('admin-ambulances')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: DB_TABLES.AMBULANCES }, payload => {
            console.log('[REALTIME:PAYLOAD]', payload);
            const amb = payload.new;
            
            window.rawData.ambulances[amb.id] = { ...(window.rawData.ambulances[amb.id] || {}), ...amb };
            window.updateAllUI();
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('[REALTIME:CONNECTED] Ambulances channel connected');
            }
        });
}

/**
 * 🏎️ المستقبل اللحظي للسرعة والحركة
 */
function setupLiveTelemetry() {
    trackingChannel.on('broadcast', { event: 'fleet_update' }, (payload) => {
        const fleetData = payload.payload;
        fleetData.forEach(unit => {
            const { id, lat, lng, heading, speed } = unit;
            if (window.rawData.ambulances[id]) {
                window.rawData.ambulances[id].lat = lat;
                window.rawData.ambulances[id].lng = lng;
                window.rawData.ambulances[id].currentSpeed = speed;

                updateMarkerSmoothly('ambulances', id, lat, lng, heading);
                window.updateLiveSpeedUI('ambulances', id, speed);
            }
        });
    });

    trackingChannel.on('broadcast', { event: 'civilians_update' }, (payload) => {
        if (!SysSettings.trackCivilians) return;
        const civData = payload.payload;
        civData.forEach(car => {
            const { id, lat, lng, heading, speed } = car;
            if (window.rawData.devices[id]) {
                window.rawData.devices[id].lat = lat;
                window.rawData.devices[id].lng = lng;
                window.rawData.devices[id].currentSpeed = speed;

                updateMarkerSmoothly('devices', id, lat, lng, heading);
                window.updateLiveSpeedUI('devices', id, speed);
            }
        });
    });

    trackingChannel.subscribe();
}

/**
 * 🌟 تحريك وتوجيه المركبات بدقة فائقة
 */
function updateMarkerSmoothly(type, id, lat, lng, heading) {
    const strId = String(id);
    const marker = MapEngine.markers[type]?.[strId];
    
    if (marker) {
        const curLatLng = marker.getLatLng();
        const isMoved = curLatLng.lat !== lat || curLatLng.lng !== lng;
        
        // 1. تحديث الموقع
        if (isMoved) {
            marker.setLatLng([lat, lng]);
        }

        // 2. 🌟 تطبيق الدوران المستقل للأيقونة بناءً على اتجاه السيارة الحقيقي 🌟
        // نستخدم خاصية rotate بدلاً من transform لتجنب مسح تأثيرات Tailwind
        if (marker._icon && heading !== undefined) {
            const iconDiv = marker._icon.firstElementChild; // استهداف الـ Div الداخلي
            if (iconDiv) {
                iconDiv.style.transition = 'rotate 1s linear';
                iconDiv.style.rotate = `${heading}deg`;
            }
        }

        // 3. تحديث هدف الكاميرا
        if (MapEngine.trackedEntity === `${type}_${strId}`) {
            MapEngine.targetCameraPos = { lat, lng };
        }
    }
}

// ============================================================================
// 🎨 دوال تحديث الواجهة الرسومية (UI Renderers)
// ============================================================================

window.updateAllUI = function() {
    if (typeof window.renderIncidents === 'function') window.renderIncidents();
    if (typeof window.renderAmbulances === 'function') window.renderAmbulances();
    if (typeof window.renderDevices === 'function') window.renderDevices();
    
    const allIncidents = Object.values(window.rawData.incidents);
    // UI VISIBILITY RULE: Show incidents on map only if they are NOT terminal and NOT in hospital phase
    const visibleIncidents = allIncidents.filter(inc => isIncidentVisible(inc.status));
    MapEngine.updateMarkers('incidents', visibleIncidents);
    
    MapEngine.updateMarkers('hospitals', Object.values(window.rawData.hospitals));
    MapEngine.updateMarkers('ambulances', Object.values(window.rawData.ambulances));
    
    // Devices are "busy" during the ENTIRE active lifecycle — not just pending/assigned/in_progress.
    // This includes hospital-phase states (arrived_hospital, hospital_confirmed).
    // Using negative filter: any incident that is NOT terminal keeps its device busy.
    const busyDeviceIds = allIncidents
        .filter(inc => !isIncidentTerminal(inc.status))
        .map(inc => String(inc.device_id));
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
        .filter(inc => isIncidentVisible(inc.status))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const pendingBadge = document.getElementById('pendingCountBadge');
    if (pendingBadge) pendingBadge.innerText = activeIncidents.length;

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
    
    list.innerHTML = dataToRender.map(dev => {
        const hasIncident = allIncidents.find(inc => String(inc.device_id) === String(dev.id) && !isIncidentTerminal(inc.status));
        const isMoving = dev.currentSpeed > 0;
        
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
        const activeIncident = Object.values(window.rawData.incidents).find(inc => String(inc.device_id) === String(data.id) && !isIncidentTerminal(inc.status));
        const isMoving = data.currentSpeed > 0;
        const isTracked = MapEngine.trackedEntity === `devices_${data.id}`; 

        let movementStatus = isMoving ? 'في طريق (مشوار)' : 'متوقفة';
        let movementColor = isMoving ? 'text-primary animate-pulse' : 'text-gray-400';
        let speedText = isMoving ? Math.round(data.currentSpeed || 0) + ' km/h' : '0 km/h';

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
        const isTracked = MapEngine.trackedEntity === `ambulances_${data.id}`; 
        
        let statusColor = 'text-blue-500';
        let currentTask = 'متوقفة';
        let displaySpeed = data.currentSpeed || 0;

        if (data.status === 'available') {
            statusColor = 'text-blue-500';
            currentTask = displaySpeed > 0 ? 'دورية استطلاعية' : 'متوقفة (جاهزة)';
        } else if (data.status === 'assigned') {
            statusColor = 'text-warning';
            currentTask = '🚨 متجه لموقع الحادث 🚨';
        } else if (data.status === 'in_progress') {
            statusColor = 'text-purple-500';
            currentTask = '🏥 نقل المصاب للمستشفى 🏥';
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

// ============================================================================
// 🛠️ أفعال المستخدم (User Actions)
// ============================================================================

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

window.cancelIncident = function(incId) {
    if(window.openConfirmModal) {
        window.openConfirmModal(
            "إلغاء البلاغ الطارئ", 
            "هل أنت متأكد من إلغاء هذا البلاغ؟ سيتم فك ارتباط الإسعاف وإعادته للقاعدة، وإلغاء حجز المستشفى.", 
            async () => executeCancel(incId)
        );
    } else {
        if(confirm("هل أنت متأكد من إلغاء البلاغ؟")) executeCancel(incId);
    }
};

async function executeCancel(incId) {
    const inc = window.rawData.incidents[incId];
    if (!inc) {
        console.warn(`[DEBUG:CANCEL_FLOW] executeCancel: Incident #${incId} not found in local state.`);
        return;
    }

    // HARDENED: Guard against double-execution.
    // If the incident is already in a terminal state (cancelled or completed),
    // bail out immediately without inserting a duplicate hardware_request row.
    if (isIncidentTerminal(inc.status)) {
        console.log(`[DEBUG:CANCEL_FLOW] executeCancel: INC#${incId} already terminal (${inc.status}). Skipping.`);
        return;
    }

    // HARDENED: Mark locally as cancelled BEFORE the async insert to prevent
    // a second synchronous call (e.g., another button click) from passing the guard above.
    inc.status = 'cancelled';
    console.log('[DEBUG:CANCEL_FLOW]', { incident_id: incId, stage: 'admin_cancel_initiated', admin_id: currentAdminId });

    // Send unified cancel signal via hardware_requests table.
    // The Engine listens to this table and routes the cancel through the atomic RPC.
    const { error } = await supabase.from(DB_TABLES.HARDWARE_REQUESTS).insert([{
        device_id: inc.device_id,
        request_type: 'cancel',
        raw_payload: JSON.stringify({ 
            source: 'admin', 
            reason: 'cancelled_by_admin',
            admin_id: currentAdminId 
        })
    }]);

    if (error) {
        console.error('[DEBUG:CANCEL_FLOW] Failed to insert cancel hardware_request:', error);
        // Revert local state so the admin can try again
        inc.status = 'assigned'; // restore to previous active state
        return;
    }

    // Cleanup UI immediately for UX fluidity (realtime handles the rest)
    MapEngine.toggleIncidentRoute(incId, null, null, null, null, null, null, null, false);
    delete window.rawData.incidents[incId]; // Remove immediately, realtime will confirm
    
    window.updateAllUI(); 
    document.getElementById('detailsPanel').classList.add(document.documentElement.dir === 'rtl' ? '-translate-x-[120%]' : 'translate-x-[120%]');
}

// ⏱️ مؤقت العد التنازلي البصري للحوادث
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