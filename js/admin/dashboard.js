import { supabase, DB_TABLES } from '../config/supabase.js';

let adminMap;
let markers = { hospitals: {}, ambulances: {}, incidents: {}, devices: {} };
let rawData = { hospitals: {}, ambulances: {}, incidents: {}, devices: {} };
let routes = {}; 
let patrolRoutes = {}; 

// ألوان مميزة للمسارات فقط (Routes)
const ROUTE_COLORS = ['#3b82f6', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4', '#14b8a6'];

const FIXED_ZONES = [
    { lat: 30.0444, lng: 31.2357 }, 
    { lat: 30.0600, lng: 31.3300 }, 
    { lat: 29.9600, lng: 31.2500 }, 
    { lat: 30.0500, lng: 31.1800 }  
];

export async function initDashboard() {
    setupMap();
    await loadEntities();
    await loadDevices();
    startPatrolsAndQueues();
    setupRealtime();
    setupDeviceSearch();
}

function setupMap() {
    adminMap = L.map('adminMap', { zoomControl: false }).setView([30.0444, 31.2357], 12);
    L.control.zoom({ position: 'bottomright' }).addTo(adminMap);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(adminMap);
    window.addEventListener('resize', () => { if(adminMap) adminMap.invalidateSize(); });
}

// 🔥 دالة ذكية تصنع إسعاف موحد اللون، مع نقطة صغيرة تمثل لون مساره
function getAmbIcon(routeColor, status) {
    // لون موحد: أخضر للمتاح، رمادي للمغلق، أحمر للمشغول
    let baseColor = status === 'available' ? '#10b981' : status === 'offline' ? '#6b7280' : '#dc2626';
    return L.divIcon({
        html: `<div style="background-color: ${baseColor}" class="relative w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-white shadow-[0_0_10px_rgba(0,0,0,0.5)] transition-colors duration-300">
                  <i class="fa-solid fa-truck-medical text-xs"></i>
                  <span class="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-gray-900 shadow-sm" style="background-color: ${routeColor}"></span>
               </div>`,
        className: ''
    });
}

const hospitalIcon = L.divIcon({ html: '<div class="w-8 h-8 bg-gray-800 rounded-full border-2 border-blue-500 flex items-center justify-center text-blue-400 shadow-lg"><i class="fa-solid fa-hospital text-xs"></i></div>', className: ''});
const incidentIcon = L.divIcon({ html: '<div class="leaflet-incident-marker w-8 h-8"></div><div class="absolute inset-0 flex items-center justify-center text-lg">💥</div>', className: ''});
const carIcon = L.divIcon({ html: '<div class="w-8 h-8 bg-white dark:bg-gray-800 rounded-full border-2 border-gray-400 dark:border-gray-600 flex items-center justify-center shadow-lg transition-transform hover:scale-110"><i class="fa-solid fa-car-side text-gray-700 dark:text-gray-300 text-[12px]"></i></div>', className: ''});

// ==========================================
// 1. تحميل البيانات
// ==========================================
async function loadEntities() {
    const { data: hData } = await supabase.from(DB_TABLES.HOSPITALS).select('*');
    hData?.forEach(h => {
        rawData.hospitals[h.id] = h;
        if(!markers.hospitals[h.id]) {
            markers.hospitals[h.id] = L.marker([h.lat, h.lng], {icon: hospitalIcon}).addTo(adminMap);
            markers.hospitals[h.id].on('click', () => openPanel('Hospital', h));
        }
    });

    const { data: aData } = await supabase.from(DB_TABLES.AMBULANCES).select('*');
    aData?.forEach((a, index) => {
        a.routeColor = ROUTE_COLORS[index % ROUTE_COLORS.length]; // تعيين لون مسار ثابت
        
        let zone = FIXED_ZONES[index % FIXED_ZONES.length];
        a.baseLat = zone.lat;
        a.baseLng = zone.lng;

        rawData.ambulances[a.id] = a;
        if(!markers.ambulances[a.id]) {
            markers.ambulances[a.id] = L.marker([a.lat, a.lng], {icon: getAmbIcon(a.routeColor, a.status)}).addTo(adminMap);
            markers.ambulances[a.id].on('click', () => openPanel('Ambulance', a));
        } else {
            markers.ambulances[a.id].setLatLng([a.lat, a.lng]).setIcon(getAmbIcon(a.routeColor, a.status));
        }
    });
    renderAmbulances();

    const { data: iData } = await supabase.from(DB_TABLES.INCIDENTS).select('*, devices(device_uid, car_model, car_plate)').not('status', 'in', '("completed","canceled")');
    rawData.incidents = {};
    iData?.forEach(i => {
        rawData.incidents[i.id] = i;
        handleIncidentVisuals(i); // الاعتماد على الدالة لمنع ظهور in_progress
    });
    renderIncidents();
}

async function loadDevices() {
    const { data: dData } = await supabase.from(DB_TABLES.DEVICES).select('*, users(name, phone)');
    dData?.forEach((d, index) => {
        let lat = 30.04 + (Math.random() - 0.5) * 0.1;
        let lng = 31.23 + (Math.random() - 0.5) * 0.1;
        rawData.devices[d.id] = { ...d, lat, lng };
        markers.devices[d.id] = L.marker([lat, lng], {icon: carIcon}).addTo(adminMap);
        markers.devices[d.id].on('click', () => openPanel('Device', rawData.devices[d.id]));
    });
    renderDevices(Object.values(rawData.devices));
}

// ==========================================
// 2. الواجهة
// ==========================================
window.focusMapEntity = function(type, id) {
    let data = type === 'Incident' ? rawData.incidents[id] : type === 'Ambulance' ? rawData.ambulances[id] : rawData.devices[id];
    if (data) openPanel(type, data);
}

window.toggleRoute = function(incId, e) {
    e.stopPropagation();
    if(routes[incId]) {
        if(adminMap.hasLayer(routes[incId])) adminMap.removeLayer(routes[incId]);
        else adminMap.addLayer(routes[incId]);
    }
}

function openPanel(type, data) {
    const panel = document.getElementById('detailsPanel');
    panel.classList.remove('translate-x-[120%]');
    document.getElementById('panelTitle').innerHTML = `<span class="${type==='Incident'?'text-primary':type==='Ambulance'?'text-success':type==='Device'?'text-blue-500':'text-gray-200'}">${type} Info</span>`;
    
    if (type === 'Incident') {
        adminMap.flyTo([data.latitude, data.longitude], 15, {animate:true});
        document.getElementById('panelContent').innerHTML = `
            <div class="flex justify-between border-b dark:border-white/10 pb-2"><span>Status</span><span class="text-primary font-bold uppercase">${data.status}</span></div>
            <div class="flex justify-between border-b dark:border-white/10 pb-2"><span>G-Force</span><span>${data.g_force}</span></div>
            <div class="flex justify-between text-xs text-gray-400 mt-2"><span>${data.devices?.car_model || ''}</span><span>${data.devices?.device_uid}</span></div>
        `;
    } else if (type === 'Ambulance') {
        adminMap.flyTo([data.lat, data.lng], 15, {animate:true});
        document.getElementById('panelContent').innerHTML = `
            <div class="flex justify-between border-b dark:border-white/10 pb-2"><span>Unit Code</span><span class="font-bold text-white">${data.code}</span></div>
            <div class="flex justify-between"><span>Status</span><span class="uppercase font-bold ${data.status==='available'?'text-success':'text-red-500'}">${data.status.replace('_', ' ')}</span></div>
        `;
    } else if (type === 'Hospital') {
        adminMap.flyTo([data.lat, data.lng], 15, {animate:true});
        document.getElementById('panelContent').innerHTML = `
            <div class="flex justify-between border-b dark:border-white/10 pb-2 font-bold text-gray-800 dark:text-white"><span>${data.name}</span></div>
            <div class="flex justify-between"><span>Available Beds</span><span class="text-xl font-black text-blue-400">${data.available_beds}</span></div>
        `;
    } else if (type === 'Device') {
        adminMap.flyTo([data.lat, data.lng], 16, {animate:true});
        document.getElementById('panelContent').innerHTML = `
            <div class="flex justify-between border-b dark:border-white/10 pb-2"><span>Owner</span><span class="font-bold text-gray-800 dark:text-white">${data.users?.name || 'N/A'}</span></div>
            <div class="flex justify-between border-b dark:border-white/10 pb-2"><span>Phone</span><span class="font-mono text-gray-600 dark:text-gray-300">${data.users?.phone || 'N/A'}</span></div>
            <div class="flex justify-between text-xs mt-2"><span>${data.car_model || ''}</span><span class="text-gray-500">${data.car_plate || ''}</span></div>
            <div class="text-center mt-3 text-[10px] text-gray-400 font-mono">${data.device_uid}</div>
        `;
    }
}

function setupDeviceSearch() {
    document.getElementById('deviceSearchInput').addEventListener('keyup', (e) => {
        const val = e.target.value.toLowerCase();
        const filtered = Object.values(rawData.devices).filter(d => 
            d.device_uid.toLowerCase().includes(val) || (d.users && d.users.name.toLowerCase().includes(val))
        );
        renderDevices(filtered);
    });
}

function renderDevices(devicesList) {
    const list = document.getElementById('devicesPanelList');
    list.innerHTML = devicesList.map(d => `
        <div onclick="focusMapEntity('Device', ${d.id})" class="bg-gray-50 dark:bg-white/5 border border-transparent dark:border-white/10 rounded-lg p-2 cursor-pointer hover:border-blue-500 transition-colors">
            <div class="flex justify-between items-center"><span class="font-bold text-xs text-blue-500 dark:text-blue-400">${d.users?.name || 'Unknown'}</span><span class="text-[10px] text-gray-500">${d.car_plate || ''}</span></div>
            <div class="text-[10px] text-gray-400 mt-1">${d.device_uid}</div>
        </div>
    `).join('');
}

// ==========================================
// 3. الدوريات وحماية التكدس
// ==========================================
async function startPatrolsAndQueues() {
    setInterval(() => {
        Object.values(rawData.ambulances).forEach(async amb => {
            if (amb.status === 'available' && !patrolRoutes[amb.id]) {
                let targetLat = amb.baseLat + (Math.random() - 0.5) * 0.04;
                let targetLng = amb.baseLng + (Math.random() - 0.5) * 0.04;
                try {
                    const url = `https://router.project-osrm.org/route/v1/driving/${amb.lng},${amb.lat};${targetLng},${targetLat}?geometries=geojson`;
                    const res = await fetch(url);
                    const data = await res.json();
                    if(data.code === 'Ok' && data.routes[0].geometry.coordinates.length > 0) {
                        patrolRoutes[amb.id] = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
                        moveAlongPatrol(amb);
                    } else {
                        amb.lat = amb.baseLat; amb.lng = amb.baseLng;
                        if(markers.ambulances[amb.id]) markers.ambulances[amb.id].setLatLng([amb.lat, amb.lng]);
                    }
                } catch(e) { } 
            }
        });

        Object.values(rawData.devices).forEach(dev => {
            const hasInc = Object.values(rawData.incidents).some(i => i.device_id === dev.id);
            if (!hasInc && markers.devices[dev.id]) {
                dev.lat += (Math.random() - 0.5) * 0.001;
                dev.lng += (Math.random() - 0.5) * 0.001;
                markers.devices[dev.id].setLatLng([dev.lat, dev.lng]);
            }
        });
    }, 5000);

    setInterval(processSystemQueues, 8000);
}

async function moveAlongPatrol(amb) {
    if(!patrolRoutes[amb.id] || amb.status !== 'available') return;
    const path = patrolRoutes[amb.id];
    for(let i=0; i<path.length; i++) {
        if(amb.status !== 'available') break; 
        amb.lat = path[i][0];
        amb.lng = path[i][1];
        if(markers.ambulances[amb.id]) markers.ambulances[amb.id].setLatLng(path[i]);
        await new Promise(r => setTimeout(r, 200)); 
    }
    patrolRoutes[amb.id] = null; 
}

// ==========================================
// 4. التوجيه (Dispatch)
// ==========================================
function setupRealtime() {
    supabase.channel('dispatch_chan')
        .on('postgres_changes', { event: '*', schema: 'public', table: DB_TABLES.INCIDENTS }, async p => {
            await loadEntities();
            if(p.eventType === 'INSERT') {
                const inc = rawData.incidents[p.new.id];
                if(inc) adminMap.flyTo([inc.latitude, inc.longitude], 15);
                setTimeout(() => attemptDispatch(inc), 10000);
            }
        }).subscribe();
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

    let nearestAmb = availableAmbs.reduce((p, c) => getDist(currInc.latitude, currInc.longitude, c.lat, c.lng) < getDist(currInc.latitude, currInc.longitude, p.lat, p.lng) ? c : p);
    let nearestHosp = availableHosps.reduce((p, c) => getDist(currInc.latitude, currInc.longitude, c.lat, c.lng) < getDist(currInc.latitude, currInc.longitude, p.lat, p.lng) ? c : p);

    patrolRoutes[nearestAmb.id] = null;

    await Promise.all([
        supabase.from(DB_TABLES.HOSPITALS).update({ available_beds: nearestHosp.available_beds - 1 }).eq('id', nearestHosp.id),
        supabase.from(DB_TABLES.AMBULANCES).update({ status: 'en_route_incident' }).eq('id', nearestAmb.id),
        supabase.from(DB_TABLES.INCIDENTS).update({ status: 'assigned', assigned_ambulance_id: nearestAmb.id, assigned_hospital_id: nearestHosp.id }).eq('id', currInc.id)
    ]);
    
    await loadEntities();
    startRouteSimulation(nearestAmb, currInc, nearestHosp);
}

async function processSystemQueues() {
    await loadEntities();
    const queued = Object.values(rawData.incidents).filter(i => i.status === 'confirmed' && !i.assigned_ambulance_id);
    for (let inc of queued) await attemptDispatch(inc);
}

// ==========================================
// 5. محاكاة المسار وإخفاء الحادث
// ==========================================
async function startRouteSimulation(amb, inc, hosp) {
    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${amb.lng},${amb.lat};${inc.longitude},${inc.latitude};${hosp.lng},${hosp.lat}?geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();
        
        let routeCoords = data.code === 'Ok' ? data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]) : [[amb.lat, amb.lng], [inc.latitude, inc.longitude], [hosp.lat, hosp.lng]];

        if(routes[inc.id]) adminMap.removeLayer(routes[inc.id]);
        
        // رسم المسار باستخدام اللون المخصص للمسار (routeColor)
        routes[inc.id] = L.polyline(routeCoords, { color: amb.routeColor, weight: 5, dashArray: '10, 10' }).addTo(adminMap);

        const marker = markers.ambulances[amb.id];
        let midPoint = Math.floor(routeCoords.length / 2);
        
        // التوجه للحادث
        for (let i = 0; i < midPoint; i++) {
            if(marker) marker.setLatLng(routeCoords[i]);
            await new Promise(r => setTimeout(r, 100)); 
        }
        
        await supabase.from(DB_TABLES.INCIDENTS).update({ status: 'in_progress' }).eq('id', inc.id);
        await supabase.from(DB_TABLES.AMBULANCES).update({ status: 'en_route_hospital' }).eq('id', amb.id);
        
        // 🔥 تأكيد مسح الحادثة فور وصول الإسعاف
        if(markers.incidents[inc.id]) {
            adminMap.removeLayer(markers.incidents[inc.id]);
            delete markers.incidents[inc.id]; 
        }

        // التوجه للمستشفى
        for (let i = midPoint; i < routeCoords.length; i++) {
            if(marker) marker.setLatLng(routeCoords[i]);
            await new Promise(r => setTimeout(r, 100));
        }

        finishSimulation(amb, inc);
    } catch (e) { finishSimulation(amb, inc); }
}

