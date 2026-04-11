import { supabase, DB_TABLES } from '../config/supabase.js';
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
const tbody = document.getElementById('ambulancesTableBody');
const modal = document.getElementById('ambulanceModal');
const form = document.getElementById('ambulanceForm');
const viewModal = document.getElementById('viewAmbulanceDetailsModal');

let allAmbulances = [];

// ==========================================
// متغيرات خريطة إضافة/تعديل الإسعاف (Map Picker)
// ==========================================
let pickerMap = null;
let pickerMarker = null;

// ==========================================
// متغيرات فلتر الخريطة الجغرافي (Geo-Filter)
// ==========================================
let filterMap = null;
let filterCircle = null;
let filterCenter = null; 
let filterRadiusKm = 5;

// ==========================================
// 1. تحميل عرض البيانات (مع دعم الفلترة)
// ==========================================
window.loadAmbulancesData = async function() {
    tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-gray-500"><i class="fa-solid fa-circle-notch fa-spin text-2xl"></i> Loading fleet...</td></tr>';
    
    // جلب بيانات الإسعاف مع اسم السائق ورقم هاتفه
    const { data, error } = await supabase.from(DB_TABLES.AMBULANCES).select('*, users(name, phone)').order('id', { ascending: false });
    
    if (error) {
        console.error("Error loading ambulances:", error);
        tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-red-500">Failed to load fleet data.</td></tr>`;
        return;
    }

    allAmbulances = data || [];
    applyAmbFilters(); // تفعيل الفلاتر ورسم الجدول
    loadDrivers(); // تجهيز قائمة السائقين لنموذج الإضافة
};

// ==========================================
// 2. نظام البحث والفلترة اللحظي (يشمل الفلتر الجغرافي)
// ==========================================
function applyAmbFilters() {
    const term = document.getElementById('ambSearchInput')?.value.toLowerCase() || "";
    const statusTerm = document.getElementById('ambStatusFilter')?.value || "";

    const filtered = allAmbulances.filter(a => {
        // 1. البحث النصي (كود السيارة، اسم السائق، أو ID)
        const matchesSearch = a.code.toLowerCase().includes(term) || 
                              (a.users?.name && a.users.name.toLowerCase().includes(term)) ||
                              a.id.toString().includes(term);
        
        // 2. فلتر الحالة
        const matchesStatus = statusTerm === "" || a.status === statusTerm;
        
        // 3. الفلتر الجغرافي (Map Distance Filter)
        let matchesGeo = true;
        if (filterCenter && a.lat && a.lng) {
            // حساب المسافة بين النقطة المحددة على الخريطة وموقع الإسعاف (بالمتر)
            const distMeters = L.latLng(filterCenter.lat, filterCenter.lng).distanceTo(L.latLng(a.lat, a.lng));
            matchesGeo = distMeters <= (filterRadiusKm * 1000); // تحويل الكيلومتر إلى متر
        }

        return matchesSearch && matchesStatus && matchesGeo;
    });

    renderAmbulancesTable(filtered);
}

// ربط أحداث الإدخال بأدوات البحث والفلترة
document.getElementById('ambSearchInput')?.addEventListener('input', applyAmbFilters);
document.getElementById('ambStatusFilter')?.addEventListener('change', applyAmbFilters);

