import { supabase, DB_TABLES } from '../config/supabase.js';

const tbody = document.getElementById('usersTableBody');
const userModal = document.getElementById('userModal');
const userForm = document.getElementById('userForm');
const viewDetailsModal = document.getElementById('viewDetailsModal');

let allUsers = []; // تخزين محلي للبيانات للفلترة السريعة

// ==========================================
// 1. جلب البيانات من الخادم
// ==========================================
window.loadUsersData = async function() {
    tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-gray-500"><i class="fa-solid fa-circle-notch fa-spin text-2xl"></i></td></tr>';
    
    const { data, error } = await supabase.from(DB_TABLES.USERS).select('*').order('id', { ascending: false });
    
    if (error) {
        console.error("Error loading users:", error);
        tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-red-500">Failed to load data.</td></tr>`;
        return;
    }

    allUsers = data;
    applyFilters(); // رسم الجدول بعد الفلترة المبدئية
};

// ==========================================
// 2. نظام الفلترة والبحث اللحظي (Real-time Filtering)
// ==========================================
function applyFilters() {
    const searchTerm = document.getElementById('userSearchInput').value.toLowerCase();
    const roleTerm = document.getElementById('roleFilter').value;
    const statusTerm = document.getElementById('statusFilter').value;

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

// ربط أحداث الإدخال بالفلاتر
document.getElementById('userSearchInput').addEventListener('input', applyFilters);
document.getElementById('roleFilter').addEventListener('change', applyFilters);
document.getElementById('statusFilter').addEventListener('change', applyFilters);

// ==========================================
// 3. رسم الجدول (Rendering)
// ==========================================
function renderUsersTable(usersData) {
    if (usersData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-gray-500 dark:text-gray-400 font-bold">No users match your search criteria.</td></tr>';
        return;
    }

    tbody.innerHTML = usersData.map(u => {
        let roleColor = u.role === 'admin' ? 'bg-purple-500/20 text-purple-500 border-purple-500/30' : 
                        u.role === 'hospital' ? 'bg-blue-500/20 text-blue-500 border-blue-500/30' : 
                        u.role === 'driver' ? 'bg-green-500/20 text-green-500 border-green-500/30' : 'bg-gray-500/20 text-gray-500 border-gray-500/30';
                        
        return `
        <tr class="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors border-b border-gray-100 dark:border-white/5">
            <td class="p-4 font-mono text-xs text-gray-500 dark:text-gray-400">#${u.id}</td>
            <td class="p-4 font-bold text-gray-800 dark:text-white">${u.name}</td>
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
                    <button onclick="viewUserDetails(${u.id})" class="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-blue-500 hover:text-white rounded-lg transition-colors shadow-sm" title="View Details">
                        <i class="fa-solid fa-eye text-xs"></i>
                    </button>
                    <button onclick="editUser(${u.id})" class="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-warning hover:text-white rounded-lg transition-colors shadow-sm" title="Edit">
                        <i class="fa-solid fa-pen text-xs"></i>
                    </button>
                    <button onclick="deleteUser(${u.id})" class="w-8 h-8 flex items-center justify-center bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-colors shadow-sm" title="Delete">
                        <i class="fa-solid fa-trash text-xs"></i>
                    </button>
                </div>
            </td>
        </tr>
        `;
    }).join('');
}
// ==========================================
// 4. العمليات الإدارية (View, Add, Edit, Delete)
// ==========================================

// --- View Details ---
window.viewUserDetails = function(id) {
    const user = allUsers.find(u => u.id === id);
    if(!user) return;

    let roleColor = user.role === 'admin' ? 'text-purple-500' : user.role === 'hospital' ? 'text-blue-500' : user.role === 'driver' ? 'text-green-500' : 'text-gray-500';

    document.getElementById('viewDetailsContent').innerHTML = `
        <div class="flex justify-between border-b border-gray-200 dark:border-gray-700 pb-2">
            <span class="text-gray-500 font-bold">User ID</span> <span class="font-mono dark:text-white">#${user.id}</span>
        </div>
        <div class="flex justify-between border-b border-gray-200 dark:border-gray-700 pb-2">
            <span class="text-gray-500 font-bold">Full Name</span> <span class="font-bold dark:text-white">${user.name}</span>
        </div>
        <div class="flex justify-between border-b border-gray-200 dark:border-gray-700 pb-2">
            <span class="text-gray-500 font-bold">Email Address</span> <span class="dark:text-white">${user.email}</span>
        </div>
        <div class="flex justify-between border-b border-gray-200 dark:border-gray-700 pb-2">
            <span class="text-gray-500 font-bold">Phone Number</span> <span class="font-mono dark:text-white">${user.phone || 'Not Provided'}</span>
        </div>
        <div class="flex justify-between border-b border-gray-200 dark:border-gray-700 pb-2">
            <span class="text-gray-500 font-bold">Assigned Role</span> <span class="uppercase font-bold tracking-wider ${roleColor}">${user.role}</span>
        </div>
        <div class="flex justify-between border-b border-gray-200 dark:border-gray-700 pb-2">
            <span class="text-gray-500 font-bold">Account Status</span> 
            <span class="font-bold ${user.is_active ? 'text-success' : 'text-red-500'}">${user.is_active ? 'Active Account' : 'Suspended'}</span>
        </div>
        <div class="flex justify-between">
            <span class="text-gray-500 font-bold">Member Since</span> <span class="text-xs text-gray-500">${new Date(user.created_at).toLocaleDateString()}</span>
        </div>
    `;

    viewDetailsModal.classList.remove('hidden');
    setTimeout(() => {
        viewDetailsModal.classList.remove('opacity-0');
        viewDetailsModal.children[0].classList.remove('scale-95');
    }, 10);
};

window.closeDetailsModal = function() {
    viewDetailsModal.classList.add('opacity-0');
    viewDetailsModal.children[0].classList.add('scale-95');
    setTimeout(() => { viewDetailsModal.classList.add('hidden'); }, 300);
};

// --- Add/Edit Form Management ---
window.openUserModal = function() {
    document.getElementById('userForm').reset();
    document.getElementById('userId').value = ''; // Empty ID means Add
    document.getElementById('userModalTitle').innerText = 'Add New User';
    document.getElementById('saveUserBtn').innerText = 'Save User';
    document.getElementById('userPassword').required = true; // Password is required for new users
    
    userModal.classList.remove('hidden');
    setTimeout(() => {
        userModal.classList.remove('opacity-0');
        userModal.children[0].classList.remove('scale-95');
    }, 10);
};

window.editUser = function(id) {
    const user = allUsers.find(u => u.id === id);
    if(!user) return;

    document.getElementById('userId').value = user.id;
    document.getElementById('userName').value = user.name;
    document.getElementById('userEmail').value = user.email;
    document.getElementById('userPhone').value = user.phone || '';
    document.getElementById('userRole').value = user.role;
    
    // In edit mode, password is not required (only updated if filled)
    const pwdInput = document.getElementById('userPassword');
    pwdInput.value = '';
    pwdInput.required = false;
    pwdInput.placeholder = "Leave blank to keep current";

    document.getElementById('userModalTitle').innerText = 'Edit User Profile';
    document.getElementById('saveUserBtn').innerText = 'Update User';

    userModal.classList.remove('hidden');
    setTimeout(() => {
        userModal.classList.remove('opacity-0');
        userModal.children[0].classList.remove('scale-95');
    }, 10);
};

window.closeUserModal = function() {
    userModal.classList.add('opacity-0');
    userModal.children[0].classList.add('scale-95');
    setTimeout(() => { userModal.classList.add('hidden'); }, 300);
};

// --- Submit Form (Handles both Insert and Update) ---
userForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const btn = document.getElementById('saveUserBtn');
    const originalText = btn.innerText;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...';
    btn.disabled = true;

    const id = document.getElementById('userId').value;
    const passwordInput = document.getElementById('userPassword').value;

    const userData = {
        name: document.getElementById('userName').value,
        email: document.getElementById('userEmail').value,
        phone: document.getElementById('userPhone').value,
        role: document.getElementById('userRole').value,
        is_active: true
    };

    // Include password only if it's a new user or the field was typed into
    if (passwordInput) {
        userData.password_hash = passwordInput;
    }

    try {
        if (id) {
            // Edit Mode (Update)
            const { error } = await supabase.from(DB_TABLES.USERS).update(userData).eq('id', id);
            if (error) throw error;
        } else {
            // Add Mode (Insert)
            const { error } = await supabase.from(DB_TABLES.USERS).insert([userData]);
            if (error) throw error;
        }
        
        closeUserModal();
        await window.loadUsersData(); // Refresh Data
    } catch (error) {
        alert("Operation Failed: " + error.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
});

// --- Delete ---
window.deleteUser = async function(id) {
    // Basic confirmation
    if(confirm("DANGER: Are you sure you want to permanently delete this user? This may affect linked vehicles or hospitals.")) {
        const { error } = await supabase.from(DB_TABLES.USERS).delete().eq('id', id);
        if(error) alert("Deletion Failed: " + error.message);
        else window.loadUsersData();
    }
};