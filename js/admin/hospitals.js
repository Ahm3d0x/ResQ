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
const tbody = document.getElementById('hospitalsTableBody');
const modal = document.getElementById('hospitalModal');
const form = document.getElementById('hospitalForm');

let allHospitals = []; // تخزين محلي لسرعة البحث والفلترة
let pickerMap = null;
let pickerMarker = null;

// ==========================================
// 1. تحميل عرض البيانات (مع دعم الفلترة)
// ==========================================
window.loadHospitalsData = async function() {
    tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-gray-500"><i class="fa-solid fa-circle-notch fa-spin text-2xl"></i> Loading hospitals...</td></tr>';
    
    // جلب المستشفيات مع اسم حساب الإدارة ورقم هاتفه من جدول users
    const { data, error } = await supabase.from(DB_TABLES.HOSPITALS).select('*, users(name, phone)').order('id', { ascending: false });
    
    if (error) {
        console.error("Error loading hospitals:", error);
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-red-500">Failed to load hospitals.</td></tr>`;
        return;
    }

    allHospitals = data;
    applyHospFilters(); // نقوم برسم الجدول من خلال الفلتر لضمان تطبيق أي بحث مسبق
    loadHospitalAdmins(); // تجهيز قائمة الحسابات للنافذة المنبثقة
};

// ==========================================
// 2. نظام البحث والفلترة اللحظي
// ==========================================
function applyHospFilters() {
    const term = document.getElementById('hospSearchInput')?.value.toLowerCase() || "";
    const bedFilter = document.getElementById('hospBedsFilter')?.value || "";

    const filtered = allHospitals.filter(h => {
        // البحث بالنص في الاسم، المدينة، أو الـ ID
        const matchesSearch = h.name.toLowerCase().includes(term) || 
                              (h.city && h.city.toLowerCase().includes(term)) || 
                              h.id.toString().includes(term);
        
        // فلترة سعة الأسرة (الكل، متاح، أو ممتلئ)
        let matchesBeds = true;
        if (bedFilter === "available") matchesBeds = h.available_beds > 0;
        else if (bedFilter === "full") matchesBeds = h.available_beds === 0;

        return matchesSearch && matchesBeds;
    });

    renderHospitalsTable(filtered);
}

// ربط أحداث الإدخال بأدوات البحث والفلترة
document.getElementById('hospSearchInput')?.addEventListener('input', applyHospFilters);
document.getElementById('hospBedsFilter')?.addEventListener('change', applyHospFilters);