async function finishSimulation(amb, inc) {
    if(routes[inc.id]) { adminMap.removeLayer(routes[inc.id]); delete routes[inc.id]; }
    
    amb.lat = amb.baseLat;
    amb.lng = amb.baseLng;
    
    await supabase.from(DB_TABLES.AMBULANCES).update({ status: 'available', lat: amb.baseLat, lng: amb.baseLng }).eq('id', amb.id); 
    await supabase.from(DB_TABLES.INCIDENTS).update({ status: 'completed', resolved_at: new Date() }).eq('id', inc.id);
    
    await loadEntities();
    processSystemQueues(); 
}

function getDist(lat1, lon1, lat2, lon2) {
    return Math.hypot(lat1 - lat2, lon1 - lon2);
}

// 🔥 دالة ذكية لإدارة ظهور الحوادث ومنعها من الظهور مجدداً إذا كانت in_progress
function handleIncidentVisuals(inc) {
    // لو الحادثة في الطريق للمستشفى أو خلصت، امسحها فوراً ومترسمهاش تاني!
    if (inc.status === 'in_progress' || inc.status === 'completed' || inc.status === 'canceled') {
        if (markers.incidents[inc.id]) {
            if (adminMap) adminMap.removeLayer(markers.incidents[inc.id]);
            delete markers.incidents[inc.id];
        }
        return; 
    }

    let icon = inc.status === 'pending' ? incidentIcon : incidentIcon; // يمكن تغييرها لأيقونة أخرى لاحقاً
    if(!markers.incidents[inc.id]) {
        markers.incidents[inc.id] = L.marker([inc.latitude, inc.longitude], {icon: icon}).addTo(adminMap);
        markers.incidents[inc.id].on('click', () => openPanel('Incident', inc));
    } else {
        markers.incidents[inc.id].setIcon(icon);
        markers.incidents[inc.id].setLatLng([inc.latitude, inc.longitude]);
    }
}

