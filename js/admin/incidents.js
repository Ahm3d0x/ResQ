import { supabase, DB_TABLES } from '../config/supabase.js';
import { t } from '../core/language.js';

const tbody = document.getElementById('incidentsTableBody');
let allIncidents = [];
let filterMap = null, filterCircle = null, filterCenter = null, filterRadiusKm = 5;

// ==========================================
// 1. تحميل وعرض البيانات
// ==========================================
window.loadIncidentsData = async function() {
    if(!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-gray-500"><i class="fa-solid fa-circle-notch fa-spin text-2xl"></i> ${t('loading')}</td></tr>`;

    // جلب الحوادث مع ربط الجداول (Join)
    const { data, error } = await supabase
        .from(DB_TABLES.INCIDENTS)
        .select(`
            *,
            devices(device_uid, car_model, users(name, phone)),
            ambulances(code),
            hospitals(name)
        `)
        .order('created_at', { ascending: false });

    if (error) {
        window.showToast("Error loading incidents.", "error");
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-red-500 font-bold">Failed to load data.</td></tr>`;
        return;
    }

    allIncidents = data || [];
    applyIncFilters();
};

// ==========================================
// 2. الفلترة والبحث
// ==========================================
function applyIncFilters() {
    const term = document.getElementById('incSearchInput')?.value.toLowerCase() || "";
    const statusTerm = document.getElementById('incStatusFilter')?.value || "";

    const filtered = allIncidents.filter(inc => {
        const matchesSearch = inc.id.toString().includes(term) || 
                              inc.devices?.device_uid?.toLowerCase().includes(term) ||
                              inc.devices?.users?.name?.toLowerCase().includes(term);
        
        const matchesStatus = statusTerm === "" || inc.status === statusTerm;
        
        let matchesGeo = true;
        if (filterCenter && inc.latitude && inc.longitude) {
            const dist = L.latLng(filterCenter.lat, filterCenter.lng).distanceTo(L.latLng(inc.latitude, inc.longitude));
            matchesGeo = dist <= (filterRadiusKm * 1000); 
        }

        return matchesSearch && matchesStatus && matchesGeo;
    });

    renderIncidentsTable(filtered);
}

document.getElementById('incSearchInput')?.addEventListener('input', applyIncFilters);
document.getElementById('incStatusFilter')?.addEventListener('change', applyIncFilters);

// ==========================================
// 3. رسم الجدول
// ==========================================
function renderIncidentsTable(data) {
    if(!tbody) return;
    if(data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-gray-500 font-bold">${t('noDataFound')}</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(inc => {
        const timeStr = new Date(inc.created_at).toLocaleString();
        let sColor = inc.status === 'pending' ? 'bg-warning/20 text-warning' : 
                     inc.status === 'completed' ? 'bg-success/20 text-success' : 
                     (inc.status === 'CANCELLED' || inc.status === 'cancelled') ? 'bg-gray-500/20 text-gray-500' : 'bg-primary/20 text-primary';

        return `
        <tr class="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors border-b border-gray-100 dark:border-white/5">
            <td class="p-4 font-mono text-xs font-bold text-gray-800 dark:text-white">#INC-${inc.id}</td>
            <td class="p-4 text-xs text-gray-600 dark:text-gray-300">${timeStr}</td>
            <td class="p-4">
                <div class="text-xs font-bold text-blue-500">${inc.devices?.users?.name || 'Unknown'}</div>
                <div class="text-[10px] text-gray-500 font-mono">${inc.devices?.device_uid || '-'}</div>
            </td>
            <td class="p-4 text-center font-mono font-bold text-red-500">${inc.g_force || '0'}G</td>
            <td class="p-4 text-center">
                <span class="px-2 py-1 text-[9px] font-black uppercase rounded border border-current ${sColor}">${inc.status}</span>
            </td>
            <td class="p-4 text-center">
                <button onclick="viewIncDetails(${inc.id})" class="w-8 h-8 inline-flex items-center justify-center bg-gray-100 dark:bg-gray-800 hover:bg-primary hover:text-white rounded-lg transition-colors shadow-sm"><i class="fa-solid fa-eye text-xs"></i></button>
            </td>
        </tr>`;
    }).join('');
}

