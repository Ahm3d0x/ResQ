import { supabase, DB_TABLES } from '../config/supabase.js';

const tbody = document.getElementById('usersTableBody');
const userForm = document.getElementById('userForm');

let allUsers = []; 

// ==========================================
// 🛡️ استخراج بيانات المدير الحالي من الجلسة
// ==========================================
const sessionString = localStorage.getItem('resq_custom_session');
const currentAdmin = sessionString ? JSON.parse(sessionString) : null;
const currentAdminId = currentAdmin ? currentAdmin.id : null;

// ==========================================
// 📝 دالة تسجيل تحركات النظام (Audit Logger)
// ==========================================
async function logSystemAction(action, targetTable, targetId, note) {
    if (!currentAdminId) return;
    try {
        await supabase.from('audit_admin_changes').insert([{
            admin_user_id: currentAdminId,
            action: action,           // 'CREATE', 'UPDATE', 'DELETE'
            target_table: targetTable, // 'users'
            target_id: targetId,       // ID of the modified user
            note: note                 // التفاصيل
        }]);
    } catch (error) {
        console.error("Audit Log Failed:", error);
    }
}

// ==========================================
// 1. جلب البيانات من الخادم
// ==========================================
window.loadUsersData = async function() {
    tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-gray-500"><i class="fa-solid fa-circle-notch fa-spin text-2xl"></i> Loading...</td></tr>';
    
    const { data, error } = await supabase.from(DB_TABLES.USERS).select('*').order('id', { ascending: false });
    
    if (error) {
        window.showToast("Failed to load users data.", "error");
        return;
    }

    allUsers = data;
    applyFilters(); 
};

// ==========================================
// 2. نظام الفلترة والبحث اللحظي
// ==========================================
function applyFilters() {
    const searchTerm = document.getElementById('userSearchInput')?.value.toLowerCase() || "";
    const roleTerm = document.getElementById('roleFilter')?.value || "";
    const statusTerm = document.getElementById('statusFilter')?.value || "";

    const filteredUsers = allUsers.filter(u => {
        const matchesSearch = u.name.toLowerCase().includes(searchTerm) || 
                              u.email.toLowerCase().includes(searchTerm) || 
                              u.id.toString().includes(searchTerm) ||
                              (u.phone && u.phone.includes(searchTerm));
                              
        const matchesRole = roleTerm === "" || u.role === roleTerm;
        const matchesStatus = statusTerm === "" || u.is_active.toString() === statusTerm;

        return matchesSearch && matchesRole && matchesStatus;
    });

    renderUsersTable(filteredUsers);
}

document.getElementById('userSearchInput')?.addEventListener('input', applyFilters);
document.getElementById('roleFilter')?.addEventListener('change', applyFilters);
document.getElementById('statusFilter')?.addEventListener('change', applyFilters);

