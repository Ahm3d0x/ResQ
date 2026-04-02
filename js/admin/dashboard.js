import { supabase, DB_TABLES } from '../config/supabase.js';
import { t } from '../core/language.js';
import { MapEngine } from './mapEngine.js';

let rawData = { hospitals: {}, ambulances: {}, incidents: {}, devices: {} };

const ROUTE_COLORS = ['#3b82f6', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4', '#14b8a6'];
const FIXED_ZONES = [ { lat: 30.0444, lng: 31.2357 }, { lat: 30.0600, lng: 31.3300 }, { lat: 29.9600, lng: 31.2500 }, { lat: 30.0500, lng: 31.1800 } ];

export async function initDashboard() {
    MapEngine.init('adminMap', 30.0444, 31.2357, (type, data) => openPanel(type, data));
    
    await loadEntities();
    await loadDevices();
    setupRealtime();
    setupDeviceSearch();
    setInterval(processSystemQueues, 8000);

    // 🌟 تفعيل أزرار الزحام المروري والخريطة الحرارية 🌟
    document.getElementById('toggleTrafficBtn')?.addEventListener('click', function() {
        MapEngine.toggleTraffic();
        this.classList.toggle('bg-red-600/90');
        this.classList.toggle('border-red-500');
    });

    document.getElementById('toggleHeatmapBtn')?.addEventListener('click', async function() {
        const { data } = await supabase.from(DB_TABLES.INCIDENTS).select('latitude, longitude');
        MapEngine.toggleHeatmap(data || []);
        this.classList.toggle('bg-orange-600/90');
        this.classList.toggle('border-orange-500');
    });

    window.addEventListener('languageChanged', () => {
        renderIncidents();
        renderAmbulances();
        renderDevices(Object.values(rawData.devices));
        const panel = document.getElementById('detailsPanel');
        if(panel) panel.classList.add(document.documentElement.dir === 'rtl' ? '-translate-x-[120%]' : 'translate-x-[120%]');
    });
}

async function loadEntities() {
    try {
        const { data: hData } = await supabase.from(DB_TABLES.HOSPITALS).select('*');
        hData?.forEach(h => { rawData.hospitals[h.id] = h; MapEngine.updateHospital(h.id, h.lat, h.lng, h); });

        const { data: aData } = await supabase.from(DB_TABLES.AMBULANCES).select('*');
        aData?.forEach((a, idx) => {
            a.routeColor = ROUTE_COLORS[idx % ROUTE_COLORS.length]; 
            let zone = FIXED_ZONES[idx % FIXED_ZONES.length];
            a.baseLat = a.lat || zone.lat; a.baseLng = a.lng || zone.lng;
            rawData.ambulances[a.id] = a;
            MapEngine.updateAmbulance(a.id, a.lat, a.lng, a.status, a.routeColor, a, a.baseLat, a.baseLng);
        });
        renderAmbulances();

        const { data: iData } = await supabase.from(DB_TABLES.INCIDENTS).select('*, devices(device_uid, car_model, car_plate)').not('status', 'in', '("completed","canceled")');
        rawData.incidents = {};
        iData?.forEach(i => {
            rawData.incidents[i.id] = i;
            MapEngine.updateIncident(i.id, i.latitude, i.longitude, i.status, i);
        });
        renderIncidents();
    } catch(err) { console.error(err); }
}

async function loadDevices() {
    const { data: dData } = await supabase.from(DB_TABLES.DEVICES).select('*, users(name, phone)');
    dData?.forEach((d) => {
        let lat = d.lat || (30.0444 + (Math.random() - 0.5) * 0.1);
        let lng = d.lng || (31.2357 + (Math.random() - 0.5) * 0.1);
        rawData.devices[d.id] = { ...d, lat, lng };
        
        MapEngine.updateCar(d.id, lat, lng, rawData.devices[d.id], async (newLat, newLng) => {
            try {
                await supabase.from(DB_TABLES.DEVICES).update({ lat: newLat, lng: newLng }).eq('id', d.id);
                if (rawData.devices[d.id]) {
                    rawData.devices[d.id].lat = newLat;
                    rawData.devices[d.id].lng = newLng;
                }
            } catch(e) {}
        });
    });
    renderDevices(Object.values(rawData.devices));
}

function setupRealtime() {
    supabase.channel('dispatch_chan').on('postgres_changes', { event: '*', schema: 'public', table: DB_TABLES.INCIDENTS }, async p => {
        await loadEntities();
        if(p.eventType === 'INSERT') {
            const inc = rawData.incidents[p.new.id];
            if(inc) {
                if(window.showToast) window.showToast(`New Incident Detected! (#INC-${inc.id})`, 'error');
                addLiveNotification(inc); // 🔔 إضافة الإشعار للجرس
            }
            setTimeout(() => attemptDispatch(inc), 10000);
        }
    }).subscribe();
}

// دالة جديدة لتوليد الإشعار داخل الجرس
function addLiveNotification(inc) {
    const list = document.getElementById('notifList');
    const badge = document.getElementById('notifBadge');
    const noMsg = document.getElementById('noNotifsMsg');
    if(!list || !badge) return;

    if (noMsg) noMsg.style.display = 'none'; // إخفاء رسالة "لا توجد إشعارات"

    const timeStr = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const notifHtml = `
        <div class="p-3 bg-red-50 dark:bg-red-500/10 rounded-xl border border-red-100 dark:border-red-500/20 cursor-pointer hover:bg-red-100 dark:hover:bg-red-500/20 transition-all transform hover:scale-[1.02]" onclick="focusMapEntity('Incident', ${inc.id}); document.getElementById('notifDropdown').classList.add('opacity-0', 'pointer-events-none');">
            <div class="flex justify-between items-center mb-1">
                <span class="text-xs font-bold text-primary"><i class="fa-solid fa-triangle-exclamation ltr:mr-1 rtl:ml-1"></i> New Alert #INC-${inc.id}</span>
                <span class="text-[10px] text-gray-500 font-mono">${timeStr}</span>
            </div>
            <div class="text-[10px] text-gray-600 dark:text-gray-300">High G-Force impact detected. Dispatching unit soon.</div>
        </div>
    `;
    
    list.insertAdjacentHTML('afterbegin', notifHtml);
    
    // تحديث رقم الـ Badge وجعله ينبض
    let currentCount = parseInt(badge.innerText) || 0;
    badge.innerText = currentCount + 1;
    badge.classList.remove('hidden');
    badge.classList.add('scale-125');
    setTimeout(() => badge.classList.remove('scale-125'), 300);
}

async function attemptDispatch(inc) {
    const { data: currInc } = await supabase.from(DB_TABLES.INCIDENTS).select('*').eq('id', inc.id).single();
    if (!currInc || currInc.status === 'canceled' || currInc.status === 'completed') return;

    if (currInc.status === 'pending') {
        await supabase.from(DB_TABLES.INCIDENTS).update({ status: 'confirmed' }).eq('id', currInc.id);
        currInc.status = 'confirmed';
    }

    const availableAmbs = Object.values(rawData.ambulances).filter(a => a.status === 'available');
    const availableHosps = Object.values(rawData.hospitals).filter(h => h.available_beds > 0);
    if (availableAmbs.length === 0 || availableHosps.length === 0) return await loadEntities();

    let nearestAmb = availableAmbs.reduce((p, c) => getDist(currInc.latitude, currInc.longitude, c.lat || c.baseLat, c.lng || c.baseLng) < getDist(currInc.latitude, currInc.longitude, p.lat || p.baseLat, p.lng || p.baseLng) ? c : p);
    let nearestHosp = availableHosps.reduce((p, c) => getDist(currInc.latitude, currInc.longitude, c.lat, c.lng) < getDist(currInc.latitude, currInc.longitude, p.lat, p.lng) ? c : p);

    await Promise.all([
        supabase.from(DB_TABLES.HOSPITALS).update({ available_beds: nearestHosp.available_beds - 1 }).eq('id', nearestHosp.id),
        supabase.from(DB_TABLES.AMBULANCES).update({ status: 'en_route_incident' }).eq('id', nearestAmb.id),
        supabase.from(DB_TABLES.INCIDENTS).update({ status: 'assigned', assigned_ambulance_id: nearestAmb.id, assigned_hospital_id: nearestHosp.id }).eq('id', currInc.id)
    ]);
    
    if(window.showToast) window.showToast(`Dispatched Unit ${nearestAmb.code}`, 'success');
    await loadEntities();

    MapEngine.executeDispatch(nearestAmb, currInc, nearestHosp, async (stage) => {
        if (stage === 'reached_incident') {
            await supabase.from(DB_TABLES.INCIDENTS).update({ status: 'in_progress' }).eq('id', currInc.id);
            await supabase.from(DB_TABLES.AMBULANCES).update({ status: 'en_route_hospital' }).eq('id', nearestAmb.id);
            MapEngine.updateIncident(currInc.id, 0, 0, 'in_progress', null); 
        } else if (stage === 'completed') {
            await supabase.from(DB_TABLES.AMBULANCES).update({ status: 'available', lat: nearestAmb.baseLat, lng: nearestAmb.baseLng }).eq('id', nearestAmb.id); 
            await supabase.from(DB_TABLES.INCIDENTS).update({ status: 'completed', resolved_at: new Date() }).eq('id', currInc.id);
            if(window.showToast) window.showToast(`Incident #INC-${currInc.id} Completed!`, 'success');
            await loadEntities();
            processSystemQueues();
        }
    });
}

async function processSystemQueues() {
    await loadEntities();
    const queued = Object.values(rawData.incidents).filter(i => i.status === 'confirmed' && !i.assigned_ambulance_id);
    for (let inc of queued) await attemptDispatch(inc);
}

function getDist(lat1, lon1, lat2, lon2) { return Math.hypot(lat1 - lat2, lon1 - lon2); }

// ==========================================
// واجهة المستخدم (UI) والكروت 
// ==========================================
window.focusMapEntity = function(type, id) {
    let data = type === 'Incident' ? rawData.incidents[id] : type === 'Ambulance' ? rawData.ambulances[id] : rawData.devices[id];
    if (data) openPanel(type, data);
}

window.toggleRoute = function(incId, e) {
    e.stopPropagation();
    if(MapEngine.routes[incId]) {
        if(MapEngine.map.hasLayer(MapEngine.routes[incId])) MapEngine.map.removeLayer(MapEngine.routes[incId]);
        else MapEngine.map.addLayer(MapEngine.routes[incId]);
    }
}

function openPanel(type, data) {
    const panel = document.getElementById('detailsPanel');
    panel.classList.remove('translate-x-[120%]', '-translate-x-[120%]', 'rtl:-translate-x-[120%]');
    let translatedType = type === 'Incident' ? t('dashIncidents') : type === 'Ambulance' ? t('navAmbulances') : type === 'Device' ? t('dashDevices') : t('navHospitals');
    document.getElementById('panelTitle').innerHTML = `<span class="${type==='Incident'?'text-primary':type==='Ambulance'?'text-success':type==='Device'?'text-blue-500':'text-gray-200'}">${translatedType} ${t('panelDetailsTitle')}</span>`;
    
    let liveLat, liveLng;
    if (type === 'Ambulance') {
        let m = MapEngine.markers.ambulances[data.id];
        let pos = m ? m.getLatLng() : null;
        liveLat = pos ? pos.lat : (data.lat || data.baseLat);
        liveLng = pos ? pos.lng : (data.lng || data.baseLng);
    } else if (type === 'Device') {
        let m = MapEngine.markers.devices[data.id];
        let pos = m ? m.getLatLng() : null;
        liveLat = pos ? pos.lat : data.lat;
        liveLng = pos ? pos.lng : data.lng;
    } else {
        liveLat = data.latitude || data.lat;
        liveLng = data.longitude || data.lng;
    }

    MapEngine.map.flyTo([liveLat, liveLng], type === 'Device' ? 16 : 15, {animate:true});
    
    if (type === 'Incident') {
        document.getElementById('panelContent').innerHTML = `
            <div class="flex justify-between border-b dark:border-white/10 pb-2"><span>${t('status')}</span><span class="text-primary font-bold uppercase">${data.status}</span></div>
            <div class="flex justify-between border-b dark:border-white/10 pb-2"><span>${t('gForce') || 'G-Force'}</span><span class="font-mono text-red-500">${data.g_force} G</span></div>
            <div class="flex justify-between text-xs text-gray-400 mt-2"><span>${data.devices?.car_model || ''}</span><span>${data.devices?.device_uid}</span></div>`;
    } else if (type === 'Ambulance') {
        document.getElementById('panelContent').innerHTML = `
            <div class="flex justify-between border-b dark:border-white/10 pb-2"><span>${t('unitCode')}</span><span class="font-bold text-gray-800 dark:text-white uppercase">${data.code}</span></div>
            <div class="flex justify-between"><span>${t('status')}</span><span class="uppercase font-bold ${data.status==='available'?'text-success':'text-red-500'}">${data.status.replace('_', ' ')}</span></div>`;
    } else if (type === 'Device') {
        document.getElementById('panelContent').innerHTML = `
            <div class="flex justify-between border-b dark:border-white/10 pb-2"><span>${t('ownerName') || 'Owner'}</span><span class="font-bold text-gray-800 dark:text-white">${data.users?.name || 'N/A'}</span></div>
            <div class="flex justify-between border-b dark:border-white/10 pb-2"><span>${t('phone')}</span><span class="font-mono text-gray-600 dark:text-gray-300">${data.users?.phone || 'N/A'}</span></div>
            <div class="flex justify-between text-xs mt-2"><span>${data.car_model || ''}</span><span class="text-gray-500">${data.car_plate || ''}</span></div>
            <div class="text-center mt-3 text-[10px] text-gray-400 font-mono">${data.device_uid}</div>`;
    } else if (type === 'Hospital') {
        document.getElementById('panelContent').innerHTML = `
            <div class="flex justify-between border-b dark:border-white/10 pb-2 font-bold text-gray-800 dark:text-white"><span>${data.name}</span></div>
            <div class="flex justify-between"><span>${t('availBeds')}</span><span class="text-xl font-black text-blue-500">${data.available_beds}</span></div>
        `;
    }
}

function renderIncidents() {
    const list = document.getElementById('incidentsPanelList') || document.getElementById('incidentsBody');
    if(!list) return;
    const incidents = Object.values(rawData.incidents).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const badge = document.getElementById('pendingCountBadge'); if(badge) badge.innerText = incidents.filter(i=>i.status==='pending').length;
    
    list.innerHTML = incidents.map(inc => {
        let isQueued = (inc.status === 'confirmed' && !inc.assigned_ambulance_id);
        let sColor = inc.status === 'pending' ? 'text-warning' : isQueued ? 'text-primary' : 'text-success';
        return `
        <div class="bg-gray-50 dark:bg-white/5 border border-transparent dark:border-white/10 rounded-lg p-2 mb-2 transition-colors hover:border-gray-300 dark:hover:border-gray-500">
            <div class="flex justify-between items-center cursor-pointer" onclick="focusMapEntity('Incident', ${inc.id})">
                <span class="text-xs font-mono font-bold text-gray-500 dark:text-gray-400">#INC-${inc.id}</span>
                <div class="flex items-center gap-2">
                    <span class="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase bg-gray-200 dark:bg-gray-800 ${sColor}">${isQueued ? 'WAITING' : inc.status}</span>
                    ${inc.assigned_ambulance_id ? `<i class="fa-solid fa-eye text-gray-400 hover:text-white" onclick="toggleRoute(${inc.id}, event)"></i>` : ''}
                </div>
            </div>
            ${inc.status === 'pending' ? `<div class="h-0.5 bg-gray-200 dark:bg-gray-800 mt-1"><div class="h-full bg-warning transition-all duration-[10000ms] w-full" style="width:0%"></div></div>` : ''}
        </div>`;
    }).join('');
}

function renderAmbulances() {
    const list = document.getElementById('ambulancesPanelList') || document.getElementById('ambBody');
    if(!list) return;
    list.innerHTML = Object.values(rawData.ambulances).map(a => {
        let baseColor = a.status === 'available' ? 'bg-success' : a.status === 'offline' ? 'bg-gray-500' : 'bg-red-500';
        return `
        <div onclick="focusMapEntity('Ambulance', ${a.id})" class="flex items-center gap-3 p-2 border-b border-gray-100 dark:border-white/5 cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5">
            <div class="relative w-8 h-8 rounded-full ${baseColor} flex items-center justify-center text-white shadow-sm flex-shrink-0">
                <i class="fa-solid fa-truck-medical text-[10px]"></i><span class="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-white dark:border-gray-900" style="background-color: ${a.routeColor}"></span>
            </div>
            <div class="flex-1 overflow-hidden"><div class="text-xs font-bold text-gray-800 dark:text-white truncate">${a.code}</div><div class="text-[9px] text-gray-500 uppercase truncate">${a.status.replace('_', ' ')}</div></div>
        </div>`;
    }).join('');
}

function setupDeviceSearch() {
    document.getElementById('deviceSearchInputMap')?.addEventListener('keyup', (e) => {
        const val = e.target.value.toLowerCase();
        renderDevices(Object.values(rawData.devices).filter(d => d.device_uid.toLowerCase().includes(val) || (d.users && d.users.name.toLowerCase().includes(val))));
    });
}

function renderDevices(devicesList) {
    const list = document.getElementById('devicesPanelList'); if(!list) return;
    list.innerHTML = devicesList.map(d => `
        <div onclick="focusMapEntity('Device', ${d.id})" class="bg-gray-50 dark:bg-white/5 border border-transparent dark:border-white/10 rounded-lg p-2 cursor-pointer hover:border-blue-500">
            <div class="flex justify-between items-center"><span class="font-bold text-xs text-blue-500">${d.users?.name || 'Unknown'}</span><span class="text-[10px] text-gray-500">${d.car_plate || ''}</span></div>
            <div class="text-[10px] text-gray-400 mt-1">${d.device_uid}</div>
        </div>`).join('');
}