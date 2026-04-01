import { supabase, DB_TABLES } from '../config/supabase.js';
import { t } from '../core/language.js'; // 🌐 استدعاء قاموس الترجمة

const tbody = document.getElementById('devicesTableBody');
const form = document.getElementById('deviceForm');

let allDevices = [];
let pickerMap = null, pickerMarker = null;
let filterMap = null, filterCircle = null, filterCenter = null, filterRadiusKm = 5;

// ==========================================
// 🛡️ تسجيل الحركات (Audit Log)
// ==========================================
const sessionString = localStorage.getItem('resq_custom_session');
const currentAdminId = sessionString ? JSON.parse(sessionString).id : null;

async function logSystemAction(action, targetTable, targetId, note) {
    if (!currentAdminId) return;
    try {
        await supabase.from('audit_admin_changes').insert([{
            admin_user_id: currentAdminId, action: action, target_table: targetTable, target_id: targetId, note: note
        }]);
    } catch (error) { console.error("Audit Log Failed:", error); }
}

// ==========================================
// 1. تحميل البيانات
// ==========================================
window.loadDevicesData = async function() {
    if(!tbody) return;
    tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-gray-500"><i class="fa-solid fa-circle-notch fa-spin text-2xl"></i> ${t('loading')}</td></tr>`;
    
    const { data, error } = await supabase.from(DB_TABLES.DEVICES).select('*, users(name, phone, email)').order('id', { ascending: false });
    if (error) {
        window.showToast(t('errorLoading') || "Failed to load data.", "error");
        tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-red-500">Failed to load data.</td></tr>`;
        return;
    }
    allDevices = data || [];
    applyDevFilters();
    loadAppUsers(); 
};

// 🌐 الاستماع لتغيير اللغة وتحديث الجدول والنصوص الحية فوراً بدون إعادة تحميل
window.addEventListener('languageChanged', () => {
    applyDevFilters(); 
});

// ==========================================
// 2. البحث والفلترة (نصي + حالة + جغرافي)
// ==========================================
function applyDevFilters() {
    const term = document.getElementById('devSearchInput')?.value.toLowerCase() || "";
    const statusTerm = document.getElementById('devStatusFilter')?.value || "";

    const filtered = allDevices.filter(d => {
        const matchesSearch = d.device_uid.toLowerCase().includes(term) || 
                              (d.users?.name && d.users.name.toLowerCase().includes(term)) ||
                              (d.car_plate && d.car_plate.toLowerCase().includes(term));
        
        const isDeviceActive = d.status !== 'inactive'; 
        const matchesStatus = statusTerm === "" || (statusTerm === 'active' && isDeviceActive) || (statusTerm === 'inactive' && !isDeviceActive);
        
        let matchesGeo = true;
        if (filterCenter && d.lat && d.lng) {
            const distMeters = L.latLng(filterCenter.lat, filterCenter.lng).distanceTo(L.latLng(d.lat, d.lng));
            matchesGeo = distMeters <= (filterRadiusKm * 1000); 
        }

        return matchesSearch && matchesStatus && matchesGeo;
    });

    renderDevicesTable(filtered);
}

document.getElementById('devSearchInput')?.addEventListener('input', applyDevFilters);
document.getElementById('devStatusFilter')?.addEventListener('change', applyDevFilters);