// ==========================================
// 4. عرض التقرير التفصيلي 📄
// ==========================================
// متغير لتخزين خريطة المعاينة المصغرة
let miniPreviewMap = null;

window.viewIncDetails = function(id) {
    const inc = allIncidents.find(x => x.id === id); 
    if(!inc) return;

    // تحديد الأيقونة واللون بناءً على الحالة النهائية
    const isResolved = inc.status === 'completed';
    const outcomeText = inc.outcome === 'deceased' ? t('deceased') : t('treated');
    const outcomeColor = inc.outcome === 'deceased' ? 'text-red-600' : 'text-success';

    document.getElementById('viewIncDetailsContent').innerHTML = `
        <div class="space-y-6">
            <div class="relative h-40 w-full rounded-2xl overflow-hidden border border-gray-200 dark:border-white/10 shadow-inner">
                <div id="miniMap" class="h-full w-full bg-gray-100"></div>
                <div class="absolute bottom-2 right-2 bg-white/90 dark:bg-gray-900/90 px-2 py-1 rounded text-[9px] font-bold shadow-sm z-[500]">
                    ${inc.latitude}, ${inc.longitude}
                </div>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div class="p-3 bg-gray-50 dark:bg-white/5 rounded-xl border dark:border-white/5">
                    <span class="text-[10px] text-gray-500 uppercase block">${t('speed')}</span>
                    <span class="font-black text-primary">${inc.speed || '0'} KM/H</span>
                </div>
                <div class="p-3 bg-gray-50 dark:bg-white/5 rounded-xl border dark:border-white/5">
                    <span class="text-[10px] text-gray-500 uppercase block">${t('colGForce')}</span>
                    <span class="font-black text-red-500">${inc.g_force || '0'} G</span>
                </div>
                <div class="p-3 bg-gray-50 dark:bg-white/5 rounded-xl border dark:border-white/5">
                    <span class="text-[10px] text-gray-500 uppercase block">${t('colOwner')}</span>
                    <span class="font-bold dark:text-white truncate block">${inc.devices?.users?.name || 'N/A'}</span>
                </div>
            </div>

            <div class="p-4 bg-gray-50 dark:bg-white/5 rounded-2xl border dark:border-white/5">
                <h4 class="text-xs font-black uppercase text-gray-400 mb-4 flex items-center gap-2">
                    <i class="fa-solid fa-clock-rotate-left"></i> ${t('timeline')}
                </h4>
                <div class="space-y-4 ltr:border-l-2 rtl:border-r-2 border-primary/20 ltr:ml-2 rtl:mr-2 ltr:pl-4 rtl:pr-4 relative">
                    <div class="relative">
                        <span class="absolute ltr:-left-[21px] rtl:-right-[21px] top-0 w-3 h-3 rounded-full bg-primary shadow-[0_0_8px_#dc2626]"></span>
                        <div class="text-xs font-bold dark:text-white">${t('stepCreated')}</div>
                        <div class="text-[10px] text-gray-500 font-mono">${new Date(inc.created_at).toLocaleString()}</div>
                    </div>
                    <div class="relative ${!inc.assigned_ambulance_id ? 'opacity-30' : ''}">
                        <span class="absolute ltr:-left-[21px] rtl:-right-[21px] top-0 w-3 h-3 rounded-full bg-blue-500"></span>
                        <div class="text-xs font-bold dark:text-white">${t('stepAssigned')} (${inc.ambulances?.code || '---'})</div>
                        <div class="text-[10px] text-gray-500 font-mono">${inc.assigned_at ? new Date(inc.assigned_at).toLocaleString() : '---'}</div>
                    </div>
                    <div class="relative ${!inc.assigned_hospital_id ? 'opacity-30' : ''}">
                        <span class="absolute ltr:-left-[21px] rtl:-right-[21px] top-0 w-3 h-3 rounded-full bg-success"></span>
                        <div class="text-xs font-bold dark:text-white">${t('stepHospital')} (${inc.hospitals?.name || '---'})</div>
                        <div class="text-[10px] text-gray-500 font-mono">${inc.hospital_arrival_at ? new Date(inc.hospital_arrival_at).toLocaleString() : '---'}</div>
                    </div>
                    <div class="relative ${!isResolved ? 'opacity-30' : ''}">
                        <span class="absolute ltr:-left-[21px] rtl:-right-[21px] top-0 w-3 h-3 rounded-full bg-gray-800 dark:bg-white"></span>
                        <div class="text-xs font-bold ${outcomeColor}">${t('stepResolved')}: ${isResolved ? outcomeText : '---'}</div>
                        <div class="text-[10px] text-gray-500 font-mono">${inc.resolved_at ? new Date(inc.resolved_at).toLocaleString() : '---'}</div>
                    </div>
                </div>
            </div>

            <div class="flex justify-between items-center text-[11px] text-gray-400 bg-gray-100 dark:bg-gray-800/50 p-2 rounded-lg font-mono">
                <span>Model: ${inc.devices?.car_model || 'Unknown'}</span>
                <span>UID: ${inc.devices?.device_uid}</span>
            </div>
        </div>
    `;

    // إظهار النافذة
    const m = document.getElementById('viewIncDetailsModal');
    m.classList.remove('hidden');
    setTimeout(() => {
        m.classList.remove('opacity-0');
        m.children[0].classList.remove('scale-95');
        
        // تهيئة الخريطة المصغرة بعد ظهور النافذة
        initMiniMap(inc.latitude, inc.longitude);
    }, 10);
};

