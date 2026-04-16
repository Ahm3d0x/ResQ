// ============================================================================
// 👤 EnQaZ User Dashboard - Patient Portal (V1.0)
// ============================================================================

import { supabase, DB_TABLES } from '../config/supabase.js';

const PAGE_SIZE = 20;

export const UserApp = {
    state: {
        user: null,
        device: null,
        medicalData: null,
        incidents: [],
        visitors: [],
        currentTab: 'incidents',
        incPage: 0,
        hasMoreInc: true,
        loading: false,
    },

    // ==========================================
    // 🔐 Init & Auth
    // ==========================================
    async init() {
        console.log("👤 Initializing User Dashboard V1.0...");

        const session = localStorage.getItem('resq_custom_session');
        if (!session) {
            this.showToast('يرجى تسجيل الدخول أولاً.', 'error');
            setTimeout(() => window.location.href = 'login.html', 1500);
            return;
        }

        this.state.user = JSON.parse(session);
        document.getElementById('headerUserName').textContent = `مرحباً، ${this.state.user.name}`;

        // Fetch full user data
        const { data: fullUser } = await supabase
            .from(DB_TABLES.USERS)
            .select('*')
            .eq('id', this.state.user.id)
            .single();
        if (fullUser) this.state.user = { ...this.state.user, ...fullUser };

        // Fetch user's device
        const { data: device } = await supabase
            .from(DB_TABLES.DEVICES)
            .select('*')
            .eq('user_id', this.state.user.id)
            .limit(1)
            .maybeSingle();
        this.state.device = device;

        // Fetch medical data from device applications
        const { data: medData } = await supabase
            .from('device_applications')
            .select('*')
            .eq('email', this.state.user.email)
            .maybeSingle();
        this.state.medicalData = medData;

        await this.loadIncidents();
        await this.loadVisitorLogs();
        this.populateSettings();
        this.bindEvents();
    },

    // ==========================================
    // 📋 Incidents
    // ==========================================
    async loadIncidents(append = false) {
        if (this.state.loading) return;
        this.state.loading = true;

        const container = document.getElementById('incidentsList');
        if (!append) {
            this.state.incPage = 0;
            this.state.incidents = [];
        }

        const searchTerm = document.getElementById('incSearchInput')?.value?.trim() || '';
        const statusFilter = document.getElementById('incFilterStatus')?.value || 'all';

        let query = supabase
            .from(DB_TABLES.INCIDENTS)
            .select('*, ambulances(code, status), hospitals(name), devices(device_uid, car_plate, car_model)')
            .eq('user_id', this.state.user.id)
            .order('created_at', { ascending: false })
            .range(this.state.incPage * PAGE_SIZE, (this.state.incPage + 1) * PAGE_SIZE - 1);

        if (statusFilter !== 'all') query = query.eq('status', statusFilter);
        if (searchTerm) query = query.eq('id', parseInt(searchTerm) || 0);

        try {
            const { data, error } = await query;
            if (error) throw error;

            this.state.hasMoreInc = data && data.length === PAGE_SIZE;

            if (append) {
                this.state.incidents = [...this.state.incidents, ...data];
            } else {
                this.state.incidents = data || [];
            }

            this.renderIncidents(container);
        } catch (err) {
            console.error('Failed to load incidents:', err);
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center py-20 text-gray-400">
                    <i class="fa-solid fa-circle-exclamation text-3xl mb-3 text-red-400"></i>
                    <p class="text-sm font-bold">حدث خطأ أثناء تحميل البيانات</p>
                    <button onclick="UserApp.loadIncidents()" class="mt-3 text-xs px-4 py-2 bg-usr-accent text-white rounded-lg font-bold hover:bg-indigo-600 transition">إعادة المحاولة</button>
                </div>`;
        } finally {
            this.state.loading = false;
        }
    },

    renderIncidents(container) {
        const incidents = this.state.incidents;

        if (incidents.length === 0) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center py-20 text-gray-400">
                    <i class="fa-solid fa-shield-check text-5xl mb-4 text-green-700/50"></i>
                    <p class="text-sm font-bold">لا توجد حوادث مسجلة</p>
                    <p class="text-xs text-gray-500 mt-1">نتمنى لك السلامة دائماً</p>
                </div>`;
            return;
        }

        const statusConfig = {
            'completed': { label: 'مكتمل', color: 'text-green-400', bg: 'bg-green-500/15', icon: 'fa-check-circle' },
            'in_progress': { label: 'قيد التنفيذ', color: 'text-yellow-400', bg: 'bg-yellow-500/15', icon: 'fa-spinner' },
            'assigned': { label: 'تم التعيين', color: 'text-blue-400', bg: 'bg-blue-500/15', icon: 'fa-truck-medical' },
            'pending': { label: 'معلق', color: 'text-gray-400', bg: 'bg-gray-500/15', icon: 'fa-clock' },
            'confirmed': { label: 'مؤكد', color: 'text-orange-400', bg: 'bg-orange-500/15', icon: 'fa-circle-check' },
        };

        container.innerHTML = incidents.map(inc => {
            const st = statusConfig[inc.status] || statusConfig.pending;
            const date = new Date(inc.created_at);

            return `
            <div class="bg-white dark:bg-usr-card border border-gray-200 dark:border-usr-border rounded-xl p-4 hover:border-usr-accent/40 transition-all cursor-pointer group" onclick="UserApp.viewIncident(${inc.id})">
                <div class="flex items-center justify-between gap-4">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="w-12 h-12 rounded-xl ${st.bg} flex items-center justify-center shrink-0">
                            <i class="fa-solid ${st.icon} ${st.color} text-lg"></i>
                        </div>
                        <div class="min-w-0">
                            <div class="font-black text-sm">حادث #${inc.id}</div>
                            <div class="text-[10px] text-gray-500 flex items-center gap-2 mt-0.5">
                                <span><i class="fa-regular fa-calendar ml-1"></i>${date.toLocaleDateString('ar-EG')}</span>
                                <span><i class="fa-regular fa-clock ml-1"></i>${date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                        </div>
                    </div>
                    <div class="flex items-center gap-3 shrink-0">
                        <div class="text-left hidden sm:block">
                            <div class="text-[10px] text-gray-500">المستشفى</div>
                            <div class="text-xs font-bold">${inc.hospitals?.name || '—'}</div>
                        </div>
                        <div class="text-left hidden sm:block">
                            <div class="text-[10px] text-gray-500">الإسعاف</div>
                            <div class="text-xs font-bold text-blue-400">${inc.ambulances?.code || '—'}</div>
                        </div>
                        <span class="text-[10px] font-bold px-2.5 py-1 rounded-full ${st.bg} ${st.color} whitespace-nowrap">${st.label}</span>
                        <i class="fa-solid fa-chevron-left text-gray-500 group-hover:text-usr-accent transition text-xs"></i>
                    </div>
                </div>
                ${inc.g_force ? `
                <div class="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center gap-4 text-[10px] text-gray-500">
                    <span><i class="fa-solid fa-gauge-high text-red-400 ml-1"></i> قوة: ${inc.g_force}G</span>
                    ${inc.speed ? `<span><i class="fa-solid fa-tachometer-alt text-blue-400 ml-1"></i> سرعة: ${parseFloat(inc.speed).toFixed(0)} كم/س</span>` : ''}
                </div>` : ''}
            </div>`;
        }).join('');

        // Load more button
        if (this.state.hasMoreInc) {
            container.innerHTML += `
                <div class="text-center py-4">
                    <button onclick="UserApp.loadMoreIncidents()" class="text-xs px-6 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg font-bold hover:bg-gray-200 dark:hover:bg-gray-700 transition">
                        <i class="fa-solid fa-arrow-down ml-1"></i> تحميل المزيد
                    </button>
                </div>`;
        }
    },

    loadMoreIncidents() {
        this.state.incPage++;
        this.loadIncidents(true);
    },

    // ==========================================
    // 🔍 Incident Details
    // ==========================================
    async viewIncident(id) {
        const { data: inc } = await supabase
            .from(DB_TABLES.INCIDENTS)
            .select('*, ambulances(code, status, driver_id, users:driver_id(name, phone)), hospitals(name, phone, city), devices(device_uid, car_plate, car_model)')
            .eq('id', id)
            .single();

        if (!inc) return;

        // Try get medical data
        const med = this.state.medicalData || {};

        const content = document.getElementById('incDetailContent');
        content.innerHTML = `
            <div class="space-y-4">
                <!-- Incident Summary -->
                <div class="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4">
                    <div class="text-xs text-red-500 font-bold mb-2"><i class="fa-solid fa-car-burst ml-1"></i> بيانات الحادث</div>
                    <div class="grid grid-cols-2 gap-3 text-sm">
                        <div><span class="text-gray-500 text-[10px] block">رقم الحادث</span><span class="font-bold">#${inc.id}</span></div>
                        <div><span class="text-gray-500 text-[10px] block">الحالة</span><span class="font-bold">${inc.status}</span></div>
                        <div><span class="text-gray-500 text-[10px] block">قوة التصادم</span><span class="font-bold text-red-500">${inc.g_force || '-'} G</span></div>
                        <div><span class="text-gray-500 text-[10px] block">السرعة</span><span class="font-bold">${inc.speed ? parseFloat(inc.speed).toFixed(0) + ' كم/س' : '-'}</span></div>
                        <div class="col-span-2"><span class="text-gray-500 text-[10px] block">الإحداثيات</span><span class="font-bold text-xs">${inc.latitude}, ${inc.longitude}</span></div>
                    </div>
                </div>

                <!-- Mini Map -->
                <div id="incDetailMap" class="h-40 rounded-xl overflow-hidden border border-gray-200 dark:border-usr-border"></div>

                <!-- Patient -->
                <div class="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-xl p-4">
                    <div class="text-xs text-blue-500 font-bold mb-2"><i class="fa-solid fa-user-injured ml-1"></i> بيانات المريض</div>
                    <div class="grid grid-cols-2 gap-3 text-sm">
                        <div><span class="text-gray-500 text-[10px] block">الاسم</span><span class="font-bold">${this.state.user.name || '-'}</span></div>
                        <div><span class="text-gray-500 text-[10px] block">فصيلة الدم</span><span class="font-bold text-red-500">${med.blood_type || '-'}</span></div>
                        <div><span class="text-gray-500 text-[10px] block">أمراض مزمنة</span><span class="font-bold">${med.medical_conditions || 'لا يوجد'}</span></div>
                        <div><span class="text-gray-500 text-[10px] block">حساسية</span><span class="font-bold">${med.allergies || '-'}</span></div>
                    </div>
                </div>

                <!-- Ambulance -->
                <div class="bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30 rounded-xl p-4">
                    <div class="text-xs text-indigo-500 font-bold mb-2"><i class="fa-solid fa-truck-medical ml-1"></i> وحدة الإسعاف</div>
                    <div class="grid grid-cols-2 gap-3 text-sm">
                        <div><span class="text-gray-500 text-[10px] block">الكود</span><span class="font-bold">${inc.ambulances?.code || '-'}</span></div>
                        <div><span class="text-gray-500 text-[10px] block">السائق</span><span class="font-bold">${inc.ambulances?.users?.name || '-'}</span></div>
                    </div>
                </div>

                <!-- Hospital -->
                <div class="bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 rounded-xl p-4">
                    <div class="text-xs text-green-500 font-bold mb-2"><i class="fa-solid fa-hospital ml-1"></i> المستشفى</div>
                    <div class="grid grid-cols-2 gap-3 text-sm">
                        <div><span class="text-gray-500 text-[10px] block">الاسم</span><span class="font-bold">${inc.hospitals?.name || '-'}</span></div>
                        <div><span class="text-gray-500 text-[10px] block">المدينة</span><span class="font-bold">${inc.hospitals?.city || '-'}</span></div>
                    </div>
                </div>

                <!-- Timeline -->
                <div class="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                    <div class="text-xs font-bold mb-3"><i class="fa-solid fa-timeline ml-1 text-usr-accent"></i> التسلسل الزمني</div>
                    ${this.buildTimeline(inc)}
                </div>

                <!-- Vehicle -->
                ${inc.devices ? `
                <div class="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                    <div class="text-xs font-bold mb-2"><i class="fa-solid fa-car ml-1 text-gray-400"></i> بيانات المركبة</div>
                    <div class="grid grid-cols-3 gap-3 text-sm">
                        <div><span class="text-gray-500 text-[10px] block">الموديل</span><span class="font-bold">${inc.devices.car_model || '-'}</span></div>
                        <div><span class="text-gray-500 text-[10px] block">اللوحة</span><span class="font-bold">${inc.devices.car_plate || '-'}</span></div>
                    </div>
                </div>` : ''}
            </div>`;

        this.openModal('incDetailModal');

        // Render mini map
        setTimeout(() => {
            const lat = parseFloat(inc.latitude);
            const lng = parseFloat(inc.longitude);
            if (lat && lng) {
                const miniMap = L.map('incDetailMap', { zoomControl: false, attributionControl: false, dragging: false }).setView([lat, lng], 15);
                L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(miniMap);
                L.marker([lat, lng], {
                    icon: L.divIcon({
                        className: '',
                        html: `<div style="width:24px;height:24px;background:rgba(239,68,68,0.3);border:2px solid #ef4444;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;color:#ef4444"><i class="fa-solid fa-location-dot"></i></div>`,
                        iconSize: [24, 24], iconAnchor: [12, 12]
                    })
                }).addTo(miniMap);
            }
        }, 300);
    },

    buildTimeline(inc) {
        const steps = [
            { label: 'رصد الحادث', time: inc.created_at, icon: 'fa-bolt', color: '#ef4444' },
            { label: 'تعيين إسعاف', time: inc.assigned_at, icon: 'fa-truck-medical', color: '#3b82f6' },
            { label: 'تأكيد الحادث', time: inc.confirmed_at, icon: 'fa-circle-check', color: '#f59e0b' },
            { label: 'وصول المستشفى', time: inc.hospital_arrival_at, icon: 'fa-hospital', color: '#10b981' },
            { label: 'إغلاق الحالة', time: inc.resolved_at, icon: 'fa-flag-checkered', color: '#8b5cf6' },
        ];

        return `<div class="space-y-3">
            ${steps.map((step, i) => {
                const done = !!step.time;
                const timeStr = step.time ? new Date(step.time).toLocaleString('ar-EG') : '—';
                return `
                <div class="flex items-start gap-3">
                    <div class="flex flex-col items-center">
                        <div class="timeline-dot" style="border-color:${done ? step.color : '#4b5563'}; background:${done ? step.color + '30' : 'transparent'}"></div>
                        ${i < steps.length - 1 ? `<div class="timeline-line h-6" style="background:${done ? step.color + '50' : '#374151'}"></div>` : ''}
                    </div>
                    <div class="min-w-0 pb-1">
                        <div class="text-xs font-bold ${done ? '' : 'text-gray-500'}">${step.label}</div>
                        <div class="text-[10px] text-gray-500">${timeStr}</div>
                    </div>
                </div>`;
            }).join('')}
        </div>`;
    },

    // ==========================================
    // 👁️ Visitor Logs
    // ==========================================
    async loadVisitorLogs() {
        if (!this.state.device) {
            this.state.visitors = [];
            this.renderVisitors();
            return;
        }

        try {
            const { data, error } = await supabase
                .from(DB_TABLES.VISITOR_SEARCHES)
                .select('*')
                .eq('device_uid_searched', this.state.device.device_uid)
                .order('created_at', { ascending: false })
                .limit(100);

            if (error) throw error;
            this.state.visitors = data || [];
        } catch (err) {
            console.warn('Failed to load visitor logs:', err.message);
            this.state.visitors = [];
        }

        this.renderVisitors();
    },

    renderVisitors() {
        const tbody = document.getElementById('visitorsTableBody');
        const searchTerm = (document.getElementById('visSearchInput')?.value || '').toLowerCase();

        let visitors = [...this.state.visitors];
        if (searchTerm) {
            visitors = visitors.filter(v =>
                (v.visitor_email || '').toLowerCase().includes(searchTerm) ||
                (v.visitor_name || '').toLowerCase().includes(searchTerm)
            );
        }

        if (visitors.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="text-center py-16 text-gray-500"><i class="fa-solid fa-user-shield text-3xl mb-2 block text-green-700/40"></i>لا يوجد سجل بحث عنك</td></tr>`;
            return;
        }

        tbody.innerHTML = visitors.map(v => {
            const date = new Date(v.created_at);
            const method = v.device_uid_searched ? 'رقم الجهاز' : 'بريد إلكتروني';

            return `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                <td class="py-3 px-3 text-xs text-gray-500">${date.toLocaleString('ar-EG')}</td>
                <td class="py-3 px-3 text-xs font-bold">${v.visitor_email || '-'}</td>
                <td class="py-3 px-3"><span class="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-bold">${method}</span></td>
                <td class="py-3 px-3 text-xs text-gray-400 font-mono">${v.search_query_raw || v.device_uid_searched || '-'}</td>
            </tr>`;
        }).join('');
    },

    // ==========================================
    // ⚙️ Settings
    // ==========================================
    populateSettings() {
        const u = this.state.user;
        const med = this.state.medicalData || {};

        document.getElementById('setName').value = u.name || '';
        document.getElementById('setEmail').value = u.email || '';
        document.getElementById('setPhone').value = u.phone || '';

        document.getElementById('setBlood').value = med.blood_type || '';
        document.getElementById('setAllergies').value = med.allergies || '';
        document.getElementById('setMedications').value = med.medications || '';
        document.getElementById('setConditions').value = med.medical_conditions || '';

        document.getElementById('setEc1Name').value = med.emergency1_name || '';
        document.getElementById('setEc1Phone').value = med.emergency1_phone || '';
        document.getElementById('setEc1Rel').value = med.emergency1_relation || '';
    },

    async saveProfile() {
        const msg = document.getElementById('saveMsg');
        const name = document.getElementById('setName').value.trim();
        const phone = document.getElementById('setPhone').value.trim();

        if (!name) {
            msg.textContent = '⚠️ الاسم مطلوب';
            msg.className = 'text-xs text-center text-red-400';
            msg.classList.remove('hidden');
            return;
        }

        try {
            // 1. Update users table
            await supabase.from(DB_TABLES.USERS).update({ name, phone }).eq('id', this.state.user.id);

            // 2. Update session
            const session = JSON.parse(localStorage.getItem('resq_custom_session'));
            session.name = name;
            localStorage.setItem('resq_custom_session', JSON.stringify(session));
            document.getElementById('headerUserName').textContent = `مرحباً، ${name}`;

            // 3. Update medical data (if exists)
            if (this.state.medicalData) {
                await supabase.from('device_applications').update({
                    blood_type: document.getElementById('setBlood').value,
                    allergies: document.getElementById('setAllergies').value,
                    medications: document.getElementById('setMedications').value,
                    medical_conditions: document.getElementById('setConditions').value,
                    emergency1_name: document.getElementById('setEc1Name').value,
                    emergency1_phone: document.getElementById('setEc1Phone').value,
                    emergency1_relation: document.getElementById('setEc1Rel').value,
                }).eq('id', this.state.medicalData.id);
            }

            msg.textContent = '✅ تم حفظ جميع التغييرات بنجاح';
            msg.className = 'text-xs text-center text-green-400';
            msg.classList.remove('hidden');
            this.showToast('✅ تم حفظ البيانات', 'success');

        } catch (err) {
            console.error('Save error:', err);
            msg.textContent = '❌ حدث خطأ أثناء الحفظ';
            msg.className = 'text-xs text-center text-red-400';
            msg.classList.remove('hidden');
        }
    },

    async changePassword() {
        const newPass = document.getElementById('setNewPass').value;
        const confirmPass = document.getElementById('setConfirmPass').value;
        const msg = document.getElementById('passMsg');

        if (!newPass || newPass.length < 6) {
            msg.textContent = '⚠️ كلمة المرور يجب أن تكون 6 أحرف على الأقل';
            msg.className = 'text-xs text-red-400';
            msg.classList.remove('hidden');
            return;
        }
        if (newPass !== confirmPass) {
            msg.textContent = '⚠️ كلمات المرور غير متطابقة';
            msg.className = 'text-xs text-red-400';
            msg.classList.remove('hidden');
            return;
        }

        await supabase.from(DB_TABLES.USERS).update({ password_hash: newPass }).eq('id', this.state.user.id);

        msg.textContent = '✅ تم تحديث كلمة المرور';
        msg.className = 'text-xs text-green-400';
        msg.classList.remove('hidden');
        document.getElementById('setNewPass').value = '';
        document.getElementById('setConfirmPass').value = '';
    },

    // ==========================================
    // 🧰 Utilities
    // ==========================================
    switchTab(tabName) {
        this.state.currentTab = tabName;

        document.querySelectorAll('.u-tab-btn').forEach(btn => {
            btn.classList.remove('active');
            btn.classList.add('text-gray-500');
        });
        const activeBtn = document.querySelector(`[data-tab="${tabName}"]`);
        if (activeBtn) {
            activeBtn.classList.add('active');
            activeBtn.classList.remove('text-gray-500');
        }

        document.querySelectorAll('.u-tab').forEach(t => t.classList.remove('active'));
        const activeTab = document.getElementById(`tab-${tabName}`);
        if (activeTab) activeTab.classList.add('active');
    },

    openModal(id) {
        document.getElementById(id).classList.add('open');
    },

    closeModal(id) {
        document.getElementById(id).classList.remove('open');
        // Cleanup leaflet map if present
        const mapEl = document.getElementById('incDetailMap');
        if (mapEl && mapEl._leaflet_id) {
            mapEl._leaflet = null;
        }
    },

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const colors = {
            success: 'bg-green-500/90 border-green-400',
            error: 'bg-red-500/90 border-red-400',
            warning: 'bg-yellow-500/90 border-yellow-400 text-black',
            info: 'bg-indigo-500/90 border-indigo-400',
        };
        const toast = document.createElement('div');
        toast.className = `px-5 py-3 rounded-xl border text-sm font-bold text-white backdrop-blur-sm shadow-xl animate-slideUp pointer-events-auto ${colors[type] || colors.info}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    },

    logout() {
        localStorage.removeItem('resq_custom_session');
        window.location.href = 'login.html';
    },

    bindEvents() {
        document.getElementById('incSearchInput')?.addEventListener('input', () => this.loadIncidents());
        document.getElementById('incFilterStatus')?.addEventListener('change', () => this.loadIncidents());
        document.getElementById('visSearchInput')?.addEventListener('input', () => this.renderVisitors());
    }
};

// ==========================================
// 🚀 Auto-init
// ==========================================
window.UserApp = UserApp;
document.addEventListener('DOMContentLoaded', () => UserApp.init());
