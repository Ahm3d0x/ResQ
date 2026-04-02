import { supabase } from '../config/supabase.js';
import { t } from '../core/language.js';

const tbody = document.getElementById('logsTableBody');
let allLogs = [];

// ==========================================
// 1. جلب البيانات من السيرفر
// ==========================================
window.loadLogsData = async function() {
    if(!tbody) return;
    tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-gray-500"><i class="fa-solid fa-circle-notch fa-spin text-2xl"></i> ${t('loading') || 'Loading logs...'}</td></tr>`;

    // جلب السجلات مع ربطها بجدول المستخدمين لجلب اسم وايميل المدير
    const { data, error } = await supabase
        .from('audit_admin_changes')
        .select('*, users(name, email)')
        .order('created_at', { ascending: false });

    if (error) {
        window.showToast("Error loading logs: " + error.message, "error");
        tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-red-500 font-bold">Failed to load system logs.</td></tr>`;
        return;
    }

    allLogs = data || [];
    applyLogFilters();
}

// ==========================================
// 2. تطبيق الفلاتر والبحث النصي
// ==========================================
function applyLogFilters() {
    const term = document.getElementById('logSearchInput')?.value.toLowerCase() || "";
    const actionTerm = document.getElementById('logActionFilter')?.value || "";
    const tableTerm = document.getElementById('logTableFilter')?.value || "";

    const filtered = allLogs.filter(log => {
        const adminName = log.users?.name?.toLowerCase() || "system";
        const note = log.note?.toLowerCase() || "";
        
        const matchesSearch = adminName.includes(term) || note.includes(term);
        const matchesAction = actionTerm === "" || log.action === actionTerm;
        const matchesTable = tableTerm === "" || log.target_table === tableTerm;

        return matchesSearch && matchesAction && matchesTable;
    });

    renderLogsTable(filtered);
}

document.getElementById('logSearchInput')?.addEventListener('input', applyLogFilters);
document.getElementById('logActionFilter')?.addEventListener('change', applyLogFilters);
document.getElementById('logTableFilter')?.addEventListener('change', applyLogFilters);

// ==========================================
// 3. رسم الجدول وتلوين الأحداث
// ==========================================
function renderLogsTable(data) {
    if(!tbody) return;
    if(data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-gray-500 font-bold">${t('noDataFound') || 'No matching logs found.'}</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(log => {
        const dateObj = new Date(log.created_at);
        const dateStr = dateObj.toLocaleDateString();
        const timeStr = dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        // تلوين حسب نوع الأكشن
        let actionColor = log.action === 'CREATE' ? 'text-success bg-success/10 border-success/20' : 
                          log.action === 'DELETE' ? 'text-red-500 bg-red-500/10 border-red-500/20' : 
                          'text-warning bg-warning/10 border-warning/20';

        return `
        <tr class="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors border-b border-gray-100 dark:border-white/5">
            <td class="p-4">
                <div class="text-sm font-bold text-gray-800 dark:text-white">${dateStr}</div>
                <div class="text-[10px] text-gray-500 font-mono">${timeStr}</div>
            </td>
            <td class="p-4">
                <div class="text-sm font-bold text-blue-500">${log.users?.name || '<span class="text-red-500">Deleted Admin</span>'}</div>
                <div class="text-[10px] text-gray-500">${log.users?.email || '-'}</div>
            </td>
            <td class="p-4">
                <span class="px-2 py-1 text-[10px] font-black uppercase rounded border ${actionColor}">${log.action}</span>
            </td>
            <td class="p-4 text-xs font-mono text-gray-600 dark:text-gray-300 uppercase font-bold">${log.target_table}</td>
            <td class="p-4 text-xs text-gray-600 dark:text-gray-300 max-w-sm truncate" title="${log.note}">${log.note || '-'}</td>
        </tr>
        `;
    }).join('');
}

// تحديث الجدول عند تغيير اللغة لضمان ترجمة (Loading/No Data)
window.addEventListener('languageChanged', () => {
    if(document.getElementById('module-logs') && !document.getElementById('module-logs').classList.contains('hidden')) {
        applyLogFilters();
    }
});