// ==========================================
// 3. رسم الجدول (متعدد اللغات)
// ==========================================
function renderDevicesTable(data) {
    if(!tbody) return;
    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-gray-500 font-bold">${t('noDataFound') || 'No devices match your criteria.'}</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(d => {
        const isActive = d.status !== 'inactive';
        let statusBadge = isActive ? `<span class="px-2 py-1 rounded bg-success/20 text-success border border-success/30 font-bold text-[10px] uppercase">${t('active')}</span>` 
                                   : `<span class="px-2 py-1 rounded bg-gray-500/20 text-gray-500 border border-gray-500/30 font-bold text-[10px] uppercase">${t('suspended')}</span>`;

        let unassignedText = t('unassigned') || 'Unassigned';

        return `
        <tr class="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors border-b border-gray-100 dark:border-white/5">
            <td class="p-4 font-mono text-xs font-bold text-gray-800 dark:text-white">${d.device_uid}</td>
            <td class="p-4 text-sm text-gray-600 dark:text-gray-300">
                ${d.users?.name ? `<div class="font-bold text-blue-500">${d.users.name}</div><div class="text-[10px] text-gray-500 font-mono">${d.users.phone || ''}</div>` : `<span class="text-red-500 font-bold text-xs">${unassignedText}</span>`}
            </td>
            <td class="p-4">
                <div class="text-xs font-bold text-gray-700 dark:text-gray-200">${d.car_model || '-'}</div>
                <div class="text-[10px] text-gray-500 uppercase tracking-widest mt-1">${d.car_plate || '-'}</div>
            </td>
            <td class="p-4 text-center">${statusBadge}</td>
            <td class="p-4">
                <div class="flex items-center justify-center gap-2">
                    <button onclick="viewDeviceDetails(${d.id})" class="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-blue-500 hover:text-white rounded-lg transition-colors" title="${t('view')}"><i class="fa-solid fa-eye text-xs"></i></button>
                    <button onclick="editDevice(${d.id})" class="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-warning hover:text-white rounded-lg transition-colors" title="${t('edit')}"><i class="fa-solid fa-pen text-xs"></i></button>
                    <button onclick="deleteDevice(${d.id})" class="w-8 h-8 flex items-center justify-center bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-colors" title="${t('delete')}"><i class="fa-solid fa-trash text-xs"></i></button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

// ==========================================
// 4. عرض التفاصيل (مترجم)
// ==========================================
window.viewDeviceDetails = function(id) {
    const d = allDevices.find(x => x.id === id); if(!d) return;

    document.getElementById('viewDeviceDetailsContent').innerHTML = `
        <div class="flex justify-between border-b dark:border-gray-700 pb-2"><span class="text-gray-500 font-bold">${t('lblDeviceUid')}</span> <span class="font-mono font-bold dark:text-white">${d.device_uid}</span></div>
        <div class="flex justify-between border-b dark:border-gray-700 pb-2"><span class="text-gray-500 font-bold">${t('colOwner')}</span> <span class="dark:text-white font-bold text-blue-500">${d.users?.name || t('unassigned') || 'Unassigned'}</span></div>
        <div class="flex justify-between border-b dark:border-gray-700 pb-2"><span class="text-gray-500 font-bold">${t('email')}</span> <span class="dark:text-gray-300 text-xs">${d.users?.email || 'N/A'}</span></div>
        <div class="flex justify-between border-b dark:border-gray-700 pb-2"><span class="text-gray-500 font-bold">${t('phone')}</span> <span class="font-mono dark:text-white">${d.users?.phone || 'N/A'}</span></div>
        <div class="flex justify-between border-b dark:border-gray-700 pb-2"><span class="text-gray-500 font-bold">${t('lblCarModel')}</span> <span class="dark:text-white">${d.car_model || 'N/A'}</span></div>
        <div class="flex justify-between border-b dark:border-gray-700 pb-2"><span class="text-gray-500 font-bold">${t('lblCarPlate')}</span> <span class="font-mono dark:text-white uppercase font-bold">${d.car_plate || 'N/A'}</span></div>
        <div class="flex justify-between border-b dark:border-gray-700 pb-2"><span class="text-gray-500 font-bold">${t('location')}</span> <span class="font-mono text-xs text-blue-500">${d.lat?.toFixed(5) || 'N/A'}, ${d.lng?.toFixed(5) || 'N/A'}</span></div>
        <div class="flex justify-between"><span class="text-gray-500 font-bold">${t('lblRegDate')}</span> <span class="text-xs font-mono text-gray-500">${new Date(d.created_at).toLocaleDateString()}</span></div>
    `;
    const m = document.getElementById('viewDeviceDetailsModal'); m.classList.remove('hidden');
    setTimeout(() => { m.classList.remove('opacity-0'); m.children[0].classList.remove('scale-95'); }, 10);
};

// ==========================================
// 5. الفلتر الجغرافي 🗺️
// ==========================================
window.openDevMapFilterModal = function() {
    const m = document.getElementById('devMapFilterModal'); m.classList.remove('hidden');
    setTimeout(() => { m.classList.remove('opacity-0'); m.children[0].classList.remove('scale-95'); }, 10);
    if (!filterMap) {
        filterMap = L.map('devFilterMapArea').setView([30.0444, 31.2357], 11);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(filterMap);
        filterMap.on('click', function(e) { filterCenter = e.latlng; drawFilterCircle(); });
    }
    setTimeout(() => { filterMap.invalidateSize(); }, 250);
};

document.getElementById('devMapRadiusSlider')?.addEventListener('input', function(e) {
    filterRadiusKm = parseInt(e.target.value); 
    document.getElementById('devRadiusDisplay').innerText = filterRadiusKm + " km";
    if (filterCenter) drawFilterCircle();
});

function drawFilterCircle() {
    if (filterCircle) filterMap.removeLayer(filterCircle);
    filterCircle = L.circle(filterCenter, { color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.2, radius: filterRadiusKm * 1000 }).addTo(filterMap);
}

window.applyDevMapFilter = function() {
    if (!filterCenter) { window.showToast(t('selectMapArea') || "Please click on map first.", "error"); return; }
    document.getElementById('devMapFilterBtnActive').classList.add('bg-blue-600', 'text-white');
    applyDevFilters(); window.closeDetailsModal('devMapFilterModal');
    window.showToast(t('filterApplied') || "Map filter applied.", "success");
};

window.clearDevMapFilter = function() {
    filterCenter = null; if (filterCircle) filterMap.removeLayer(filterCircle);
    document.getElementById('devMapFilterBtnActive').classList.remove('bg-blue-600', 'text-white');
    applyDevFilters(); window.closeDetailsModal('devMapFilterModal');
};

// ==========================================
// 6. خريطة الإضافة (Map Picker)
// ==========================================
function initPickerMap(lat = 30.0444, lng = 31.2357) {
    if (!pickerMap) {
        pickerMap = L.map('devicePickerMap').setView([lat, lng], 12);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(pickerMap);
        pickerMap.on('click', function(e) { setPickerMarker(e.latlng.lat, e.latlng.lng); });
    } else { pickerMap.setView([lat, lng], 12); }
    setPickerMarker(lat, lng); setTimeout(() => { pickerMap.invalidateSize(); }, 250); 
}

function setPickerMarker(lat, lng) {
    if (pickerMarker) pickerMap.removeLayer(pickerMarker);
    pickerMarker = L.marker([lat, lng]).addTo(pickerMap);
    document.getElementById('devLat').value = lat.toFixed(7); document.getElementById('devLng').value = lng.toFixed(7);
}

async function loadAppUsers() {
    const { data } = await supabase.from(DB_TABLES.USERS).select('id, name, phone').eq('role', 'user');
    if(data) document.getElementById('devUserId').innerHTML = `<option value="">-- ${t('unassigned') || 'Unassigned'} --</option>` + data.map(u => `<option value="${u.id}">${u.name} (${u.phone || 'N/A'})</option>`).join('');
}

// ==========================================
// 7. العمليات الإدارية (مع الإشعارات المخصصة)
// ==========================================
window.openDeviceModal = function() {
    form.reset(); document.getElementById('devId').value = '';
    document.getElementById('deviceModalTitle').innerText = t('modalAddDevTitle') || 'Add New Device';
    const m = document.getElementById('deviceModal'); m.classList.remove('hidden');
    setTimeout(() => { m.classList.remove('opacity-0'); m.children[0].classList.remove('scale-95'); }, 10);
    initPickerMap(30.0444, 31.2357);
};

window.editDevice = function(id) {
    const d = allDevices.find(a => a.id === id); if(!d) return;
    document.getElementById('devId').value = d.id;
    document.getElementById('devUid').value = d.device_uid;
    document.getElementById('devUserId').value = d.user_id || '';
    document.getElementById('devCarModel').value = d.car_model || '';
    document.getElementById('devCarPlate').value = d.car_plate || '';
    
    document.getElementById('deviceModalTitle').innerText = t('edit') + ' ' + (t('navDevices') || 'Device');
    const m = document.getElementById('deviceModal'); m.classList.remove('hidden');
    setTimeout(() => { m.classList.remove('opacity-0'); m.children[0].classList.remove('scale-95'); }, 10);
    initPickerMap(d.lat || 30.0444, d.lng || 31.2357);
};

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('saveDevBtn'); const original = btn.innerText;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${t('processing') || 'Saving...'}`; btn.disabled = true;
    
    const id = document.getElementById('devId').value;
    const userId = document.getElementById('devUserId').value;

    const data = {
        device_uid: document.getElementById('devUid').value.trim(),
        user_id: userId ? parseInt(userId) : null,
        car_model: document.getElementById('devCarModel').value,
        car_plate: document.getElementById('devCarPlate').value.toUpperCase(),
        lat: parseFloat(document.getElementById('devLat').value),
        lng: parseFloat(document.getElementById('devLng').value),
    };

    try {
        if (id) {
            await supabase.from(DB_TABLES.DEVICES).update(data).eq('id', id);
            window.showToast(t('updateSuccess') || 'Device updated successfully!');
            await logSystemAction('UPDATE', 'devices', id, `Updated device UID: ${data.device_uid}`);
        } else {
            const { data: newDev, error } = await supabase.from(DB_TABLES.DEVICES).insert([data]).select().single();
            if (error) throw error;
            window.showToast(t('addSuccess') || 'Device added successfully!');
            await logSystemAction('CREATE', 'devices', newDev.id, `Added new device UID: ${data.device_uid}`);
        }
        window.closeDetailsModal('deviceModal'); await window.loadDevicesData();
    } catch (error) { window.showToast((t('error')||"Failed") + ": " + error.message, "error"); } finally { btn.innerHTML = original; btn.disabled = false; }
});

// 🛡️ استخدام نافذة التأكيد المخصصة للحذف (Custom Confirm Modal)
window.deleteDevice = async function(id) {
    const d = allDevices.find(a => a.id === id);
    if (!d) return;

    window.openConfirmModal(
        t('confirmTitle') || "Delete Device?", 
        `${t('confirmMessage') || "Are you sure you want to remove device"} (${d.device_uid})?`, 
        async () => {
            const { error } = await supabase.from(DB_TABLES.DEVICES).delete().eq('id', id);
            if(error) window.showToast((t('error')||"Deletion Failed") + ": " + error.message, "error");
            else { 
                window.showToast(t('deleteSuccess') || 'Device deleted successfully!'); 
                await logSystemAction('DELETE', 'devices', id, `Deleted device UID: ${d.device_uid}`);
                await window.loadDevicesData(); 
            }
        }
    );
};