function initMiniMap(lat, lng) {
    if (miniPreviewMap) {
        miniPreviewMap.remove(); // مسح الخريطة القديمة لتجنب تكرار الـ ID
    }
    miniPreviewMap = L.map('miniMap', { zoomControl: false, attributionControl: false }).setView([lat, lng], 15);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(miniPreviewMap);
    
    // أيقونة الحادث الحمراء النابضة
    const incIcon = L.divIcon({ html: '<div class="leaflet-incident-marker w-6 h-6"></div>', className: ''});
    L.marker([lat, lng], {icon: incIcon}).addTo(miniPreviewMap);
}
// ==========================================
// 5. الفلتر الجغرافي 🗺️
// ==========================================
window.openIncMapFilterModal = function() {
    const m = document.getElementById('incMapFilterModal'); m.classList.remove('hidden');
    setTimeout(() => { m.classList.remove('opacity-0'); m.children[0].classList.remove('scale-95'); }, 10);
    if (!filterMap) {
        filterMap = L.map('incFilterMapArea').setView([30.0444, 31.2357], 11);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(filterMap);
        filterMap.on('click', e => { filterCenter = e.latlng; drawIncCircle(); });
    }
    setTimeout(() => filterMap.invalidateSize(), 250);
};

function drawIncCircle() {
    if (filterCircle) filterMap.removeLayer(filterCircle);
    filterCircle = L.circle(filterCenter, { color: '#dc2626', fillColor: '#dc2626', fillOpacity: 0.2, radius: filterRadiusKm * 1000 }).addTo(filterMap);
}

document.getElementById('incMapRadiusSlider')?.addEventListener('input', e => {
    filterRadiusKm = parseInt(e.target.value); 
    document.getElementById('incRadiusDisplay').innerText = filterRadiusKm + " km";
    if (filterCenter) drawIncCircle();
});

window.applyIncMapFilter = function() {
    if (!filterCenter) { window.showToast("Select a point first.", "error"); return; }
    document.getElementById('incMapFilterBtnActive').classList.add('bg-primary', 'text-white');
    applyIncFilters(); window.closeDetailsModal('incMapFilterModal');
};

window.clearIncMapFilter = function() {
    filterCenter = null; if (filterCircle) filterMap.removeLayer(filterCircle);
    document.getElementById('incMapFilterBtnActive').classList.remove('bg-primary', 'text-white');
    applyIncFilters(); window.closeDetailsModal('incMapFilterModal');
};

// تحديث الواجهة عند تغيير اللغة
window.addEventListener('languageChanged', () => {
    if(document.getElementById('module-incidents') && !document.getElementById('module-incidents').classList.contains('hidden')) {
        applyIncFilters();
    }
});