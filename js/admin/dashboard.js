import { supabase, DB_TABLES } from '../config/supabase.js';

let adminMap;
let markers = { hospitals: {}, ambulances: {}, incidents: {}, devices: {} };
let rawData = { hospitals: {}, ambulances: {}, incidents: {}, devices: {} };
let routes = {}; 

export async function initDashboard() {
    if(!adminMap) setupMap();
    await loadEntities();
    await loadAndRoamDevices(); 
    startPatrolsAndQueues(); 
    setupRealtime();
}

function setupMap() {
    adminMap = L.map('adminMap', { zoomControl: false }).setView([30.0444, 31.2357], 12);
    L.control.zoom({ position: 'bottomright' }).addTo(adminMap);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(adminMap);
}

const icons = {
    hospital: L.divIcon({ html: '<div class="w-8 h-8 bg-blue-500 rounded-full border-2 border-white flex items-center justify-center text-white shadow-lg"><i class="fa-solid fa-hospital"></i></div>', className: ''}),
    ambulance_available: L.divIcon({ html: '<div class="w-8 h-8 bg-success rounded-full border-2 border-white flex items-center justify-center text-white shadow-lg"><i class="fa-solid fa-truck-medical"></i></div>', className: ''}),
    ambulance_busy: L.divIcon({ html: '<div class="w-8 h-8 bg-red-500 rounded-full border-2 border-white flex items-center justify-center text-white shadow-lg"><i class="fa-solid fa-truck-medical"></i></div>', className: ''}),
    incident_pending: L.divIcon({ html: '<div class="leaflet-incident-marker w-10 h-10"></div><div class="absolute inset-0 flex items-center justify-center text-xl">💥</div>', className: ''}),
    incident_confirmed: L.divIcon({ html: '<div class="w-8 h-8 bg-red-600 rounded-full border-2 border-white flex items-center justify-center text-white shadow-lg"><i class="fa-solid fa-triangle-exclamation"></i></div>', className: ''}),
    car: L.divIcon({ html: '<div class="text-2xl drop-shadow-md">🚙</div>', className: ''})
};

// ==========================================
// تعريف دالة التركيز العام (متاحة للـ HTML)
// ==========================================
window.focusMapEntity = function(type, id) {
    const data = type === 'Incident' ? rawData.incidents[id] : rawData.ambulances[id];
    if (data) openPanel(type, data);
}

// ==========================================
// 1. تحميل وتحديث البيانات
// ==========================================
async function loadEntities() {
    const { data: hData } = await supabase.from(DB_TABLES.HOSPITALS).select('*');
    hData?.forEach(h => {
        rawData.hospitals[h.id] = h;
        if(!markers.hospitals[h.id]) {
            markers.hospitals[h.id] = L.marker([h.lat, h.lng], {icon: icons.hospital}).addTo(adminMap);
            markers.hospitals[h.id].on('click', () => openPanel('Hospital', h));
        }
    });

    const { data: aData } = await supabase.from(DB_TABLES.AMBULANCES).select('*');
    rawData.ambulances = {}; // Refresh
    aData?.forEach(a => {
        rawData.ambulances[a.id] = a;
        let icon = a.status === 'available' ? icons.ambulance_available : icons.ambulance_busy;
        if(!markers.ambulances[a.id]) {
            markers.ambulances[a.id] = L.marker([a.lat, a.lng], {icon: icon}).addTo(adminMap);
            markers.ambulances[a.id].on('click', () => openPanel('Ambulance', a));
        } else {
            markers.ambulances[a.id].setLatLng([a.lat, a.lng]).setIcon(icon);
        }
    });
    renderAmbulances();

    const { data: iData } = await supabase.from(DB_TABLES.INCIDENTS).select('*, devices(device_uid, car_model, car_plate)').not('status', 'in', '("completed","canceled")').order('created_at', { ascending: false });
    rawData.incidents = {}; // Refresh
    iData?.forEach(i => {
        rawData.incidents[i.id] = i;
        handleIncidentVisuals(i);
    });
    renderIncidents();
}

