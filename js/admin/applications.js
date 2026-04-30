import { supabase, DB_TABLES } from '../config/supabase.js';
import { t } from '../core/language.js';
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
const tbody = document.getElementById('applicationsTableBody');
let allApps = [];

window.openInputModal = function(title, desc, onConfirm, isDanger = false) {
    document.getElementById('inputModalTitle').innerText = title;
    document.getElementById('inputModalDesc').innerText = desc;
    document.getElementById('customInputTextarea').value = '';
    
    const btn = document.getElementById('confirmInputBtn');
    btn.className = `px-5 py-2.5 text-white font-bold rounded-xl transition-colors shadow-lg ${isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`;
    
    btn.onclick = () => { 
        const val = document.getElementById('customInputTextarea').value.trim();
        closeInputModal(); 
        onConfirm(val); 
    };
    
    const m = document.getElementById('customInputModal');
    m.classList.remove('hidden');
    setTimeout(() => { m.classList.remove('opacity-0'); m.children[0].classList.remove('scale-95'); }, 10);
};

window.closeInputModal = function() {
    const m = document.getElementById('customInputModal');
    m.classList.add('opacity-0'); m.children[0].classList.add('scale-95');
    setTimeout(() => { m.classList.add('hidden'); }, 300);
};

// ==========================================
// 1. تحميل وعرض البيانات (مع دعم الترجمة)
// ==========================================
window.loadApplicationsData = async function() {
    if(!tbody) return;
    
    // إظهار حالة التحميل مع الترجمة
    tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-gray-500"><i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br>${t('loading') || 'Loading applications...'}</td></tr>`;

    const { data, error } = await supabase
        .from('device_applications')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        window.showToast("Error loading applications: " + error.message, "error");
        tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-red-500 font-bold">Failed to load data.</td></tr>`;
        return;
    }

    allApps = data || [];
    renderApplications();
};