// ==========================================
// 3. رسم الجدول (Rendering)
// ==========================================
function renderAmbulancesTable(data) {
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-gray-500 font-bold">No units match your search criteria.</td></tr>';
        return;
    }

    tbody.innerHTML = data.map(a => {
        // تنسيق شارة الحالة (Status Badge)
        let statusBadge = '';
        if(a.status === 'available') statusBadge = '<span class="px-2 py-1 rounded bg-success/20 text-success border border-success/30 font-bold">Available</span>';
        else if(a.status === 'offline') statusBadge = '<span class="px-2 py-1 rounded bg-gray-500/20 text-gray-500 border border-gray-500/30 font-bold">Offline</span>';
        else statusBadge = `<span class="px-2 py-1 rounded bg-warning/20 text-warning border border-warning/30 font-bold">${a.status.replace(/_/g, ' ')}</span>`;

        return `
        <tr class="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors border-b border-gray-100 dark:border-white/5">
            <td class="p-4 font-black text-gray-800 dark:text-white uppercase tracking-wider">
                <span class="text-xs text-gray-400 font-mono block mb-1">#AMB-${a.id}</span>
                ${a.code}
            </td>
            <td class="p-4 text-sm text-gray-600 dark:text-gray-300">
                ${a.users?.name ? `<i class="fa-solid fa-id-card text-success mr-1"></i> ${a.users.name}` : '<span class="text-red-500 font-bold text-xs"><i class="fa-solid fa-triangle-exclamation mr-1"></i> No Driver</span>'}
            </td>
            <td class="p-4 font-mono text-[10px] text-gray-500 dark:text-gray-400">
                ${a.lat ? `${a.lat.toFixed(4)}<br>${a.lng.toFixed(4)}` : 'Location Not Set'}
            </td>
            <td class="p-4 text-center text-[10px] uppercase tracking-wide">
                ${statusBadge}
            </td>
            <td class="p-4">
                <div class="flex items-center justify-center gap-2">
                    <button onclick="viewAmbulanceDetails(${a.id})" class="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-blue-500 hover:text-white rounded-lg transition-colors shadow-sm" title="View Info">
                        <i class="fa-solid fa-eye text-xs"></i>
                    </button>
                    <button onclick="editAmbulance(${a.id})" class="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-warning hover:text-white rounded-lg transition-colors shadow-sm" title="Edit">
                        <i class="fa-solid fa-pen text-xs"></i>
                    </button>
                    <button onclick="deleteAmbulance(${a.id})" class="w-8 h-8 flex items-center justify-center bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-colors shadow-sm" title="Delete">
                        <i class="fa-solid fa-trash text-xs"></i>
                    </button>
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

// ==========================================
// 4. عرض تفاصيل الإسعاف (View Info Card)
// ==========================================
window.viewAmbulanceDetails = function(id) {
    const a = allAmbulances.find(x => x.id === id);
    if(!a) return;

    let statusColor = a.status === 'available' ? 'text-success' : a.status === 'offline' ? 'text-gray-500' : 'text-warning';

    document.getElementById('viewAmbulanceDetailsContent').innerHTML = `
        <div class="flex justify-between border-b border-gray-200 dark:border-gray-700 pb-2">
            <span class="text-gray-500 font-bold">Unit Code</span> 
            <span class="font-black text-lg dark:text-white">${a.code}</span>
        </div>
        <div class="flex justify-between border-b border-gray-200 dark:border-gray-700 pb-2">
            <span class="text-gray-500 font-bold">Assigned Driver</span> 
            <span class="dark:text-white text-right">${a.users?.name || '<span class="text-red-500">Not Assigned</span>'} <br> <span class="text-xs text-gray-500 font-mono">${a.users?.phone || ''}</span></span>
        </div>
        <div class="flex justify-between border-b border-gray-200 dark:border-gray-700 pb-2">
            <span class="text-gray-500 font-bold">Base Location</span> 
            <span class="font-mono text-xs text-blue-500">${a.lat?.toFixed(5) || 'N/A'}, ${a.lng?.toFixed(5) || 'N/A'}</span>
        </div>
        <div class="flex justify-between border-b border-gray-200 dark:border-gray-700 pb-2">
            <span class="text-gray-500 font-bold">Current Status</span> 
            <span class="uppercase font-black tracking-wider text-sm ${statusColor}">${a.status.replace(/_/g, ' ')}</span>
        </div>
        <div class="flex justify-between">
            <span class="text-gray-500 font-bold">Registration Date</span> 
            <span class="text-xs font-mono text-gray-500">${new Date(a.created_at).toLocaleDateString()}</span>
        </div>
    `;

    viewModal.classList.remove('hidden');
    setTimeout(() => { viewModal.classList.remove('opacity-0'); viewModal.children[0].classList.remove('scale-95'); }, 10);
};

// ==========================================
// 5. الفلتر الجغرافي الخارق (Geo-Spatial Map Filter) 🗺️🎯
// ==========================================
window.openMapFilterModal = function() {
    const m = document.getElementById('mapFilterModal');
    m.classList.remove('hidden');
    setTimeout(() => { m.classList.remove('opacity-0'); m.children[0].classList.remove('scale-95'); }, 10);

    if (!filterMap) {
        filterMap = L.map('filterMapArea').setView([30.0444, 31.2357], 11);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(filterMap);
        
        filterMap.on('click', function(e) {
            filterCenter = e.latlng;
            drawFilterCircle();
        });
    }
    
    // إصلاح تشوه الخريطة داخل النوافذ المخفية
    setTimeout(() => { filterMap.invalidateSize(); }, 250);
};

document.getElementById('mapRadiusSlider')?.addEventListener('input', function(e) {
    filterRadiusKm = parseInt(e.target.value);
    document.getElementById('radiusDisplay').innerText = filterRadiusKm + " km";
    if (filterCenter) drawFilterCircle();
});

function drawFilterCircle() {
    if (filterCircle) filterMap.removeLayer(filterCircle);
    filterCircle = L.circle(filterCenter, {
        color: '#a855f7', fillColor: '#a855f7', fillOpacity: 0.2, radius: filterRadiusKm * 1000
    }).addTo(filterMap);
}

window.applyMapFilter = function() {
    if (!filterCenter) return alert("Please click on the map to set a target area first.");
    
    const btn = document.getElementById('mapFilterBtnActive');
    btn.classList.add('bg-purple-600', 'text-white');
    btn.innerHTML = `<i class="fa-solid fa-filter animate-pulse"></i> Radius: ${filterRadiusKm}km`;
    
    applyAmbFilters();
    
    const m = document.getElementById('mapFilterModal');
    m.classList.add('opacity-0'); m.children[0].classList.add('scale-95');
    setTimeout(() => { m.classList.add('hidden'); }, 300);
};

window.clearMapFilter = function() {
    filterCenter = null;
    if (filterCircle) filterMap.removeLayer(filterCircle);
    
    const btn = document.getElementById('mapFilterBtnActive');
    btn.classList.remove('bg-purple-600', 'text-white');
    btn.innerHTML = `<i class="fa-solid fa-map-location-dot"></i> Map Filter`;
    
    applyAmbFilters();
    
    const m = document.getElementById('mapFilterModal');
    m.classList.add('opacity-0'); m.children[0].classList.add('scale-95');
    setTimeout(() => { m.classList.add('hidden'); }, 300);
};

// ==========================================
// 6. خريطة اختيار الموقع للسيارات (Map Picker) 🗺️
// ==========================================
function initPickerMap(lat = 30.0444, lng = 31.2357) {
    if (!pickerMap) {
        pickerMap = L.map('ambulancePickerMap').setView([lat, lng], 12);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(pickerMap);
        
        pickerMap.on('click', function(e) {
            setPickerMarker(e.latlng.lat, e.latlng.lng);
        });
    } else {
        pickerMap.setView([lat, lng], 12);
    }
    
    setPickerMarker(lat, lng);
    setTimeout(() => { pickerMap.invalidateSize(); }, 250); 
}

function setPickerMarker(lat, lng) {
    if (pickerMarker) pickerMap.removeLayer(pickerMarker);
    pickerMarker = L.marker([lat, lng], {
        icon: L.divIcon({ html: '<div class="w-6 h-6 bg-success rounded-full border-2 border-white shadow-[0_0_10px_rgba(16,185,129,0.8)] flex items-center justify-center text-white"><i class="fa-solid fa-truck-medical text-[10px]"></i></div>', className: '' })
    }).addTo(pickerMap);
    
    document.getElementById('ambLat').value = lat.toFixed(7);
    document.getElementById('ambLng').value = lng.toFixed(7);
}

// ==========================================
// 7. جلب قائمة السائقين (Drivers) للنموذج
// ==========================================
async function loadDrivers() {
    const { data } = await supabase.from(DB_TABLES.USERS).select('id, name').eq('role', 'driver').eq('is_active', true);
    const select = document.getElementById('ambDriverId');
    if(data) {
        select.innerHTML = '<option value="">-- No Driver (Unassigned) --</option>' + 
            data.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    }
}

// ==========================================
// 8. العمليات الإدارية (Add, Edit, Delete)
// ==========================================
window.openAmbulanceModal = function() {
    form.reset();
    document.getElementById('ambId').value = '';
    document.getElementById('ambulanceModalTitle').innerText = 'Add New Ambulance Unit';
    
    modal.classList.remove('hidden');
    setTimeout(() => { modal.classList.remove('opacity-0'); modal.children[0].classList.remove('scale-95'); }, 10);

    initPickerMap(30.0444, 31.2357); // وسط القاهرة كافتراضي
};

window.editAmbulance = function(id) {
    const amb = allAmbulances.find(a => a.id === id);
    if(!amb) return;

    document.getElementById('ambId').value = amb.id;
    document.getElementById('ambCode').value = amb.code;
    document.getElementById('ambStatus').value = (amb.status === 'offline' || amb.status === 'available') ? amb.status : 'available';
    document.getElementById('ambDriverId').value = amb.driver_id || '';

    document.getElementById('ambulanceModalTitle').innerText = 'Edit Ambulance Unit';
    
    modal.classList.remove('hidden');
    setTimeout(() => { modal.classList.remove('opacity-0'); modal.children[0].classList.remove('scale-95'); }, 10);

    initPickerMap(amb.lat || 30.0444, amb.lng || 31.2357);
};

window.closeAmbulanceModal = function() {
    modal.classList.add('opacity-0');
    modal.children[0].classList.add('scale-95');
    setTimeout(() => { modal.classList.add('hidden'); }, 300);
};
// داخل form.addEventListener('submit', ...)

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('saveAmbBtn');
    const originalText = btn.innerText;
    const id = document.getElementById('ambId').value;
    const driverId = document.getElementById('ambDriverId').value;

    const ambData = {
        code: document.getElementById('ambCode').value.toUpperCase(),
        status: document.getElementById('ambStatus').value,
        driver_id: driverId ? parseInt(driverId) : null,
        lat: parseFloat(document.getElementById('ambLat').value),
        lng: parseFloat(document.getElementById('ambLng').value),
    };

    try {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
        btn.disabled = true;

        // 🛡️ منع تكرار السائق لسيارة أخرى
        if (ambData.driver_id) {
            const { data: duplicate } = await supabase
                .from(DB_TABLES.AMBULANCES)
                .select('id, code')
                .eq('driver_id', ambData.driver_id)
                .neq('id', id || -1);

            if (duplicate && duplicate.length > 0) {
                window.showToast(`هذا السائق مرتبط بالفعل بسيارة إسعاف أخرى (${duplicate[0].code})`, "error");
                return;
            }
        }

        if (id) {
            const { error } = await supabase.from(DB_TABLES.AMBULANCES).update(ambData).eq('id', id);
            if (error) throw error;
            await logSystemAction('UPDATE', 'ambulances', id, `Updated ambulance unit: ${ambData.code}`);
        } else {
            const { data: newAmb, error } = await supabase.from(DB_TABLES.AMBULANCES).insert([ambData]).select().single();
            if (error) throw error;
            if (newAmb) {
                await logSystemAction('CREATE', 'ambulances', newAmb.id, `Added new ambulance unit: ${ambData.code}`);
            }
        }
        
        window.showToast("تم حفظ بيانات الوحدة بنجاح", "success");
        closeAmbulanceModal();
        await window.loadAmbulancesData();
    } catch (error) {
        window.showToast("فشلت العملية: تأكد من أن كود الوحدة غير مكرر", "error");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
});

// استبدال دالة الحذف بنظام الـ Modal المخصص
window.deleteAmbulance = function(id) {
    const amb = allAmbulances.find(a => a.id === id);
    const code = amb ? amb.code : id;

    window.openConfirmModal(
        "حذف سيارة إسعاف", 
        `هل أنت متأكد من حذف الوحدة (${code}) نهائياً من الأسطول؟`, 
        async () => {
            const { error } = await supabase.from(DB_TABLES.AMBULANCES).delete().eq('id', id);
            if(error) {
                window.showToast("فشل الحذف: " + error.message, "error");
            } else {
                await logSystemAction('DELETE', 'ambulances', id, `Deleted ambulance unit: ${code}`);
                window.showToast('تم حذف الوحدة بنجاح', 'success');
                await window.loadAmbulancesData();
            }
        }
    );
};