// ==========================================
// 2. الكروت الجانبية والتفاعل
// ==========================================
function openPanel(type, data) {
    const panel = document.getElementById('detailsPanel');
    const title = document.getElementById('panelTitle');
    const content = document.getElementById('panelContent');
    
    panel.classList.remove('translate-x-[120%]');
    title.innerHTML = `<span class="${type==='Incident'?'text-primary':type==='Ambulance'?'text-success':'text-blue-500'}">${type} Details</span>`;
    
    if (type === 'Incident') {
        if(adminMap) adminMap.flyTo([data.latitude, data.longitude], 16, {animate:true, duration: 1.5});
        content.innerHTML = `
            <div class="flex justify-between border-b dark:border-gray-700 pb-2"><span class="font-bold">ID:</span> <span class="font-mono">#INC-${data.id}</span></div>
            <div class="flex justify-between border-b dark:border-gray-700 pb-2"><span class="font-bold">Status:</span> <span class="uppercase text-primary font-bold">${data.status}</span></div>
            <div class="flex justify-between border-b dark:border-gray-700 pb-2"><span class="font-bold">G-Force:</span> <span>${data.g_force}</span></div>
            <div class="flex justify-between border-b dark:border-gray-700 pb-2"><span class="font-bold">Device:</span> <span class="font-mono text-xs">${data.devices?.device_uid || 'N/A'}</span></div>
            <div class="flex justify-between"><span class="font-bold">Vehicle:</span> <span class="text-xs text-right">${data.devices?.car_model || 'N/A'} <br>(${data.devices?.car_plate || ''})</span></div>
        `;
    } 
    else if (type === 'Ambulance') {
        if(adminMap) adminMap.flyTo([data.lat, data.lng], 16, {animate:true, duration: 1.5});
        content.innerHTML = `
            <div class="flex justify-between border-b dark:border-gray-700 pb-2"><span class="font-bold">Code:</span> <span class="font-mono">${data.code}</span></div>
            <div class="flex justify-between border-b dark:border-gray-700 pb-2"><span class="font-bold">Status:</span> <span class="uppercase font-bold ${data.status==='available'?'text-success':'text-warning'}">${data.status.replace('_', ' ')}</span></div>
        `;
    }
    else if (type === 'Hospital') {
        if(adminMap) adminMap.flyTo([data.lat, data.lng], 16, {animate:true, duration: 1.5});
        content.innerHTML = `
            <div class="flex justify-between border-b dark:border-gray-700 pb-2"><span class="font-bold">Name:</span> <span>${data.name}</span></div>
            <div class="flex justify-between"><span class="font-bold">Available Beds:</span> <span class="text-xl font-black ${data.available_beds > 0 ? 'text-success':'text-primary'}">${data.available_beds}</span></div>
        `;
    }
}

// ==========================================
// 3. المحاكاة (Roam, Sweep, Discharge)
// ==========================================
async function loadAndRoamDevices() {
    const { data: devices } = await supabase.from(DB_TABLES.DEVICES).select('*');
    devices?.forEach(d => {
        // حصر السيارات داخل نطاق ضيق لتجنب النيل والصحراء (وسط القاهرة تقريباً)
        let lat = 30.0444 + (Math.random() - 0.5) * 0.05;
        let lng = 31.2357 + (Math.random() - 0.5) * 0.05;
        rawData.devices[d.id] = { ...d, lat, lng };
        markers.devices[d.id] = L.marker([lat, lng], {icon: icons.car}).addTo(adminMap);
    });
}