// ==========================================
// 3. رسم الجدول (مع حماية بيانات المديرين)
// ==========================================
function renderUsersTable(usersData) {
    if (usersData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-gray-500 font-bold">No users match your criteria.</td></tr>';
        return;
    }

    tbody.innerHTML = usersData.map(u => {
        let roleColor = u.role === 'admin' ? 'bg-purple-500/20 text-purple-500 border-purple-500/30' : 
                        u.role === 'hospital' ? 'bg-blue-500/20 text-blue-500 border-blue-500/30' : 
                        u.role === 'driver' ? 'bg-green-500/20 text-green-500 border-green-500/30' : 'bg-gray-500/20 text-gray-500 border-gray-500/30';
        
        // 🛡️ التحقق من الصلاحيات (Authorization Check)
        const isSelf = u.id === currentAdminId;
        const isOtherAdmin = u.role === 'admin' && !isSelf;

        let actionButtons = '';
        if (isOtherAdmin) {
            // أدمن آخر: يمكنه المشاهدة فقط، التعديل والحذف محظور
            actionButtons = `
                <button onclick="viewUserDetails(${u.id})" class="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-800 hover:bg-blue-500 hover:text-white rounded-lg transition-colors"><i class="fa-solid fa-eye text-xs"></i></button>
                <span class="text-[10px] font-bold text-red-500 bg-red-500/10 border border-red-500/20 px-2 py-1 rounded cursor-not-allowed ml-2" title="Restricted: Cannot edit other Admins">Restricted</span>
            `;
        } else {
            // مستخدم عادي، مستشفى، سائق، أو نفس الأدمن الحالي
            actionButtons = `
                <button onclick="viewUserDetails(${u.id})" class="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-800 hover:bg-blue-500 hover:text-white rounded-lg transition-colors shadow-sm" title="View Details"><i class="fa-solid fa-eye text-xs"></i></button>
                <button onclick="editUser(${u.id})" class="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-800 hover:bg-warning hover:text-white rounded-lg transition-colors shadow-sm" title="Edit"><i class="fa-solid fa-pen text-xs"></i></button>
                <button onclick="deleteUser(${u.id})" class="w-8 h-8 flex items-center justify-center bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-colors shadow-sm ${isSelf ? 'hidden' : ''}" title="Delete"><i class="fa-solid fa-trash text-xs"></i></button>
            `;
        }
                        
        return `
        <tr class="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors border-b border-gray-100 dark:border-white/5">
            <td class="p-4 font-mono text-xs text-gray-500 dark:text-gray-400">#${u.id}</td>
            <td class="p-4 font-bold text-gray-800 dark:text-white">
                ${u.name} ${isSelf ? '<span class="ml-2 text-[9px] bg-blue-500/20 text-blue-500 px-1.5 py-0.5 rounded uppercase">You</span>' : ''}
            </td>
            <td class="p-4 text-xs text-gray-600 dark:text-gray-300">${u.email}</td>
            <td class="p-4 font-mono text-xs text-gray-600 dark:text-gray-300">${u.phone || '-'}</td>
            <td class="p-4"><span class="px-2 py-1 rounded-md border text-[10px] font-bold uppercase tracking-wider ${roleColor}">${u.role}</span></td>
            <td class="p-4">
                <span class="flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full ${u.is_active ? 'bg-success' : 'bg-red-500'}"></span>
                    <span class="text-xs font-bold ${u.is_active ? 'text-success' : 'text-red-500'}">${u.is_active ? 'Active' : 'Suspended'}</span>
                </span>
            </td>
            <td class="p-4">
                <div class="flex items-center justify-center gap-2">
                    ${actionButtons}
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

// ==========================================
// 4. العمليات الإدارية (View, Add, Edit, Delete)
// ==========================================

window.viewUserDetails = async function(id) {
    const user = allUsers.find(u => u.id === id);
    if (!user) return;

    // 1. تعبئة البيانات الأساسية
    document.getElementById('viewUserName').innerText = user.name;
    document.getElementById('viewUserEmail').innerText = user.email;
    document.getElementById('viewUserPhone').innerText = user.phone || 'غير محدد';
    document.getElementById('viewUserRole').innerText = user.role.toUpperCase();
    
    const statusSpan = document.getElementById('viewUserStatus');
    statusSpan.innerText = user.is_active ? 'نشط' : 'موقوف';
    statusSpan.className = user.is_active 
        ? 'px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-500' 
        : 'px-3 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-500';

    // 2. إظهار النافذة
    const modal = document.getElementById('viewUserDetailsModal');
    modal.classList.remove('hidden');
    setTimeout(() => { modal.classList.remove('opacity-0'); modal.children[0].classList.remove('scale-95'); }, 10);

    // 3. جلب البيانات المتقدمة إذا كان حساب "عميل/مستخدم عادي"
    const extraDetailsContainer = document.getElementById('viewUserExtraDetails');
    if (!extraDetailsContainer) return;

    if (user.role === 'user') {
        extraDetailsContainer.innerHTML = `<div class="p-8 text-center text-gray-500"><i class="fa-solid fa-circle-notch fa-spin text-2xl text-primary mb-2"></i><br>جاري جلب الملف الشامل للعميل...</div>`;
        extraDetailsContainer.classList.remove('hidden');

        try {
            // أ. جلب بيانات التقديم الطبية والمركبة
            const { data: appData } = await supabase
                .from('device_applications')
                .select('*')
                .eq('email', user.email)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            // ب. جلب الأجهزة المرتبطة بهذا العميل
            const { data: devices } = await supabase
                .from('devices')
                .select('id, device_uid, car_plate')
                .eq('user_id', user.id);

            let incidentHtml = '';
            let deviceHtml = '<span class="text-gray-500">لا توجد أجهزة نشطة</span>';

            if (devices && devices.length > 0) {
                const devIds = devices.map(d => d.id);
                deviceHtml = devices.map(d => `<span class="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-xs font-mono mr-2">${d.device_uid}</span>`).join('');

                // ج. جلب آخر حادثة مسجلة لأجهزة العميل
                const { data: incidents } = await supabase
                    .from('incidents')
                    .select('*, ambulances(code), hospitals(name)')
                    .in('device_id', devIds)
                    .order('created_at', { ascending: false })
                    .limit(1);

                if (incidents && incidents.length > 0) {
                    const inc = incidents[0];
                    let statusColor = inc.status === 'completed' ? 'text-green-600' : 'text-orange-500';
                    incidentHtml = `
                        <div class="mt-4 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-xl p-4">
                            <h4 class="text-sm font-black text-red-600 mb-3"><i class="fa-solid fa-car-burst"></i> آخر بلاغ حادث مسجل</h4>
                            <div class="grid grid-cols-2 gap-3 text-xs">
                                <div><span class="text-gray-500">حالة البلاغ:</span> <b class="${statusColor} uppercase">${inc.status}</b></div>
                                <div><span class="text-gray-500">التاريخ:</span> <b>${new Date(inc.created_at).toLocaleString()}</b></div>
                                <div><span class="text-gray-500">الإسعاف الموجه:</span> <b>${inc.ambulances ? inc.ambulances.code : 'لم يتم التوجيه'}</b></div>
                                <div><span class="text-gray-500">المستشفى الموجه:</span> <b>${inc.hospitals ? inc.hospitals.name : 'لم يتم التوجيه'}</b></div>
                            </div>
                        </div>
                    `;
                }
            }

            // رسم البيانات الطبية والطارئة
            let appHtml = '';
            if (appData) {
                appHtml = `
                    <div class="space-y-4">
                        <div class="bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
                            <h4 class="text-sm font-black text-blue-600 mb-3"><i class="fa-solid fa-notes-medical"></i> السجل الطبي</h4>
                            <div class="grid grid-cols-2 gap-3 text-xs">
                                <div><span class="text-gray-500 block">فصيلة الدم:</span> <b class="text-red-600 text-sm">${appData.blood_type || 'غير محدد'}</b></div>
                                <div><span class="text-gray-500 block">الأمراض المزمنة:</span> <b>${appData.medical_conditions || 'لا يوجد'}</b></div>
                                <div><span class="text-gray-500 block">حساسية ضد:</span> <b>${appData.allergies || 'لا يوجد'}</b></div>
                                <div><span class="text-gray-500 block">الأدوية الحالية:</span> <b>${appData.medications || '-'}</b></div>
                            </div>
                        </div>

                        <div class="bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-800 rounded-xl p-4">
                            <h4 class="text-sm font-black text-orange-600 mb-3"><i class="fa-solid fa-phone-volume"></i> جهات اتصال الطوارئ</h4>
                            <div class="grid grid-cols-2 gap-3 text-xs">
                                <div><span class="text-gray-500 block">جهة 1 (${appData.emergency1_relation}):</span> <b>${appData.emergency1_name}</b><br><span class="font-mono text-blue-600">${appData.emergency1_phone}</span></div>
                                <div><span class="text-gray-500 block">جهة 2 (${appData.emergency2_relation || '-'}):</span> <b>${appData.emergency2_name || '-'}</b><br><span class="font-mono text-blue-600">${appData.emergency2_phone || '-'}</span></div>
                            </div>
                        </div>

                        <div class="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                            <h4 class="text-sm font-black mb-3"><i class="fa-solid fa-car"></i> بيانات المركبات المسجلة</h4>
                            <div class="grid grid-cols-2 gap-3 text-xs">
                                <div><span class="text-gray-500 block">المركبة في الطلب:</span> <b>${appData.car_brand} ${appData.car_model} (${appData.car_year})</b></div>
                                <div><span class="text-gray-500 block">رقم اللوحة:</span> <b>${appData.car_plate}</b></div>
                                <div class="col-span-2"><span class="text-gray-500 block mb-1">الأجهزة المرتبطة حالياً (UIDs):</span> ${deviceHtml}</div>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                appHtml = `<div class="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl text-center text-xs text-gray-500">لم يتم العثور على بيانات تقديم مفصلة لهذا المستخدم.</div>`;
            }

            // دمج كل المحتوى داخل النافذة
            extraDetailsContainer.innerHTML = appHtml + incidentHtml;

        } catch (err) {
            console.error(err);
            extraDetailsContainer.innerHTML = `<div class="p-4 text-center text-red-500 text-xs">حدث خطأ أثناء جلب الملف الشامل.</div>`;
        }
    } else {
        // إخفاء الحاوية تماماً لو الحساب لمدير أو مستشفى أو إسعاف
        extraDetailsContainer.classList.add('hidden');
        extraDetailsContainer.innerHTML = '';
    }
};