// دالة رسم الجدول
function renderApplications() {
    if(!tbody) return;
    tbody.innerHTML = '';

    if(allApps.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-gray-500 font-bold">${t('noData') || 'No applications found.'}</td></tr>`;
        return;
    }

    allApps.forEach(app => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 dark:hover:bg-white/5 transition-colors border-b border-gray-100 dark:border-white/5';
        
        // 🌟 الترجمة اللحظية للحالة باستخدام t()
        const statusText = t('status_' + app.status) || app.status;
        
        // تحديد لون الحالة
        let badgeClass = 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-500';
        if (app.status === 'approved') badgeClass = 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-500';
        if (app.status === 'rejected') badgeClass = 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-500';

        tr.innerHTML = `
            <td class="p-4 font-bold text-primary">#${app.id}</td>
            <td class="p-4 font-bold text-gray-800 dark:text-white">${app.full_name}</td>
            <td class="p-4">
                <div class="text-sm font-bold">${app.car_brand} ${app.car_model}</div>
                <div class="text-xs text-gray-500">${app.car_plate}</div>
            </td>
            <td class="p-4">
                <span class="px-3 py-1 rounded-full text-xs font-bold ${badgeClass}">${statusText}</span>
            </td>
            <td class="p-4">
                <button onclick="viewApplication(${app.id})" class="text-blue-500 hover:text-blue-700 font-bold px-3 py-1 bg-blue-50 dark:bg-blue-900/20 rounded-lg transition-colors">
                    <i class="fa-solid fa-eye"></i> ${t('view') || 'View'}
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}
window.addEventListener('languageChanged', () => {
    applyAppFilters();
});

function applyAppFilters() {
    const term = document.getElementById('appSearchInput')?.value.toLowerCase() || "";
    const statusTerm = document.getElementById('appStatusFilter')?.value || "";

    const filtered = allApps.filter(a => {
        const matchesSearch = a.full_name.toLowerCase().includes(term) || 
                              a.email.toLowerCase().includes(term) || 
                              a.phone.includes(term) ||
                              a.car_plate.toLowerCase().includes(term);
        const matchesStatus = statusTerm === "" || a.status === statusTerm;
        return matchesSearch && matchesStatus;
    });
    renderAppsTable(filtered);
}

document.getElementById('appSearchInput')?.addEventListener('input', applyAppFilters);
document.getElementById('appStatusFilter')?.addEventListener('change', applyAppFilters);

function renderAppsTable(data) {
    if(!tbody) return;
    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-gray-500 font-bold">No applications found.</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(a => {
        let statusBadge = '';
        if(a.status === 'pending') statusBadge = `<span class="px-2 py-1 rounded bg-orange-500/20 text-orange-600 border border-orange-500/30 font-bold text-[10px] uppercase">${t('pending')}</span>`;
        else if(a.status === 'approved') statusBadge = `<span class="px-2 py-1 rounded bg-success/20 text-success border border-success/30 font-bold text-[10px] uppercase">${t('approved')}</span>`;
        else if(a.status === 'rejected') statusBadge = `<span class="px-2 py-1 rounded bg-red-500/20 text-red-500 border border-red-500/30 font-bold text-[10px] uppercase">${t('rejected')}</span>`;
        else statusBadge = `<span class="px-2 py-1 rounded bg-gray-500/20 text-gray-500 border border-gray-500/30 font-bold text-[10px] uppercase">${t('suspended')}</span>`;

        return `
        <tr class="hover:bg-gray-50 dark:hover:bg-white/5 border-b border-gray-100 dark:border-white/5 transition-colors">
            <td class="p-4 font-mono text-xs text-gray-500">#APP-${a.id}</td>
            <td class="p-4 text-sm text-gray-600 dark:text-gray-300">
                <div class="font-bold text-gray-800 dark:text-white">${a.full_name}</div>
                <div class="text-[10px] text-gray-500 font-mono">${a.phone}</div>
            </td>
            <td class="p-4">
                <div class="text-xs font-bold text-gray-700 dark:text-gray-200">${a.car_brand} ${a.car_model}</div>
                <div class="text-[10px] font-mono text-blue-500 font-bold tracking-widest mt-1">${a.car_plate}</div>
            </td>
            <td class="p-4 text-center font-mono text-xs text-gray-500">${new Date(a.created_at).toLocaleDateString()}</td>
            <td class="p-4 text-center">${statusBadge}</td>
            <td class="p-4 text-center">
                <button onclick="viewApplication(${a.id})" class="w-8 h-8 inline-flex items-center justify-center bg-gray-100 dark:bg-gray-800 hover:bg-orange-500 hover:text-white rounded-lg transition-colors"><i class="fa-solid fa-eye text-xs"></i></button>
            </td>
        </tr>`;
    }).join('');
}

window.viewApplication = function(id) {
    const app = allApps.find(x => x.id === id); if(!app) return;

    let content = `
        <div class="grid md:grid-cols-2 gap-6">
            <div class="space-y-2">
                <h4 class="font-bold text-primary border-b dark:border-gray-700 pb-1 mb-2">${t('applicantInfo')}</h4>
                <div class="flex justify-between"><span class="text-gray-500 text-xs">${t('fullName')}:</span> <span class="font-bold dark:text-white">${app.full_name}</span></div>
                <div class="flex justify-between"><span class="text-gray-500 text-xs">${t('email')}:</span> <span class="dark:text-white">${app.email}</span></div>
                <div class="flex justify-between"><span class="text-gray-500 text-xs">${t('phone')}:</span> <span class="font-mono dark:text-white">${app.phone}</span></div>
                <div class="flex justify-between"><span class="text-gray-500 text-xs">${t('nationalId')}:</span> <span class="font-mono dark:text-white">${app.national_id}</span></div>
                <div class="flex justify-between"><span class="text-gray-500 text-xs">${t('location')}:</span> <span class="dark:text-white text-xs text-right">${app.city}, ${app.governorate}<br>${app.address}</span></div>
            </div>
            
            <div class="space-y-2">
                <h4 class="font-bold text-blue-500 border-b dark:border-gray-700 pb-1 mb-2">${t('vehicleDetails')}</h4>
                <div class="flex justify-between"><span class="text-gray-500 text-xs">${t('carBrand')}:</span> <span class="font-bold dark:text-white">${app.car_brand} ${app.car_model} (${app.car_year})</span></div>
                <div class="flex justify-between"><span class="text-gray-500 text-xs">${t('carPlate')}:</span> <span class="font-mono font-bold dark:text-white uppercase">${app.car_plate}</span></div>
                <div class="flex justify-between"><span class="text-gray-500 text-xs">${t('carColor')}:</span> <span class="dark:text-white">${app.car_color}</span></div>
                <div class="flex justify-between"><span class="text-gray-500 text-xs">${t('fuelType')}:</span> <span class="dark:text-white">${app.fuel_type || 'N/A'}</span></div>
            </div>

            <div class="col-span-2 space-y-2">
                <h4 class="font-bold text-orange-500 border-b dark:border-gray-700 pb-1 mb-2">${t('emergContacts')}</h4>
                <div class="grid grid-cols-2 gap-4 bg-gray-50 dark:bg-white/5 p-3 rounded-lg">
                    <div>
                        <div class="text-xs text-gray-400 mb-1">Contact 1</div>
                        <div class="font-bold dark:text-white">${app.emergency1_name} <span class="text-[10px] text-gray-500">(${app.emergency1_relation})</span></div>
                        <div class="font-mono text-xs dark:text-gray-300">${app.emergency1_phone}</div>
                    </div>
                    ${app.emergency2_name ? `
                    <div>
                        <div class="text-xs text-gray-400 mb-1">Contact 2</div>
                        <div class="font-bold dark:text-white">${app.emergency2_name} <span class="text-[10px] text-gray-500">(${app.emergency2_relation})</span></div>
                        <div class="font-mono text-xs dark:text-gray-300">${app.emergency2_phone}</div>
                    </div>` : ''}
                </div>
            </div>

            <div class="col-span-2 space-y-2">
                <h4 class="font-bold text-purple-500 border-b dark:border-gray-700 pb-1 mb-2">${t('medicalInfo')}</h4>
                <div class="flex gap-4">
                    <div class="bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg text-center"><div class="text-[10px] text-red-500 font-bold uppercase">${t('bloodType')}</div><div class="font-black text-red-600 dark:text-red-400 text-lg">${app.blood_type || '?'}</div></div>
                    <div class="flex-1 text-xs space-y-1">
                        <div class="flex justify-between"><span class="text-gray-500">${t('chronicDis')}:</span> <span class="dark:text-white font-bold">${app.medical_conditions || 'None'}</span></div>
                        <div class="flex justify-between"><span class="text-gray-500">${t('allergies')}:</span> <span class="dark:text-white font-bold">${app.allergies || 'None'}</span></div>
                        <div class="flex justify-between"><span class="text-gray-500">${t('medications')}:</span> <span class="dark:text-white font-bold">${app.medications || 'None'}</span></div>
                    </div>
                </div>
            </div>
            
            ${app.rejection_reason ? `
            <div class="col-span-2 mt-2 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg">
                <span class="text-xs font-bold text-red-600 dark:text-red-400">${t('adminNote')}:</span>
                <p class="text-sm text-red-800 dark:text-red-300 mt-1">${app.rejection_reason}</p>
            </div>` : ''}
        </div>
    `;

    document.getElementById('viewAppContent').innerHTML = content;

    let actionsHtml = `<button type="button" onclick="closeDetailsModal('viewAppModal')" class="px-5 py-2 text-sm font-bold bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-white rounded-lg transition-colors">${t('close')}</button>`;
    
    if (app.status === 'pending' || app.status === 'suspended') {
        actionsHtml = `
            <button onclick="processAppStatus(${app.id}, 'rejected')" class="px-4 py-2 text-sm font-bold text-red-500 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 rounded-lg transition-colors">${t('btnReject')}</button>
            <button onclick="processAppStatus(${app.id}, 'suspended')" class="px-4 py-2 text-sm font-bold text-gray-500 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors ${app.status === 'suspended' ? 'hidden' : ''}">${t('btnSuspend')}</button>
            <div class="flex-1"></div>
            ${actionsHtml}
            <button onclick="approveApplication(${app.id})" class="px-6 py-2 text-sm font-bold bg-success hover:bg-emerald-600 text-white rounded-lg shadow-md transition-colors flex items-center gap-2"><i class="fa-solid fa-check"></i> ${t('btnApproveGen')}</button>
        `;
    }

    document.getElementById('viewAppActions').innerHTML = actionsHtml;

    const m = document.getElementById('viewAppModal'); m.classList.remove('hidden');
    setTimeout(() => { m.classList.remove('opacity-0'); m.children[0].classList.remove('scale-95'); }, 10);
};


async function sendAppEmail(appData, type, extraData = {}) {
    const serviceID = "service_j22noer"; 
    
    let templateID = "";
    let templateParams = {
        to_name: appData.full_name,
        to_email: appData.email,
        app_id: appData.id
    };

    if (type === 'approved') {
        templateID = "template_l1egc0w"; 
        templateParams.password = extraData.password; 
        templateParams.login_url = window.location.origin + "/pages/login.html"; 
    } else if (type === 'rejected') {
        templateID = "template_79afdrq"; 
        templateParams.reason = extraData.reason;
        templateParams.message = `
            <div dir="rtl" style="font-family: Arial, sans-serif; text-align: center; background: #0f172a; padding: 40px; color: white; border-radius: 10px;">
                <h1 style="color: #ef4444;">تم رفض طلبك</h1>
                <p style="font-size: 16px; color: #cbd5e1;">مرحباً ${appData.full_name}، نأسف لإبلاغك بأنه تم رفض طلب انضمامك لشبكة إنقاذ للأسباب التالية:</p>
                <div style="background: rgba(239, 68, 68, 0.1); padding: 20px; border: 1px solid #ef4444; border-radius: 10px; margin: 20px auto; max-width: 500px; color: #fca5a5; font-weight: bold;">
                    ${extraData.reason}
                </div>
            </div>
        `;
    }

    try {
        await emailjs.send(
            serviceID, 
            templateID, 
            templateParams, 
            "YKJgvPCGxkJif7-o3" // <-- تم وضع المفتاح العام الصحيح هنا
        );
        console.log(`Email sent successfully for app ${appData.id}`);
    } catch (error) {
        console.error("Failed to send email:", error);
    }
}
// --- تعديل دالة القبول ---
window.approveApplication = async function(id) {
    const app = allApps.find(a => a.id === id);
    if(!app) return;

    const confirmMsg = document.documentElement.dir === 'rtl' 
        ? `بالموافقة سيتم إنشاء حساب مستخدم لـ ${app.full_name} وتسجيل جهاز للسيارة ${app.car_plate} وإرسال إيميل ببيانات الدخول. هل ترغب بالاستمرار؟`
        : `Approving will automatically create a user account for ${app.full_name}, register device for vehicle ${app.car_plate}, and send credentials via email. Proceed?`;

    // استخدام 'success' لتغيير شكل النافذة للأخضر
    window.openConfirmModal(
        t('btnApproveGen') || "Approve Application", 
        confirmMsg, 
        async () => {
            try {
                // 1. Generate Auth Data (using ENQ Prefix)
                const pwd = "ENQ" + Math.random().toString(36).slice(-5).toUpperCase();
                
                // 2. Insert into Users Table
                const { data: newUser, error: uErr } = await supabase.from(DB_TABLES.USERS).insert({
                    name: app.full_name,
                    email: app.email,
                    phone: app.phone,
                    role: 'user',
                    password_hash: pwd // هذا هو الباسورد الذي سيتم إرساله للإيميل
                }).select().single();
                if(uErr) throw uErr;

                // 3. Generate Device UID
                const devUid = "ENQ-" + new Date().getFullYear().toString().slice(-2) + "-" + Math.floor(10000 + Math.random() * 90000);
                const { error: dErr } = await supabase.from(DB_TABLES.DEVICES).insert({
                    device_uid: devUid,
                    user_id: newUser.id,
                    application_id: app.id,
                    car_plate: app.car_plate,
                    car_model: `${app.car_brand} ${app.car_model}`
                });
                if(dErr) throw dErr;

                // 4. Update Application Status
const { error: aErr } = await supabase.from('device_applications').update({
    status: 'approved',
    // reviewed_by: adminId,  <-- Remove or comment out this line
    reviewed_at: new Date()
}).eq('id', id);
                if(aErr) throw aErr;

                // 5. إرسال الإيميل للمستخدم ببيانات الدخول
                await sendAppEmail(app, 'approved', { password: pwd });
// تسجيل حركة القبول وإنشاء الأجهزة
                await logSystemAction('UPDATE', 'device_applications', id, `Approved application for: ${app.full_name}, Device: ${devUid} created`);
                window.showToast(`Success! Device ${devUid} provisioned. Email sent.`, 'success');
                window.closeDetailsModal('viewAppModal');
                await loadApplicationsData();

            } catch (error) {
                window.showToast("Approval workflow failed: " + error.message, "error");
            }
        }, 
        'success', // تمرير نوع النافذة ليكون أخضر
        t('btnApproveGen') || "Approve" // تغيير نص الزر
    );
};

window.processAppStatus = function(id, newStatus) {
    const isReject = newStatus === 'rejected';
    const title = isReject ? t('btnReject') : t('btnSuspend');
    const desc = isReject ? "Please provide a reason for rejecting this application." : "Please provide a reason for requesting more info/suspending.";

    window.openInputModal(title, desc, async (reason) => {
        try {
            const sessionString = localStorage.getItem('resq_custom_session');
            const adminId = sessionString ? JSON.parse(sessionString).id : null;

            const { error } = await supabase.from('device_applications').update({
                status: newStatus,
                rejection_reason: reason || null,
                // reviewed_by: adminId, 
                reviewed_at: new Date()
            }).eq('id', id);

            if(error) throw error;

            // 🌟 الكود الذي كان مفقوداً: إرسال إيميل الرفض 🌟
            if (isReject) {
                const app = allApps.find(a => a.id === id);
                if (app) {
                    await sendAppEmail(app, 'rejected', { reason: reason || 'لا يستوفي الشروط حالياً' });
                }
            }
// تسجيل الحركة
            await logSystemAction('UPDATE', 'device_applications', id, `Marked application #${id} as ${newStatus}. Reason: ${reason || 'None'}`);
            window.showToast(`Application marked as ${newStatus}.`, 'success');
            window.closeDetailsModal('viewAppModal');
            await loadApplicationsData();

        } catch (error) {
            window.showToast("Status update failed: " + error.message, "error");
        }
    }, isReject);
};