function startPatrolsAndQueues() {
    // حركة السيارات والإسعاف المتاح
    setInterval(() => {
        Object.values(rawData.devices).forEach(dev => {
            const hasIncident = Object.values(rawData.incidents).some(inc => inc.device_id === dev.id);
            if (!hasIncident && markers.devices[dev.id]) {
                dev.lat += (Math.random() - 0.5) * 0.002; // حركة بطيئة جدا
                dev.lng += (Math.random() - 0.5) * 0.002;
                markers.devices[dev.id].setLatLng([dev.lat, dev.lng]);
            } else if (hasIncident && markers.devices[dev.id]) {
                adminMap.removeLayer(markers.devices[dev.id]);
                delete markers.devices[dev.id];
            }
        });

        Object.values(rawData.ambulances).forEach(amb => {
            if (amb.status === 'available' && markers.ambulances[amb.id]) {
                amb.lat += (Math.random() - 0.5) * 0.003;
                amb.lng += (Math.random() - 0.5) * 0.003;
                markers.ambulances[amb.id].setLatLng([amb.lat, amb.lng]);
            }
        });
    }, 4000);

    // تفريغ المستشفيات
    setInterval(async () => {
        const fullHospitals = Object.values(rawData.hospitals).filter(h => h.available_beds < 15); 
        if (fullHospitals.length > 0) {
            let h = fullHospitals[Math.floor(Math.random() * fullHospitals.length)];
            await supabase.from(DB_TABLES.HOSPITALS).update({ available_beds: h.available_beds + 1 }).eq('id', h.id);
            console.log(`[Sim] Bed freed at ${h.name}`);
        }
    }, 45000);

    // Kicker (Sweeper) القوي: يمر كل 8 ثواني للتأكد من عدم تعليق أي حادث
    setInterval(() => {
        processSystemQueues();
    }, 8000);
}

// ==========================================
// 4. التوجيه (Dispatch)
// ==========================================
function setupRealtime() {
    supabase.channel('admin_auto_dispatch')
        .on('postgres_changes', { event: '*', schema: 'public', table: DB_TABLES.INCIDENTS }, async payload => {
            await loadEntities();
            if(payload.eventType === 'INSERT') {
                const inc = rawData.incidents[payload.new.id];
                if(inc && adminMap) adminMap.flyTo([inc.latitude, inc.longitude], 15, { animate: true });
                setTimeout(() => attemptDispatch(inc), 10000); // 10s Timer
            }
        }).subscribe();
}

async function attemptDispatch(incident) {
    // التأكد من جلب أحدث داتا لتجنب الدبلجة
    const { data: currentInc } = await supabase.from(DB_TABLES.INCIDENTS).select('*').eq('id', incident.id).single();
    if (!currentInc || currentInc.status !== 'pending' && currentInc.status !== 'confirmed') return;

    if (currentInc.status === 'pending') {
        await supabase.from(DB_TABLES.INCIDENTS).update({ status: 'confirmed', confirmed_at: new Date() }).eq('id', currentInc.id);
        await supabase.from('incident_logs').insert([{ incident_id: currentInc.id, action: 'confirmed', performed_by: 'system' }]);
        currentInc.status = 'confirmed';
    }

    const availableAmbs = Object.values(rawData.ambulances).filter(a => a.status === 'available');
    if (availableAmbs.length === 0) {
        console.log(`Incident #${currentInc.id} QUEUED: No Ambulances.`);
        return await loadEntities(); 
    }

    const availableHosps = Object.values(rawData.hospitals).filter(h => h.available_beds > 0);
    if (availableHosps.length === 0) {
        console.log(`Incident #${currentInc.id} QUEUED: No Hospital Beds!`);
        return await loadEntities(); 
    }

    let nearestAmb = availableAmbs.reduce((prev, curr) => 
        getHaversineDistance(currentInc.latitude, currentInc.longitude, curr.lat, curr.lng) < getHaversineDistance(currentInc.latitude, currentInc.longitude, prev.lat, prev.lng) ? curr : prev
    );

    let nearestHosp = availableHosps.reduce((prev, curr) => 
        getHaversineDistance(currentInc.latitude, currentInc.longitude, curr.lat, curr.lng) < getHaversineDistance(currentInc.latitude, currentInc.longitude, prev.lat, prev.lng) ? curr : prev
    );

    // حجز مزدوج (إسعاف وسرير) لتجنب التضارب
    await Promise.all([
        supabase.from(DB_TABLES.HOSPITALS).update({ available_beds: nearestHosp.available_beds - 1 }).eq('id', nearestHosp.id),
        supabase.from(DB_TABLES.AMBULANCES).update({ status: 'en_route_incident' }).eq('id', nearestAmb.id),
        supabase.from(DB_TABLES.INCIDENTS).update({ status: 'assigned', assigned_ambulance_id: nearestAmb.id, assigned_hospital_id: nearestHosp.id }).eq('id', currentInc.id),
        supabase.from('incident_logs').insert([{ incident_id: currentInc.id, action: 'assigned_ambulance', performed_by: 'system', note: `Assigned ${nearestAmb.code} to ${nearestHosp.name}` }])
    ]);
    
    await loadEntities();
    startRouteSimulation(nearestAmb, currentInc, nearestHosp);
}