// ==========================================
// 3. رسم الجدول (Rendering)
// ==========================================
function renderHospitalsTable(data) {
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-gray-500 font-bold">No hospitals match your search criteria.</td></tr>';
        return;
    }

    tbody.innerHTML = data.map(h => {
        // تلوين الأسرة (Capacity Color Indicator)
        let bedColor = h.available_beds > 5 ? 'text-success bg-success/10 border-success/30' : 
                       h.available_beds > 0 ? 'text-warning bg-warning/10 border-warning/30' : 'text-red-500 bg-red-500/10 border-red-500/30';
        
        return `
        <tr class="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors border-b border-gray-100 dark:border-white/5">
            <td class="p-4 font-mono text-xs text-gray-500 dark:text-gray-400">#HSP-${h.id}</td>
            <td class="p-4 font-bold text-gray-800 dark:text-white">
                <i class="fa-solid fa-hospital text-blue-500 mr-1 text-xs"></i> ${h.name}
            </td>
            <td class="p-4 text-xs text-gray-600 dark:text-gray-300">
                ${h.city || '-'}, ${h.governorate || '-'}
            </td>
            <td class="p-4 text-center">
                <span class="px-3 py-1 rounded-lg border text-sm font-black ${bedColor}">${h.available_beds}</span>
            </td>
            <td class="p-4 text-xs text-gray-500 dark:text-gray-400">
                <i class="fa-solid fa-user-tie mr-1"></i> ${h.users?.name || '<span class="text-red-500 font-bold">Unlinked</span>'}
            </td>
            <td class="p-4">
                <div class="flex items-center justify-center gap-2">
                    <button onclick="viewHospitalDetails(${h.id})" class="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-blue-500 hover:text-white rounded-lg transition-colors shadow-sm" title="View Details">
                        <i class="fa-solid fa-eye text-xs"></i>
                    </button>
                    <button onclick="editHospital(${h.id})" class="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-warning hover:text-white rounded-lg transition-colors shadow-sm" title="Edit">
                        <i class="fa-solid fa-pen text-xs"></i>
                    </button>
                    <button onclick="deleteHospital(${h.id})" class="w-8 h-8 flex items-center justify-center bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-colors shadow-sm" title="Delete">
                        <i class="fa-solid fa-trash text-xs"></i>
                    </button>
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

// ==========================================
// 4. عرض تفاصيل المستشفى (View Details Card)
// ==========================================
window.viewHospitalDetails = function(id) {
    const h = allHospitals.find(x => x.id === id);
    if(!h) return;

    document.getElementById('viewHospitalDetailsContent').innerHTML = `
        <div class="flex justify-between border-b border-gray-200 dark:border-gray-700 pb-2">
            <span class="text-gray-500 font-bold">Hospital ID</span> <span class="font-mono dark:text-white">#HSP-${h.id}</span>
        </div>
        <div class="flex justify-between border-b border-gray-200 dark:border-gray-700 pb-2">
            <span class="text-gray-500 font-bold">Hospital Name</span> <span class="font-bold dark:text-white">${h.name}</span>
        </div>
        <div class="flex justify-between border-b border-gray-200 dark:border-gray-700 pb-2">
            <span class="text-gray-500 font-bold">Location</span> <span class="dark:text-white">${h.city || '-'}, ${h.governorate || '-'}</span>
        </div>
        <div class="flex justify-between border-b border-gray-200 dark:border-gray-700 pb-2">
            <span class="text-gray-500 font-bold">Coordinates</span> <span class="font-mono text-xs text-blue-500">${h.lat?.toFixed(5) || 'N/A'}, ${h.lng?.toFixed(5) || 'N/A'}</span>
        </div>
        <div class="flex justify-between border-b border-gray-200 dark:border-gray-700 pb-2">
            <span class="text-gray-500 font-bold">Emergency Phone</span> <span class="font-mono dark:text-white">${h.phone || 'N/A'}</span>
        </div>
        <div class="flex justify-between border-b border-gray-200 dark:border-gray-700 pb-2">
            <span class="text-gray-500 font-bold">Admin Account</span> 
            <span class="dark:text-white text-right">${h.users?.name || '<span class="text-red-500">Unlinked</span>'} <br> <span class="text-xs text-gray-500 font-mono">${h.users?.phone || ''}</span></span>
        </div>
        <div class="flex justify-between">
            <span class="text-gray-500 font-bold">Available Beds</span> 
            <span class="font-black text-xl ${h.available_beds > 0 ? 'text-success' : 'text-red-500'}">${h.available_beds}</span>
        </div>
    `;

    const m = document.getElementById('viewHospitalDetailsModal');
    m.classList.remove('hidden');
    setTimeout(() => { m.classList.remove('opacity-0'); m.children[0].classList.remove('scale-95'); }, 10);
};

// ==========================================
// 5. جلب الحسابات ذات صلاحية 'hospital' للنافذة المنبثقة
// ==========================================
async function loadHospitalAdmins() {
    const { data } = await supabase.from(DB_TABLES.USERS).select('id, name').eq('role', 'hospital');
    const select = document.getElementById('hospUserId');
    if(data) {
        select.innerHTML = '<option value="">-- Select Admin Account --</option>' + 
            data.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
    }
}

// ==========================================
// 6. خريطة اختيار الموقع (Map Picker) 🗺️
// ==========================================
function initPickerMap(lat = 30.0444, lng = 31.2357) {
    if (!pickerMap) {
        pickerMap = L.map('hospitalPickerMap').setView([lat, lng], 12);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(pickerMap);
        
        pickerMap.on('click', function(e) {
            setPickerMarker(e.latlng.lat, e.latlng.lng);
        });
    } else {
        pickerMap.setView([lat, lng], 12);
    }
    
    setPickerMarker(lat, lng);

    setTimeout(() => {
        pickerMap.invalidateSize();
    }, 250); 
}

function setPickerMarker(lat, lng) {
    if (pickerMarker) pickerMap.removeLayer(pickerMarker);
    pickerMarker = L.marker([lat, lng]).addTo(pickerMap);
    
    document.getElementById('hospLat').value = lat.toFixed(7);
    document.getElementById('hospLng').value = lng.toFixed(7);
}

// ==========================================
// 7. إدارة الإضافة والتعديل (Add, Edit)
// ==========================================
window.openHospitalModal = function() {
    form.reset();
    document.getElementById('hospId').value = '';
    document.getElementById('hospitalModalTitle').innerText = 'Add New Hospital';
    
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        modal.children[0].classList.remove('scale-95');
    }, 10);

    initPickerMap(30.0444, 31.2357);
};

window.editHospital = function(id) {
    const hosp = allHospitals.find(h => h.id === id);
    if(!hosp) return;

    document.getElementById('hospId').value = hosp.id;
    document.getElementById('hospName').value = hosp.name;
    document.getElementById('hospGov').value = hosp.governorate || '';
    document.getElementById('hospCity').value = hosp.city || '';
    document.getElementById('hospPhone').value = hosp.phone || '';
    document.getElementById('hospBeds').value = hosp.available_beds;
    document.getElementById('hospUserId').value = hosp.user_id || '';

    document.getElementById('hospitalModalTitle').innerText = 'Edit Hospital Details';
    
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        modal.children[0].classList.remove('scale-95');
    }, 10);

    initPickerMap(hosp.lat || 30.0444, hosp.lng || 31.2357);
};

window.closeHospitalModal = function() {
    modal.classList.add('opacity-0');
    modal.children[0].classList.add('scale-95');
    setTimeout(() => { modal.classList.add('hidden'); }, 300);
};

// داخل المستمع للحدث form.addEventListener('submit', ...)

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const originalText = btn.innerHTML;
    const id = document.getElementById('hospId').value;

    const hospData = {
        name: document.getElementById('hospName').value,
        phone: document.getElementById('hospPhone').value,
        available_beds: parseInt(document.getElementById('hospBeds').value),
        user_id: document.getElementById('hospUserId').value || null,
        lat: parseFloat(document.getElementById('hospLat').value),
        lng: parseFloat(document.getElementById('hospLng').value),
        country: 'Egypt'
    };

    try {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
        btn.disabled = true;

        // 🛡️ منع تكرار الأكاونت لمستشفى آخر
        if (hospData.user_id) {
            const { data: duplicate } = await supabase
                .from(DB_TABLES.HOSPITALS)
                .select('id, name')
                .eq('user_id', hospData.user_id)
                .neq('id', id || -1); // استثناء المستشفى الحالي عند التعديل

            if (duplicate && duplicate.length > 0) {
                window.showToast(`هذا الحساب مرتبط بالفعل بمستشفى آخر (${duplicate[0].name})`, "error");
                return;
            }
        }

        if (id) {
            const { error } = await supabase.from(DB_TABLES.HOSPITALS).update(hospData).eq('id', id);
            if (error) throw error;
            await logSystemAction('UPDATE', 'hospitals', id, `Updated hospital: ${hospData.name}`);
        } else {
            // استخدام select().single() لضمان استرجاع الـ ID للسجل
            const { data: newHosp, error } = await supabase.from(DB_TABLES.HOSPITALS).insert([hospData]).select().single();
            if (error) throw error;
            if (newHosp) {
                await logSystemAction('CREATE', 'hospitals', newHosp.id, `Added new hospital: ${hospData.name}`);
            }
        }
        
        window.showToast("تم حفظ بيانات المستشفى بنجاح", "success");
        closeHospitalModal();
        await window.loadHospitalsData();
    } catch (error) {
        window.showToast("خطأ في العملية: " + error.message, "error");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
});

// استبدال دالة الحذف بالكامل
window.deleteHospital = function(id) {
    const hosp = allHospitals.find(h => h.id === id);
    const name = hosp ? hosp.name : id;

    window.openConfirmModal(
        "حذف مستشفى", 
        `هل أنت متأكد من حذف مستشفى (${name})؟ لا يمكن التراجع عن هذا الإجراء.`, 
        async () => {
            const { error } = await supabase.from(DB_TABLES.HOSPITALS).delete().eq('id', id);
            if(error) {
                window.showToast("فشل الحذف: " + error.message, "error");
            } else {
                await logSystemAction('DELETE', 'hospitals', id, `Deleted hospital: ${name}`);
                window.showToast('تم حذف المستشفى بنجاح', 'success');
                await window.loadHospitalsData();
            }
        }
    );
};