function renderIncidents() {
    const list = document.getElementById('incidentsPanelList') || document.getElementById('incidentsBody');
    if(!list) return;
    const incidents = Object.values(rawData.incidents).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    document.getElementById('pendingCountBadge').innerText = incidents.filter(i=>i.status==='pending').length;
    
    list.innerHTML = incidents.map(inc => {
        let isQueued = (inc.status === 'confirmed' && !inc.assigned_ambulance_id);
        let sColor = inc.status === 'pending' ? 'text-warning' : isQueued ? 'text-primary' : 'text-success';
        return `
        <div class="bg-gray-50 dark:bg-white/5 border border-transparent dark:border-white/10 rounded-lg p-2 mb-2 transition-colors hover:border-gray-300 dark:hover:border-gray-500">
            <div class="flex justify-between items-center cursor-pointer" onclick="focusMapEntity('Incident', ${inc.id})">
                <span class="text-xs font-mono font-bold text-gray-500 dark:text-gray-400">#INC-${inc.id}</span>
                <div class="flex items-center gap-2">
                    <span class="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase bg-gray-200 dark:bg-gray-800 ${sColor}">${isQueued ? 'WAITING' : inc.status}</span>
                    ${inc.assigned_ambulance_id ? `<i class="fa-solid fa-eye text-gray-400 hover:text-gray-800 dark:hover:text-white" onclick="toggleRoute(${inc.id}, event)" title="Toggle Route"></i>` : ''}
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
        // ألوان الواجهة الجانبية (القائمة)
        let baseColor = a.status === 'available' ? 'bg-success' : a.status === 'offline' ? 'bg-gray-500' : 'bg-red-500';
        return `
        <div onclick="focusMapEntity('Ambulance', ${a.id})" class="flex items-center gap-3 p-2 border-b border-gray-100 dark:border-white/5 cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
            <div class="relative w-8 h-8 rounded-full ${baseColor} flex items-center justify-center text-white shadow-sm">
                <i class="fa-solid fa-truck-medical text-[10px]"></i>
                <span class="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-white dark:border-gray-900" style="background-color: ${a.routeColor}"></span>
            </div>
            <div class="flex-1"><div class="text-xs font-bold text-gray-800 dark:text-white">${a.code}</div><div class="text-[9px] text-gray-500 uppercase">${a.status.replace('_', ' ')}</div></div>
        </div>`;
    }).join('');
}