async function processSystemQueues() {
    await loadEntities();
    const queuedIncidents = Object.values(rawData.incidents)
        .filter(inc => inc.status === 'confirmed' && !inc.assigned_ambulance_id)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    if(queuedIncidents.length > 0) {
        console.log(`[Sweeper] Found ${queuedIncidents.length} queued incidents. Attempting dispatch...`);
        for (let inc of queuedIncidents) { await attemptDispatch(inc); }
    }
}

// ==========================================
// 5. محاكاة المسار الحقيقي
// ==========================================
async function startRouteSimulation(amb, inc, hosp) {
    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${amb.lng},${amb.lat};${inc.longitude},${inc.latitude};${hosp.lng},${hosp.lat}?geometries=geojson`;
        const response = await fetch(url);
        const data = await response.json();
        
        // لو الـ API فشل بسبب إن النقطة في النيل مثلاً، اعمل مسار وهمي مباشر
        let routeCoords;
        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            routeCoords = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
        } else {
            console.warn("OSRM Route Failed (Off-road). Using direct line fallback.");
            routeCoords = [[amb.lat, amb.lng], [inc.latitude, inc.longitude], [hosp.lat, hosp.lng]];
        }

        if(routes[inc.id] && adminMap) adminMap.removeLayer(routes[inc.id]);
        routes[inc.id] = L.polyline(routeCoords, { color: '#f59e0b', weight: 4, dashArray: '10, 10' }).addTo(adminMap);

        const marker = markers.ambulances[amb.id];
        let indexOfCrash = Math.floor(routeCoords.length / 2);
        
        // التوجه للحادث
        for (let i = 0; i < indexOfCrash; i++) {
            if(marker) marker.setLatLng(routeCoords[i]);
            await new Promise(r => setTimeout(r, 600)); 
        }
        
        await supabase.from(DB_TABLES.INCIDENTS).update({ status: 'in_progress' }).eq('id', inc.id);
        await supabase.from(DB_TABLES.AMBULANCES).update({ status: 'en_route_hospital' }).eq('id', amb.id);
        if(markers.incidents[inc.id] && adminMap) adminMap.removeLayer(markers.incidents[inc.id]); 

        // التوجه للمستشفى
        for (let i = indexOfCrash; i < routeCoords.length; i++) {
            if(marker) marker.setLatLng(routeCoords[i]);
            await new Promise(r => setTimeout(r, 600));
        }

        finishSimulation(amb, inc);
    } catch (e) { console.error("Routing Error:", e); finishSimulation(amb, inc); }
}

async function finishSimulation(amb, inc) {
    if(routes[inc.id] && adminMap) adminMap.removeLayer(routes[inc.id]); 
    await supabase.from(DB_TABLES.AMBULANCES).update({ status: 'available', lat: amb.lat, lng: amb.lng }).eq('id', amb.id); // إعادة التمركز لحل مشاكل الروتينج
    await supabase.from(DB_TABLES.INCIDENTS).update({ status: 'completed', resolved_at: new Date() }).eq('id', inc.id);
    
    await loadEntities();
    processSystemQueues(); 
}

// Helpers & UI
function getHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; const dLat = (lat2 - lat1) * Math.PI / 180; const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function handleIncidentVisuals(inc) {
    let icon = inc.status === 'pending' ? icons.incident_pending : icons.incident_confirmed;
    if(!markers.incidents[inc.id]) {
        markers.incidents[inc.id] = L.marker([inc.latitude, inc.longitude], {icon: icon}).addTo(adminMap);
        markers.incidents[inc.id].on('click', () => openPanel('Incident', inc));
    } else {
        markers.incidents[inc.id].setIcon(icon);
    }
}

window.toggleIncidentDetails = function(id) {
    const detailsDiv = document.getElementById(`inc-details-${id}`);
    const icon = document.getElementById(`inc-icon-${id}`);
    if (detailsDiv.classList.contains('hidden')) {
        detailsDiv.classList.remove('hidden');
        icon.classList.replace('fa-chevron-down', 'fa-chevron-up');
        window.focusMapEntity('Incident', id);
    } else {
        detailsDiv.classList.add('hidden');
        icon.classList.replace('fa-chevron-up', 'fa-chevron-down');
    }
}

function renderIncidents() {
    const list = document.getElementById('incidentsPanelList');
    const incidents = Object.values(rawData.incidents).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    document.getElementById('pendingCountBadge').innerText = `${incidents.filter(i=>i.status==='pending').length} Pending`;
    
    list.innerHTML = incidents.map(inc => {
        let isQueued = (inc.status === 'confirmed' && !inc.assigned_ambulance_id);
        let statusColor = inc.status === 'pending' ? 'text-warning bg-warning/20' : 
                          isQueued ? 'text-primary bg-primary/20' : 
                          inc.status === 'in_progress' ? 'text-purple-500 bg-purple-500/20' : 'text-info bg-info/20';
        let displayStatus = isQueued ? 'WAITING RESOURCES' : inc.status.replace('_', ' ');

        let s1 = inc.status !== 'pending' ? 'text-success' : 'text-gray-400';
        let s2 = inc.assigned_ambulance_id ? 'text-success' : 'text-gray-400';
        let s3 = inc.status === 'in_progress' ? 'text-success' : 'text-gray-400';

        return `
        <div class="bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden transition-colors mb-3">
            <div class="p-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-white/10 flex justify-between items-center" onclick="toggleIncidentDetails(${inc.id})">
                <div>
                    <span class="text-xs font-mono font-bold ${isQueued ? 'text-primary' : 'text-gray-500'}">#INC-${inc.id}</span>
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded uppercase ${statusColor} ml-2">${displayStatus}</span>
                </div>
                <i id="inc-icon-${inc.id}" class="fa-solid fa-chevron-down text-gray-400 text-xs"></i>
            </div>
            ${inc.status === 'pending' ? `<div class="h-1 bg-gray-200 dark:bg-gray-800 w-full"><div class="h-full bg-warning transition-all duration-[10000ms] ease-linear" style="width:100%"></div></div>` : ''}
            
            <div id="inc-details-${inc.id}" class="hidden p-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/50">
                <div class="grid grid-cols-2 gap-2 text-xs mb-3 text-gray-600 dark:text-gray-300">
                    <div><span class="font-bold">G-Force:</span> ${inc.g_force}</div>
                    <div class="col-span-2"><span class="font-bold">Car:</span> ${inc.devices?.car_model || 'Unknown'} (${inc.devices?.car_plate || ''})</div>
                </div>
                <div class="flex items-center justify-between text-[10px] font-bold uppercase mt-2 border-t border-gray-200 dark:border-gray-700 pt-3">
                    <div class="flex flex-col items-center ${s1}"><i class="fa-solid fa-check-circle mb-1 text-sm"></i> Confirmed</div>
                    <div class="flex-1 h-[1px] bg-gray-300 dark:bg-gray-700 mx-2"></div>
                    <div class="flex flex-col items-center ${s2}"><i class="fa-solid fa-truck-medical mb-1 text-sm"></i> Dispatched</div>
                    <div class="flex-1 h-[1px] bg-gray-300 dark:bg-gray-700 mx-2"></div>
                    <div class="flex flex-col items-center ${s3}"><i class="fa-solid fa-hospital mb-1 text-sm"></i> Hospital</div>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

function renderAmbulances() {
    const list = document.getElementById('ambulancesPanelList');
    list.innerHTML = Object.values(rawData.ambulances).map(a => `
        <div onclick="window.focusMapEntity('Ambulance', ${a.id})" class="flex items-center gap-3 p-2 border-b dark:border-white/5 cursor-pointer hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
            <div class="w-8 h-8 rounded-full ${a.status==='available'?'bg-success/20 text-success': a.status==='offline'?'bg-gray-500/20 text-gray-500':'bg-red-500/20 text-red-500'} flex items-center justify-center"><i class="fa-solid fa-truck-medical"></i></div>
            <div class="flex-1"><h5 class="text-xs font-bold dark:text-white">${a.code}</h5><span class="text-[10px] text-gray-500 uppercase font-bold">${a.status.replace('_', ' ')}</span></div>
        </div>
    `).join('');
}