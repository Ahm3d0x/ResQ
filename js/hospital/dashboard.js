// ============================================================================
// 🏥 EnQaZ Hospital Dashboard - Operations Center (V1.0)
// ============================================================================

import { supabase, DB_TABLES } from '../config/supabase.js';

const PROXIMITY_RADIUS_KM = 5;

export const HospitalApp = {
    state: {
        hospital: null,
        hospitalUser: null,
        map: null,
        hospitalMarker: null,
        radiusCircle: null,
        ambMarkers: new Map(),
        routeLayers: new Map(),
        incidentMarkers: new Map(),
        incomingCases: [],
        beds: [],
        logs: [],
        trackingChannel: null,
        currentTab: 'dashboard',
        bedFilter: 'all',
    },

    // ==========================================
    // 🔐 Initialization & Authentication
    // ==========================================
    async init() {
        console.log("🏥 Initializing Hospital Dashboard V1.0...");

        await this.authenticate();
        if (!this.state.hospital) return;

        this.startClock();
        this.initMap();
        await this.loadBeds();
        await this.loadIncomingCases();
        await this.loadLogs();
        this.setupRealtimeListeners();
        this.setupTrackingChannel();
        this.bindEvents();
        this.updateStats();
    },

    async authenticate() {
        const session = localStorage.getItem('resq_custom_session');
        if (!session) {
            this.showToast('لم يتم العثور على جلسة تسجيل دخول. يرجى تسجيل الدخول.', 'error');
            return;
        }

        const user = JSON.parse(session);

        // Fetch hospital linked to this user via user_id column
        const { data: hospitalData, error } = await supabase
            .from(DB_TABLES.HOSPITALS)
            .select('*')
            .eq('user_id', user.id)
            .single();

        if (error || !hospitalData) {
            console.warn('Hospital lookup by user_id failed, trying broad search...');
            // Fallback: find any hospital where user_id matches
            const { data: hospitals } = await supabase
                .from(DB_TABLES.HOSPITALS)
                .select('*');

            // Try to find by matching user_id
            const match = hospitals?.find(h => h.user_id == user.id || h.admin_id == user.id);
            if (!match) {
                this.showToast('لا يوجد مستشفى مرتبط بهذا الحساب.', 'error');
                return;
            }
            this.state.hospital = match;
        } else {
            this.state.hospital = hospitalData;
        }

        this.state.hospitalUser = user;
        document.getElementById('hospitalName').textContent = this.state.hospital.name || 'المستشفى';
    },

    startClock() {
        const update = () => {
            const now = new Date();
            document.getElementById('headerClock').textContent = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        };
        update();
        setInterval(update, 1000);
    },

    // ==========================================
    // 🗺️ Map System (5KM Radar)
    // ==========================================
    initMap() {
        const lat = parseFloat(this.state.hospital.lat) || 30.0444;
        const lng = parseFloat(this.state.hospital.lng) || 31.2357;

        this.state.map = L.map('hospital-map', { zoomControl: false, attributionControl: false }).setView([lat, lng], 14);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(this.state.map);

        // Hospital marker
        this.state.hospitalMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'hospital-marker',
                html: `<div style="width:44px;height:44px;background:rgba(16,185,129,0.2);border:2px solid #10b981;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#10b981;font-size:18px;box-shadow:0 0 20px rgba(16,185,129,0.4)"><i class="fa-solid fa-hospital"></i></div>`,
                iconSize: [44, 44], iconAnchor: [22, 22]
            }),
            zIndexOffset: 1000
        }).addTo(this.state.map).bindPopup(`<b>${this.state.hospital.name}</b>`);

        // 5KM radius circle
        this.state.radiusCircle = L.circle([lat, lng], {
            radius: PROXIMITY_RADIUS_KM * 1000,
            color: '#10b981',
            fillColor: '#10b981',
            fillOpacity: 0.04,
            weight: 1,
            dashArray: '8, 8'
        }).addTo(this.state.map);

        // Fit to radius
        this.state.map.fitBounds(this.state.radiusCircle.getBounds(), { padding: [20, 20] });

        // Fix resize
        setTimeout(() => this.state.map.invalidateSize(), 300);
    },

    // ==========================================
    // 📦 Data Loading
    // ==========================================
    async loadIncomingCases() {
        if (!this.state.hospital) return;

        const { data: incidents } = await supabase
            .from(DB_TABLES.INCIDENTS)
            .select('*, ambulances(*), devices(car_plate, car_model, users(name, email)), hospitals(*)')
            .eq('assigned_hospital_id', this.state.hospital.id)
            .in('status', ['assigned', 'in_progress'])
            .order('created_at', { ascending: false });

        this.state.incomingCases = incidents || [];
        this.renderIncomingCases();
        this.renderMapOverlays();
        this.updateStats();
    },

    async loadBeds() {
        if (!this.state.hospital) return;

        try {
            const { data: beds, error } = await supabase
                .from('hospital_beds')
                .select('*')
                .eq('hospital_id', this.state.hospital.id)
                .order('id', { ascending: true });

            if (error) throw error;

            this.state.beds = beds || [];

            // If no beds exist yet, auto-create from hospital capacity
            if (this.state.beds.length === 0) {
                const capacity = this.state.hospital.available_beds || this.state.hospital.capacity || 10;
                await this.initializeBeds(capacity);
            }
        } catch (err) {
            console.warn('⚠️ hospital_beds table not found. Run sql/hospital_schema.sql first.', err.message);
            this.showToast('⚠️ جدول الأسرّة غير موجود. يرجى تشغيل ملف SQL أولاً.', 'warning');
            this.state.beds = [];
        }

        this.renderBeds();
        this.updateStats();
        document.getElementById('settingsTotalBeds').value = this.state.beds.length;
    },

    async initializeBeds(count) {
        const beds = [];
        for (let i = 0; i < count; i++) {
            beds.push({
                hospital_id: this.state.hospital.id,
                status: 'available',
                bed_number: i + 1
            });
        }
        const { data } = await supabase.from('hospital_beds').insert(beds).select();
        this.state.beds = data || [];
    },

    async loadLogs() {
        if (!this.state.hospital) return;

        try {
            const { data: logs, error } = await supabase
                .from('hospital_logs')
                .select('*')
                .eq('hospital_id', this.state.hospital.id)
                .order('created_at', { ascending: false })
                .limit(200);

            if (error) throw error;
            this.state.logs = logs || [];
        } catch (err) {
            console.warn('⚠️ hospital_logs table not found.', err.message);
            this.state.logs = [];
        }

        this.renderLogs();
    },

    // ==========================================
    // 🎨 Rendering
    // ==========================================
    renderIncomingCases() {
        const container = document.getElementById('incomingCasesList');
        const cases = this.state.incomingCases;
        document.getElementById('incomingCount').textContent = cases.length;

        if (cases.length === 0) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-gray-600">
                    <i class="fa-solid fa-shield-check text-4xl mb-3 text-green-800"></i>
                    <p class="text-sm font-bold">لا توجد حالات واردة حالياً</p>
                    <p class="text-xs text-gray-700">النظام يعمل بشكل طبيعي</p>
                </div>`;
            return;
        }

        container.innerHTML = cases.map(inc => {
            const amb = inc.ambulances;
            const ambStatus = amb?.status || 'unknown';
            const patientName = inc.devices?.users?.name || 'غير معروف';
            const carInfo = `${inc.devices?.car_model || ''} ${inc.devices?.car_plate || ''}`.trim();
            const isArrived = ambStatus === 'busy' || ambStatus === 'arrived';

            const statusMap = {
                'assigned': { label: 'تم التعيين', color: 'text-blue-400', bg: 'bg-blue-500/15' },
                'en_route_incident': { label: 'متجه للحادث', color: 'text-yellow-400', bg: 'bg-yellow-500/15' },
                'en_route_hospital': { label: 'في الطريق للمستشفى', color: 'text-orange-400', bg: 'bg-orange-500/15' },
                'arrived': { label: 'وصل المستشفى', color: 'text-green-400', bg: 'bg-green-500/15' },
                'busy': { label: 'وصل المستشفى', color: 'text-green-400', bg: 'bg-green-500/15' },
            };
            const st = statusMap[ambStatus] || { label: ambStatus, color: 'text-gray-400', bg: 'bg-gray-500/15' };

            return `
            <div class="case-card bg-gray-900/60 border border-hospital-border rounded-xl p-4 space-y-3" data-inc-id="${inc.id}">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center"><i class="fa-solid fa-triangle-exclamation text-red-400 text-sm"></i></div>
                        <div>
                            <div class="text-xs font-black text-white">حادث #${inc.id}</div>
                            <div class="text-[10px] text-gray-500">${new Date(inc.created_at).toLocaleTimeString('ar-EG')}</div>
                        </div>
                    </div>
                    <span class="text-[10px] font-bold px-2 py-1 rounded-full ${st.bg} ${st.color}">${st.label}</span>
                </div>
                <div class="grid grid-cols-2 gap-2 text-xs">
                    <div><span class="text-gray-500 block text-[10px]">المريض</span><span class="font-bold text-white">${patientName}</span></div>
                    <div><span class="text-gray-500 block text-[10px]">وحدة الإسعاف</span><span class="font-bold text-blue-300">${amb?.code || '-'}</span></div>
                    ${carInfo ? `<div class="col-span-2"><span class="text-gray-500 block text-[10px]">المركبة</span><span class="font-bold text-gray-300">${carInfo}</span></div>` : ''}
                    <div><span class="text-gray-500 block text-[10px]">قوة التصادم</span><span class="font-bold text-red-300">${inc.g_force || '-'} G</span></div>
                </div>
                <div class="flex gap-2">
                    <button onclick="HospitalApp.viewCaseDetails(${inc.id})" class="flex-1 text-xs py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold transition">
                        <i class="fa-solid fa-eye ml-1"></i> عرض التفاصيل
                    </button>
                    ${isArrived ? `
                    <button onclick="HospitalApp.confirmIntake(${inc.id})" class="flex-1 text-xs py-2 rounded-lg bg-hospital-accent hover:bg-green-600 text-white font-bold transition animate-pulseGreen">
                        <i class="fa-solid fa-user-check ml-1"></i> تأكيد استلام
                    </button>` : ''}
                </div>
            </div>`;
        }).join('');
    },

    renderMapOverlays() {
        // Clear old markers
        this.state.incidentMarkers.forEach(m => this.state.map.removeLayer(m));
        this.state.incidentMarkers.clear();

        this.state.incomingCases.forEach(inc => {
            const lat = parseFloat(inc.latitude);
            const lng = parseFloat(inc.longitude);
            if (!lat || !lng) return;

            const marker = L.marker([lat, lng], {
                icon: L.divIcon({
                    className: 'inc-marker',
                    html: `<div style="width:28px;height:28px;background:rgba(239,68,68,0.3);border:2px solid #ef4444;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#ef4444;font-size:12px;animation:pulse 2s infinite"><i class="fa-solid fa-car-burst"></i></div>`,
                    iconSize: [28, 28], iconAnchor: [14, 14]
                })
            }).addTo(this.state.map).bindPopup(`حادث #${inc.id}`);

            this.state.incidentMarkers.set(inc.id, marker);
        });
    },

    renderBeds() {
        const grid = document.getElementById('bedsGrid');
        const filter = this.state.bedFilter;
        const beds = filter === 'all' ? this.state.beds : this.state.beds.filter(b => b.status === filter);

        if (beds.length === 0) {
            grid.innerHTML = `<div class="col-span-full flex flex-col items-center justify-center py-20 text-gray-600">
                <i class="fa-solid fa-bed text-5xl mb-4 text-gray-700"></i>
                <p class="font-bold">لا توجد أسرّة ${filter !== 'all' ? 'بهذا الفلتر' : ''}</p>
            </div>`;
            return;
        }

        grid.innerHTML = beds.map(bed => {
            const statusConfig = {
                available: { icon: 'fa-check', color: 'text-green-400', borderColor: 'border-green-500/40', bg: 'bg-green-500/5', label: 'متاح' },
                occupied: { icon: 'fa-user-injured', color: 'text-red-400', borderColor: 'border-red-500/40', bg: 'bg-red-500/5', label: 'مشغول' },
                blocked: { icon: 'fa-ban', color: 'text-gray-500', borderColor: 'border-gray-600/40', bg: 'bg-gray-500/5', label: 'معطّل' },
            };
            const cfg = statusConfig[bed.status] || statusConfig.available;

            return `
            <div class="bed-card bed-${bed.status} bg-hospital-card border ${cfg.borderColor} rounded-xl p-3 cursor-pointer ${cfg.bg}" onclick="HospitalApp.viewBedDetails(${bed.id})">
                <div class="flex items-center justify-between mb-2">
                    <span class="text-xs font-black text-gray-400">سرير #${bed.bed_number || bed.id}</span>
                    <i class="fa-solid ${cfg.icon} ${cfg.color} text-sm"></i>
                </div>
                <div class="text-[10px] font-bold ${cfg.color}">${cfg.label}</div>
                ${bed.status === 'occupied' && bed.patient_name ? `<div class="text-[10px] text-gray-400 mt-1 truncate">${bed.patient_name}</div>` : ''}
            </div>`;
        }).join('');
    },

    renderLogs() {
        const tbody = document.getElementById('logsTableBody');
        const searchTerm = (document.getElementById('logSearchInput')?.value || '').toLowerCase();
        const filterType = document.getElementById('logFilterType')?.value || 'all';
        const filterDate = document.getElementById('logFilterDate')?.value || '';

        let logs = [...this.state.logs];

        if (filterType !== 'all') {
            logs = logs.filter(l => l.action === filterType);
        }
        if (searchTerm) {
            logs = logs.filter(l => {
                const meta = typeof l.metadata === 'string' ? JSON.parse(l.metadata || '{}') : (l.metadata || {});
                const searchable = `${meta.patient_name || ''} ${meta.incident_id || ''} ${l.action}`.toLowerCase();
                return searchable.includes(searchTerm);
            });
        }
        if (filterDate) {
            logs = logs.filter(l => l.created_at && l.created_at.startsWith(filterDate));
        }

        if (logs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center py-12 text-gray-600"><i class="fa-solid fa-inbox text-3xl mb-2 block"></i>لا توجد سجلات مطابقة</td></tr>`;
            return;
        }

        const actionLabels = {
            patient_admitted: { label: 'استقبال مريض', color: 'text-green-400', icon: 'fa-user-plus' },
            patient_discharged: { label: 'خروج مريض', color: 'text-blue-400', icon: 'fa-right-from-bracket' },
            patient_deceased: { label: 'وفاة', color: 'text-red-400', icon: 'fa-skull-crossbones' },
            incident_received: { label: 'استلام حادث', color: 'text-yellow-400', icon: 'fa-triangle-exclamation' },
        };

        tbody.innerHTML = logs.map(log => {
            const meta = typeof log.metadata === 'string' ? JSON.parse(log.metadata || '{}') : (log.metadata || {});
            const actionConf = actionLabels[log.action] || { label: log.action, color: 'text-gray-400', icon: 'fa-circle-info' };

            return `
            <tr class="hover:bg-gray-900/50 transition-colors">
                <td class="py-3 px-3 text-xs text-gray-400">${new Date(log.created_at).toLocaleString('ar-EG')}</td>
                <td class="py-3 px-3"><span class="text-xs font-bold ${actionConf.color}"><i class="fa-solid ${actionConf.icon} ml-1"></i> ${actionConf.label}</span></td>
                <td class="py-3 px-3 text-xs text-gray-300">${meta.patient_name || meta.note || '-'}</td>
                <td class="py-3 px-3 text-xs text-gray-500">${meta.incident_id ? `#${meta.incident_id}` : '-'}</td>
                <td class="py-3 px-3 text-center">${meta.incident_id ? `<button onclick="HospitalApp.viewCaseDetails(${meta.incident_id})" class="text-hospital-accent hover:text-green-300 text-xs"><i class="fa-solid fa-arrow-up-right-from-square"></i></button>` : '-'}</td>
            </tr>`;
        }).join('');
    },

    updateStats() {
        const beds = this.state.beds;
        const totalBeds = beds.length;
        const occupied = beds.filter(b => b.status === 'occupied').length;
        const available = beds.filter(b => b.status === 'available').length;
        const incoming = this.state.incomingCases.length;
        const activeCases = this.state.incomingCases.filter(c => {
            const s = c.ambulances?.status;
            return s === 'en_route_hospital' || s === 'busy' || s === 'arrived';
        }).length;

        document.getElementById('stat-totalBeds').textContent = totalBeds;
        document.getElementById('stat-occupiedBeds').textContent = occupied;
        document.getElementById('stat-availableBeds').textContent = available;
        document.getElementById('stat-incoming').textContent = incoming;
        document.getElementById('stat-activeCases').textContent = activeCases;
    },

    // ==========================================
    // 📡 Real-time
    // ==========================================
    setupRealtimeListeners() {
        // Listen to incident changes for this hospital
        supabase.channel('hospital-incident-watch')
            .on('postgres_changes', {
                event: '*', schema: 'public', table: DB_TABLES.INCIDENTS,
                filter: `assigned_hospital_id=eq.${this.state.hospital.id}`
            }, async (payload) => {
                console.log("📡 [Hospital] Incident change:", payload.eventType, payload.new?.status);
                await this.loadIncomingCases();

                if (payload.eventType === 'INSERT' || (payload.eventType === 'UPDATE' && payload.new.status === 'assigned')) {
                    this.showToast('🚨 حالة طوارئ جديدة واردة!', 'warning');
                    await this.addLog('incident_received', { incident_id: payload.new.id, note: 'تم استلام حالة طوارئ جديدة' });
                }
            }).subscribe();

        // Listen to ambulance status changes
        supabase.channel('hospital-amb-watch')
            .on('postgres_changes', {
                event: 'UPDATE', schema: 'public', table: DB_TABLES.AMBULANCES
            }, async (payload) => {
                // Check proximity and update
                const ambId = payload.new.id;
                const ambLat = parseFloat(payload.new.lat);
                const ambLng = parseFloat(payload.new.lng);

                // Check if this ambulance is assigned to one of our incidents
                const relevantCase = this.state.incomingCases.find(c => c.assigned_ambulance_id === ambId);
                if (!relevantCase) return;

                // Check proximity
                const dist = this.haversineKm(
                    parseFloat(this.state.hospital.lat), parseFloat(this.state.hospital.lng),
                    ambLat, ambLng
                );

                if (dist <= PROXIMITY_RADIUS_KM) {
                    const card = document.querySelector(`[data-inc-id="${relevantCase.id}"]`);
                    if (card && !card.classList.contains('nearby')) {
                        card.classList.add('nearby');
                        this.showToast(`🚑 إسعاف ${payload.new.code} يقترب! (${dist.toFixed(1)} كم)`, 'info');
                    }
                }

                // Reload to update statuses
                await this.loadIncomingCases();
            }).subscribe();
    },

    setupTrackingChannel() {
        this.state.trackingChannel = supabase.channel('live-tracking');

        this.state.trackingChannel.on('broadcast', { event: 'fleet_update' }, (payload) => {
            const fleet = payload.payload;
            if (!fleet || !Array.isArray(fleet)) return;

            // Filter to only ambulances assigned to this hospital's cases
            const assignedAmbIds = new Set(this.state.incomingCases.map(c => String(c.assigned_ambulance_id)));

            fleet.forEach(amb => {
                if (!assignedAmbIds.has(String(amb.id))) return;

                const latLng = [parseFloat(amb.lat), parseFloat(amb.lng)];

                // Update or create marker
                if (this.state.ambMarkers.has(amb.id)) {
                    this.state.ambMarkers.get(amb.id).setLatLng(latLng);
                } else {
                    const marker = L.marker(latLng, {
                        icon: L.divIcon({
                            className: 'amb-map-marker',
                            html: `<div style="width:32px;height:32px;background:rgba(59,130,246,0.2);border:2px solid #3b82f6;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#3b82f6;font-size:14px"><i class="fa-solid fa-truck-medical"></i></div>`,
                            iconSize: [32, 32], iconAnchor: [16, 16]
                        }),
                        zIndexOffset: 800
                    }).addTo(this.state.map);
                    this.state.ambMarkers.set(amb.id, marker);
                }
            });
        })
        .on('broadcast', { event: 'route_established' }, (payload) => {
            const data = payload.payload;
            if (!data || !data.geometry) return;

            // Only show route for active mission stages
            if (data.stage !== 'to_incident' && data.stage !== 'to_hospital') return;

            // Check if this ambulance is assigned to our hospital
            const assignedAmbIds = new Set(this.state.incomingCases.map(c => String(c.assigned_ambulance_id)));
            if (!assignedAmbIds.has(String(data.ambId))) return;

            // Remove old route for this ambulance
            if (this.state.routeLayers.has(data.ambId)) {
                this.state.map.removeLayer(this.state.routeLayers.get(data.ambId));
            }

            const color = data.stage === 'to_incident' ? '#ef4444' : '#3b82f6';
            const polyline = L.polyline(data.geometry, {
                color, weight: 4, opacity: 0.7, dashArray: '8, 8'
            }).addTo(this.state.map);

            this.state.routeLayers.set(data.ambId, polyline);
        })
        .subscribe();
    },

    // ==========================================
    // 🎬 Actions
    // ==========================================
    async confirmIntake(incidentId) {
        // Find first available bed
        const availableBed = this.state.beds.find(b => b.status === 'available');
        if (!availableBed) {
            this.showToast('⚠️ المستشفى ممتلئة! لا توجد أسرّة متاحة.', 'error');
            return;
        }

        const incident = this.state.incomingCases.find(c => c.id === incidentId);
        if (!incident) return;

        const patientName = incident.devices?.users?.name || 'غير معروف';
        const patientEmail = incident.devices?.users?.email || '';

        try {
            // 1. Update incident to completed
            await supabase.from(DB_TABLES.INCIDENTS).update({ status: 'completed' }).eq('id', incidentId);

            // 2. Free ambulance
            if (incident.assigned_ambulance_id) {
                await supabase.from(DB_TABLES.AMBULANCES).update({ status: 'available' }).eq('id', incident.assigned_ambulance_id);
            }

            // 3. Assign bed
            await supabase.from('hospital_beds').update({
                status: 'occupied',
                patient_name: patientName,
                patient_id: patientEmail,
                incident_id: incidentId,
                admission_time: new Date().toISOString()
            }).eq('id', availableBed.id);

            // 4. Log
            await this.addLog('patient_admitted', {
                incident_id: incidentId,
                patient_name: patientName,
                bed_id: availableBed.id,
                note: `تم استقبال المريض ${patientName} في سرير #${availableBed.bed_number || availableBed.id}`
            });

            this.showToast(`✅ تم استقبال ${patientName} في سرير #${availableBed.bed_number || availableBed.id}`, 'success');

            // Remove route overlays for this ambulance
            const ambId = incident.assigned_ambulance_id;
            if (this.state.routeLayers.has(ambId)) {
                this.state.map.removeLayer(this.state.routeLayers.get(ambId));
                this.state.routeLayers.delete(ambId);
            }
            if (this.state.ambMarkers.has(ambId)) {
                this.state.map.removeLayer(this.state.ambMarkers.get(ambId));
                this.state.ambMarkers.delete(ambId);
            }

            // Reload
            await this.loadBeds();
            await this.loadIncomingCases();
            await this.loadLogs();

        } catch (err) {
            console.error('Intake error:', err);
            this.showToast('حدث خطأ أثناء تأكيد الاستلام.', 'error');
        }
    },

    async dischargeBed(bedId) {
        const bed = this.state.beds.find(b => b.id === bedId);
        if (!bed || bed.status !== 'occupied') return;

        await supabase.from('hospital_beds').update({
            status: 'available',
            patient_name: null,
            patient_id: null,
            incident_id: null,
            admission_time: null
        }).eq('id', bedId);

        await this.addLog('patient_discharged', {
            incident_id: bed.incident_id,
            patient_name: bed.patient_name,
            bed_id: bedId,
            note: `تم خروج المريض ${bed.patient_name || '-'} من سرير #${bed.bed_number || bed.id}`
        });

        this.showToast(`تم خروج المريض من سرير #${bed.bed_number || bed.id}`, 'success');
        this.closeModal('bedModal');
        await this.loadBeds();
        await this.loadLogs();
    },

    async markDeceased(bedId) {
        const bed = this.state.beds.find(b => b.id === bedId);
        if (!bed || bed.status !== 'occupied') return;

        // Free bed
        await supabase.from('hospital_beds').update({
            status: 'available',
            patient_name: null,
            patient_id: null,
            incident_id: null,
            admission_time: null
        }).eq('id', bedId);

        // If incident linked, mark patient_status
        if (bed.incident_id) {
            await supabase.from(DB_TABLES.INCIDENTS).update({ patient_status: 'deceased' }).eq('id', bed.incident_id);
        }

        await this.addLog('patient_deceased', {
            incident_id: bed.incident_id,
            patient_name: bed.patient_name,
            bed_id: bedId,
            note: `وفاة المريض ${bed.patient_name || '-'}`
        });

        this.showToast('تم تسجيل الوفاة وتحرير السرير.', 'error');
        this.closeModal('bedModal');
        await this.loadBeds();
        await this.loadLogs();
    },

    async toggleBlockBed(bedId) {
        const bed = this.state.beds.find(b => b.id === bedId);
        if (!bed) return;
        if (bed.status === 'occupied') {
            this.showToast('لا يمكن تعطيل سرير مشغول.', 'error');
            return;
        }

        const newStatus = bed.status === 'blocked' ? 'available' : 'blocked';
        await supabase.from('hospital_beds').update({ status: newStatus }).eq('id', bedId);

        this.closeModal('bedModal');
        await this.loadBeds();
    },

    // ==========================================
    // 🔍 Modals & Views
    // ==========================================
    async viewCaseDetails(incidentId) {
        const { data: inc } = await supabase
            .from(DB_TABLES.INCIDENTS)
            .select('*, ambulances(*), devices(car_plate, car_model, users(name, email)), hospitals(*)')
            .eq('id', incidentId)
            .single();

        if (!inc) return;

        // Try loading patient medical data
        let patientData = {};
        if (inc.devices?.users?.email) {
            const { data: pd } = await supabase.from('device_applications').select('*').eq('email', inc.devices.users.email).maybeSingle();
            patientData = pd || {};
        }

        const content = document.getElementById('caseModalContent');
        content.innerHTML = `
            <div class="space-y-4">
                <div class="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                    <div class="text-xs text-red-400 font-bold mb-2"><i class="fa-solid fa-triangle-exclamation ml-1"></i> بيانات الحادث</div>
                    <div class="grid grid-cols-2 gap-3 text-sm">
                        <div><span class="text-gray-500 text-[10px] block">رقم الحادث</span><span class="font-bold text-white">#${inc.id}</span></div>
                        <div><span class="text-gray-500 text-[10px] block">الحالة</span><span class="font-bold text-yellow-400">${inc.status}</span></div>
                        <div><span class="text-gray-500 text-[10px] block">قوة التصادم</span><span class="font-bold text-red-400">${inc.g_force || '-'} G</span></div>
                        <div><span class="text-gray-500 text-[10px] block">وقت الإنشاء</span><span class="font-bold text-gray-300">${new Date(inc.created_at).toLocaleString('ar-EG')}</span></div>
                        <div class="col-span-2"><span class="text-gray-500 text-[10px] block">الإحداثيات</span><span class="font-bold text-gray-300">${inc.latitude}, ${inc.longitude}</span></div>
                    </div>
                </div>

                <div class="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
                    <div class="text-xs text-blue-400 font-bold mb-2"><i class="fa-solid fa-user-injured ml-1"></i> بيانات المريض</div>
                    <div class="grid grid-cols-2 gap-3 text-sm">
                        <div><span class="text-gray-500 text-[10px] block">الاسم</span><span class="font-bold text-white">${patientData.full_name || inc.devices?.users?.name || '-'}</span></div>
                        <div><span class="text-gray-500 text-[10px] block">فصيلة الدم</span><span class="font-bold text-red-400">${patientData.blood_type || '-'}</span></div>
                        <div><span class="text-gray-500 text-[10px] block">أمراض مزمنة</span><span class="font-bold text-yellow-400">${patientData.medical_conditions || 'لا يوجد'}</span></div>
                        <div><span class="text-gray-500 text-[10px] block">حساسية</span><span class="font-bold text-orange-400">${patientData.allergies || '-'}</span></div>
                        <div class="col-span-2"><span class="text-gray-500 text-[10px] block">أدوية</span><span class="font-bold text-gray-300">${patientData.medications || '-'}</span></div>
                    </div>
                </div>

                <div class="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
                    <div class="text-xs text-green-400 font-bold mb-2"><i class="fa-solid fa-truck-medical ml-1"></i> وحدة الإسعاف</div>
                    <div class="grid grid-cols-2 gap-3 text-sm">
                        <div><span class="text-gray-500 text-[10px] block">الكود</span><span class="font-bold text-white">${inc.ambulances?.code || '-'}</span></div>
                        <div><span class="text-gray-500 text-[10px] block">الحالة</span><span class="font-bold text-blue-400">${inc.ambulances?.status || '-'}</span></div>
                        <div><span class="text-gray-500 text-[10px] block">المركبة</span><span class="font-bold text-gray-300">${inc.devices?.car_model || '-'}</span></div>
                        <div><span class="text-gray-500 text-[10px] block">اللوحة</span><span class="font-bold text-gray-300">${inc.devices?.car_plate || '-'}</span></div>
                    </div>
                </div>
            </div>`;

        this.openModal('caseModal');
    },

    viewBedDetails(bedId) {
        const bed = this.state.beds.find(b => b.id === bedId);
        if (!bed) return;

        const content = document.getElementById('bedModalContent');
        const isOccupied = bed.status === 'occupied';
        const isBlocked = bed.status === 'blocked';

        content.innerHTML = `
            <div class="space-y-4">
                <div class="bg-gray-800 rounded-xl p-4">
                    <div class="grid grid-cols-2 gap-4 text-sm">
                        <div><span class="text-gray-500 text-[10px] block">رقم السرير</span><span class="font-bold text-white">#${bed.bed_number || bed.id}</span></div>
                        <div><span class="text-gray-500 text-[10px] block">الحالة</span><span class="font-bold ${isOccupied ? 'text-red-400' : isBlocked ? 'text-gray-500' : 'text-green-400'}">${isOccupied ? 'مشغول' : isBlocked ? 'معطّل' : 'متاح'}</span></div>
                        ${isOccupied ? `
                            <div><span class="text-gray-500 text-[10px] block">المريض</span><span class="font-bold text-white">${bed.patient_name || '-'}</span></div>
                            <div><span class="text-gray-500 text-[10px] block">رقم الحادث</span><span class="font-bold text-yellow-400">${bed.incident_id ? '#' + bed.incident_id : '-'}</span></div>
                            <div class="col-span-2"><span class="text-gray-500 text-[10px] block">وقت الدخول</span><span class="font-bold text-gray-300">${bed.admission_time ? new Date(bed.admission_time).toLocaleString('ar-EG') : '-'}</span></div>
                        ` : ''}
                    </div>
                </div>
                <div class="flex gap-2">
                    ${isOccupied ? `
                        <button onclick="HospitalApp.dischargeBed(${bed.id})" class="flex-1 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-bold text-sm transition">
                            <i class="fa-solid fa-right-from-bracket ml-1"></i> خروج المريض
                        </button>
                        <button onclick="HospitalApp.markDeceased(${bed.id})" class="py-2.5 px-4 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 font-bold text-sm transition border border-red-500/30">
                            <i class="fa-solid fa-skull-crossbones"></i>
                        </button>
                    ` : ''}
                    <button onclick="HospitalApp.toggleBlockBed(${bed.id})" class="flex-1 py-2.5 rounded-lg ${isBlocked ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-gray-700 text-gray-300 border-gray-600'} border font-bold text-sm transition">
                        <i class="fa-solid ${isBlocked ? 'fa-lock-open' : 'fa-ban'} ml-1"></i> ${isBlocked ? 'إلغاء التعطيل' : 'تعطيل'}
                    </button>
                </div>
            </div>`;

        this.openModal('bedModal');
    },

    // ==========================================
    // ⚙️ Settings
    // ==========================================
    async adjustBeds(delta) {
        const input = document.getElementById('settingsTotalBeds');
        let val = parseInt(input.value) || 0;
        val = Math.max(0, val + delta);
        input.value = val;
    },

    async saveBedConfig() {
        const newTotal = parseInt(document.getElementById('settingsTotalBeds').value);
        const currentTotal = this.state.beds.length;
        const occupied = this.state.beds.filter(b => b.status === 'occupied').length;
        const msg = document.getElementById('bedConfigMsg');

        if (newTotal < occupied) {
            msg.textContent = `⚠️ لا يمكن تقليل الأسرّة إلى أقل من ${occupied} (عدد المشغول حالياً)`;
            msg.className = 'text-xs text-red-400';
            msg.classList.remove('hidden');
            return;
        }

        if (newTotal > currentTotal) {
            // Add beds
            const toAdd = newTotal - currentTotal;
            const maxBedNum = this.state.beds.reduce((max, b) => Math.max(max, b.bed_number || 0), 0);
            const newBeds = [];
            for (let i = 0; i < toAdd; i++) {
                newBeds.push({
                    hospital_id: this.state.hospital.id,
                    status: 'available',
                    bed_number: maxBedNum + i + 1
                });
            }
            await supabase.from('hospital_beds').insert(newBeds);
        } else if (newTotal < currentTotal) {
            // Remove available beds from the end
            const toRemove = currentTotal - newTotal;
            const removable = this.state.beds.filter(b => b.status !== 'occupied').slice(-toRemove);
            if (removable.length < toRemove) {
                msg.textContent = 'لا يمكن حذف أسرّة مشغولة.';
                msg.className = 'text-xs text-red-400';
                msg.classList.remove('hidden');
                return;
            }
            const ids = removable.map(b => b.id);
            await supabase.from('hospital_beds').delete().in('id', ids);
        }

        // Update hospital capacity
        await supabase.from(DB_TABLES.HOSPITALS).update({
            available_beds: newTotal - occupied,
            capacity: newTotal
        }).eq('id', this.state.hospital.id);

        msg.textContent = '✅ تم حفظ إعدادات الأسرّة بنجاح.';
        msg.className = 'text-xs text-green-400';
        msg.classList.remove('hidden');

        await this.loadBeds();
    },

    async changePassword() {
        const newPass = document.getElementById('settingsNewPass').value;
        const confirm = document.getElementById('settingsConfirmPass').value;
        const msg = document.getElementById('passMsg');

        if (!newPass || newPass.length < 6) {
            msg.textContent = '⚠️ كلمة المرور يجب أن تكون 6 أحرف على الأقل.';
            msg.className = 'text-xs text-red-400';
            msg.classList.remove('hidden');
            return;
        }
        if (newPass !== confirm) {
            msg.textContent = '⚠️ كلمات المرور غير متطابقة.';
            msg.className = 'text-xs text-red-400';
            msg.classList.remove('hidden');
            return;
        }

        // Update in users table
        const session = JSON.parse(localStorage.getItem('resq_custom_session'));
        await supabase.from('users').update({ password: newPass }).eq('id', session.id);

        msg.textContent = '✅ تم تحديث كلمة المرور بنجاح.';
        msg.className = 'text-xs text-green-400';
        msg.classList.remove('hidden');

        document.getElementById('settingsNewPass').value = '';
        document.getElementById('settingsConfirmPass').value = '';
    },

    // ==========================================
    // 🧰 Utilities
    // ==========================================
    switchTab(tabName) {
        this.state.currentTab = tabName;

        // Update buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
            btn.classList.add('text-gray-500');
        });
        const activeBtn = document.querySelector(`[data-tab="${tabName}"]`);
        if (activeBtn) {
            activeBtn.classList.add('active');
            activeBtn.classList.remove('text-gray-500');
        }

        // Update tab panels (visibility/opacity based system)
        document.querySelectorAll('.tab-panel').forEach(tab => tab.classList.remove('active'));
        const activeTab = document.getElementById(`tab-${tabName}`);
        if (activeTab) activeTab.classList.add('active');

        // Fix map size when switching to dashboard
        if (tabName === 'dashboard' && this.state.map) {
            setTimeout(() => this.state.map.invalidateSize(), 150);
        }
    },

    filterBeds(filter) {
        this.state.bedFilter = filter;
        document.querySelectorAll('.bed-filter-btn').forEach(btn => {
            btn.classList.remove('active', 'bg-gray-800', 'text-gray-300', 'border-gray-700');
            btn.classList.add('bg-gray-800/50', 'text-gray-500', 'border-gray-800');
        });
        const ev = event?.target;
        if (ev) {
            ev.classList.add('active', 'bg-gray-800', 'text-gray-300', 'border-gray-700');
            ev.classList.remove('bg-gray-800/50', 'text-gray-500', 'border-gray-800');
        }
        this.renderBeds();
    },

    openModal(id) {
        const modal = document.getElementById(id);
        modal.classList.add('open');
    },

    closeModal(id) {
        const modal = document.getElementById(id);
        modal.classList.remove('open');
    },

    async addLog(action, metadata) {
        if (!this.state.hospital) return;
        await supabase.from('hospital_logs').insert([{
            hospital_id: this.state.hospital.id,
            action,
            metadata: JSON.stringify(metadata)
        }]);
    },

    haversineKm(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const colors = {
            success: 'bg-green-500/90 border-green-400',
            error: 'bg-red-500/90 border-red-400',
            warning: 'bg-yellow-500/90 border-yellow-400 text-black',
            info: 'bg-blue-500/90 border-blue-400',
        };

        const toast = document.createElement('div');
        toast.className = `px-5 py-3 rounded-xl border text-sm font-bold text-white backdrop-blur-sm shadow-xl animate-slideUp ${colors[type] || colors.info}`;
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
        // Log filters
        document.getElementById('logSearchInput')?.addEventListener('input', () => this.renderLogs());
        document.getElementById('logFilterType')?.addEventListener('change', () => this.renderLogs());
        document.getElementById('logFilterDate')?.addEventListener('change', () => this.renderLogs());
    }
};

// ==========================================
// 🚀 Auto-init
// ==========================================
window.HospitalApp = HospitalApp;
document.addEventListener('DOMContentLoaded', () => HospitalApp.init());