window.openUserModal = function() {
    document.getElementById('userForm').reset();
    document.getElementById('userId').value = ''; 
    document.getElementById('userModalTitle').innerText = 'Add New User';
    document.getElementById('saveUserBtn').innerText = 'Save User';
    document.getElementById('userPassword').required = true; 
    
    const m = document.getElementById('userModal');
    m.classList.remove('hidden');
    setTimeout(() => { m.classList.remove('opacity-0'); m.children[0].classList.remove('scale-95'); }, 10);
};

window.editUser = function(id) {
    const user = allUsers.find(u => u.id === id);
    if(!user) return;

    // 🛡️ حماية إضافية قبل فتح النافذة
    if (user.role === 'admin' && user.id !== currentAdminId) {
        window.showToast("Unauthorized: Cannot edit other administrators.", "error");
        return;
    }

    document.getElementById('userId').value = user.id;
    document.getElementById('userName').value = user.name;
    document.getElementById('userEmail').value = user.email;
    document.getElementById('userPhone').value = user.phone || '';
    document.getElementById('userRole').value = user.role;
    
    const pwdInput = document.getElementById('userPassword');
    pwdInput.value = ''; pwdInput.required = false; pwdInput.placeholder = "Leave blank to keep current";

    document.getElementById('userModalTitle').innerText = 'Edit User Profile';
    document.getElementById('saveUserBtn').innerText = 'Update User';

    const m = document.getElementById('userModal');
    m.classList.remove('hidden');
    setTimeout(() => { m.classList.remove('opacity-0'); m.children[0].classList.remove('scale-95'); }, 10);
};

userForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('saveUserBtn');
    const originalText = btn.innerText;

    const id = document.getElementById('userId').value;
    const userData = {
        name: document.getElementById('userName').value,
        email: document.getElementById('userEmail').value,
        phone: document.getElementById('userPhone').value,
        role: document.getElementById('userRole').value,
        is_active: document.getElementById('userStatus').value === 'true',
        lang: document.getElementById('userLang').value
    };

    const password = document.getElementById('userPassword').value;
    if (!id && !password) {
        window.showToast("كلمة المرور مطلوبة للمستخدمين الجدد.", "error");
        return;
    }
    if (password) userData.password_hash = password;

    try {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
        btn.disabled = true;

        // 🛡️ منع تكرار البريد الإلكتروني (Email)
        if (userData.email) {
            const { data: duplicateEmail } = await supabase
                .from(DB_TABLES.USERS)
                .select('id')
                .eq('email', userData.email)
                .neq('id', id || -1);

            if (duplicateEmail && duplicateEmail.length > 0) {
                window.showToast("البريد الإلكتروني مستخدم بالفعل لحساب آخر.", "error");
                return; // إيقاف الحفظ
            }
        }

        if (id) {
            const { error } = await supabase.from(DB_TABLES.USERS).update(userData).eq('id', id);
            if (error) throw error;
            window.showToast('تم تعديل بيانات المستخدم بنجاح!', 'success');
            await logSystemAction('UPDATE', 'users', id, `Updated user ${userData.email}`);
        } else {
            const { data, error } = await supabase.from(DB_TABLES.USERS).insert([userData]).select().single();
            if (error) throw error;
            window.showToast('تم إنشاء المستخدم بنجاح!', 'success');
            await logSystemAction('CREATE', 'users', data.id, `Created new user ${userData.email} with role ${userData.role}`);
        }
        
        window.closeDetailsModal('userModal');
        await window.loadUsersData(); 
    } catch (error) {
        window.showToast("فشلت العملية: " + error.message, "error");
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
});

// ==========================================
// 🛡️ استخدام نافذة التأكيد المخصصة للحذف بدلاً من confirm()
// ==========================================
window.deleteUser = async function(id) {
    const user = allUsers.find(u => u.id === id);
    if (!user) return;

    // حماية إضافية للحذف
    if (user.role === 'admin' && user.id !== currentAdminId) {
        window.showToast("غير مصرح: لا يمكنك حذف مدراء آخرين.", "error");
        return;
    }
    
    if (user.id === currentAdminId) {
        window.showToast("لا يمكنك حذف حسابك الحالي أثناء تسجيل الدخول.", "error");
        return;
    }

    // استدعاء نافذة النظام المخصصة للحذف
    window.openConfirmModal(
        "حذف مستخدم", 
        `هل أنت متأكد من حذف المستخدم (${user.name}) نهائياً؟ لا يمكن التراجع عن هذا الإجراء.`, 
        async () => {
            const { error } = await supabase.from(DB_TABLES.USERS).delete().eq('id', id);
            if(error) {
                window.showToast("فشل الحذف: " + error.message, "error");
            } else {
                await logSystemAction('DELETE', 'users', id, `Deleted user: ${user.email}`);
                window.showToast('تم حذف المستخدم بنجاح.', 'success');
                await window.loadUsersData();
            }
        }
    );
};