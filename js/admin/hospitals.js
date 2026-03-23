import { supabase, DB_TABLES } from '../config/supabase.js';

const tbody = document.getElementById('hospitalsTableBody');
const modal = document.getElementById('hospitalModal');
const form = document.getElementById('hospitalForm');

let allHospitals = [];
let pickerMap = null;
let pickerMarker = null;

// ==========================================
// 1. تحميل عرض البيانات
// ==========================================
window.loadHospitalsData = async function() {
    tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-gray-500"><i class="fa-solid fa-circle-notch fa-spin text-2xl"></i></td></tr>';
    
    // جلب المستشفيات مع اسم حساب الإدارة المربوط بها
    const { data, error } = await supabase.from(DB_TABLES.HOSPITALS).select('*, users(name)').order('id', { ascending: false });
    
    if (error) {
        console.error("Error loading hospitals:", error);
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-red-500">Failed to load hospitals.</td></tr>`;
        return;
    }

    allHospitals = data;
    renderHospitalsTable();
    loadHospitalAdmins(); // تجهيز قائمة الحسابات للنافذة المنبثقة
};

function renderHospitalsTable() {
    if (allHospitals.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-gray-500 font-bold">No hospitals registered yet.</td></tr>';
        return;
    }

    tbody.innerHTML = allHospitals.map(h => {
        // تلوين الأسرة (Capacity Color Indicator)
        let bedColor = h.available_beds > 5 ? 'text-success bg-success/10' : 
                       h.available_beds > 0 ? 'text-warning bg-warning/10' : 'text-red-500 bg-red-500/10';
        
        return `
        <tr class="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors border-b border-gray-100 dark:border-white/5">
            <td class="p-4 font-mono text-xs text-gray-500 dark:text-gray-400">#HSP-${h.id}</td>
            <td class="p-4 font-bold text-gray-800 dark:text-white">
                <i class="fa-solid fa-hospital text-blue-500 mr-1 text-xs"></i> ${h.name}
            </td>
            <td class="p-4 text-xs text-gray-600 dark:text-gray-300">
                ${h.city}, ${h.governorate}
            </td>
            <td class="p-4 text-center">
                <span class="px-3 py-1 rounded-lg text-sm font-black ${bedColor}">${h.available_beds}</span>
            </td>
            <td class="p-4 text-xs text-gray-500 dark:text-gray-400">
                <i class="fa-solid fa-user-tie mr-1"></i> ${h.users?.name || '<span class="text-red-500">Unlinked</span>'}
            </td>
            <td class="p-4 text-center">
                <div class="flex items-center justify-center gap-2">
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
// 2. جلب الحسابات ذات صلاحية 'hospital'
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
// 3. خريطة اختيار الموقع (Map Picker) 🗺️
// ==========================================
function initPickerMap(lat = 30.0444, lng = 31.2357) {
    if (!pickerMap) {
        // إنشاء الخريطة لأول مرة
        pickerMap = L.map('hospitalPickerMap').setView([lat, lng], 12);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(pickerMap);
        
        // التقاط ضغطة الماوس (Click Event)
        pickerMap.on('click', function(e) {
            setPickerMarker(e.latlng.lat, e.latlng.lng);
        });
    } else {
        pickerMap.setView([lat, lng], 12);
    }
    
    setPickerMarker(lat, lng);

    // سر مهم جداً: الخريطة بتتشوه لو اتفتحت داخل Modal مخفي، الـ invalidateSize بيعالج ده
    setTimeout(() => {
        pickerMap.invalidateSize();
    }, 250); 
}

function setPickerMarker(lat, lng) {
    if (pickerMarker) pickerMap.removeLayer(pickerMarker);
    pickerMarker = L.marker([lat, lng]).addTo(pickerMap);
    
    // تحديث الحقول النصية أسفل الخريطة
    document.getElementById('hospLat').value = lat.toFixed(7);
    document.getElementById('hospLng').value = lng.toFixed(7);
}

// ==========================================
// 4. العمليات الإدارية (Add, Edit, Delete)
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

    // فتح الخريطة على منتصف القاهرة كافتراضي
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
    document.getElementById('hospUserId').value = hosp.user_id;

    document.getElementById('hospitalModalTitle').innerText = 'Edit Hospital';
    
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        modal.children[0].classList.remove('scale-95');
    }, 10);

    // فتح الخريطة على موقع المستشفى الحالي
    initPickerMap(hosp.lat || 30.0444, hosp.lng || 31.2357);
};

window.closeHospitalModal = function() {
    modal.classList.add('opacity-0');
    modal.children[0].classList.add('scale-95');
    setTimeout(() => { modal.classList.add('hidden'); }, 300);
};

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('saveHospBtn');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    btn.disabled = true;

    const id = document.getElementById('hospId').value;
    const hospData = {
        name: document.getElementById('hospName').value,
        governorate: document.getElementById('hospGov').value,
        city: document.getElementById('hospCity').value,
        phone: document.getElementById('hospPhone').value,
        available_beds: parseInt(document.getElementById('hospBeds').value),
        user_id: document.getElementById('hospUserId').value, // ضروري لربطه بالحساب
        lat: parseFloat(document.getElementById('hospLat').value),
        lng: parseFloat(document.getElementById('hospLng').value),
        country: 'Egypt'
    };

    try {
        if (id) {
            const { error } = await supabase.from(DB_TABLES.HOSPITALS).update(hospData).eq('id', id);
            if (error) throw error;
        } else {
            const { error } = await supabase.from(DB_TABLES.HOSPITALS).insert([hospData]);
            if (error) throw error;
        }
        
        closeHospitalModal();
        window.loadHospitalsData();
    } catch (error) {
        alert("Operation Failed: " + error.message);
    } finally {
        btn.innerHTML = 'Save Hospital';
        btn.disabled = false;
    }
});

window.deleteHospital = async function(id) {
    if(confirm("Are you sure you want to remove this hospital from the network?")) {
        const { error } = await supabase.from(DB_TABLES.HOSPITALS).delete().eq('id', id);
        if(error) alert("Deletion Failed: " + error.message);
        else window.loadHospitalsData();
    }
};