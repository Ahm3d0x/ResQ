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
        killedAmbulances: new Set(),
    },

    // ==========================================
    // 🔐 Initialization & Authentication
    // ==========================================
    async init() {
        console.log("🏥 Initializing Hospital Dashboard V1.0...");
// 🌟 ADD THIS: Apply saved theme BEFORE initializing the map
        const savedTheme = localStorage.getItem('hospital_theme') || 'dark';
        if (savedTheme === 'light') {
            document.documentElement.classList.remove('dark');
            const themeIcon = document.getElementById('themeIcon');
            if (themeIcon) themeIcon.className = 'fa-solid fa-sun';
        }
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
        this.initMap();
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
// ==========================================
    // 🗺️ Map System (5KM Radar)
    // ==========================================
    initMap() {
        // 1. Prevent duplicate maps from breaking things
        if (this.state.map) return; 

        const lat = parseFloat(this.state.hospital?.lat) || 30.0444;
        const lng = parseFloat(this.state.hospital?.lng) || 31.2357;

        this.state.map = L.map('hospital-map', { 
            zoomControl: false, 
            attributionControl: false 
        }).setView([lat, lng], 14);

        // 2. Define our map URLs clearly
        const mapThemes = {
            dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
            light: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
        };

        // 3. Check current theme right now
        const isDark = document.documentElement.classList.contains('dark');

        // 4. Create the base layer AND save it to state
        this.state.baseLayer = L.tileLayer(isDark ? mapThemes.dark : mapThemes.light, { 
            maxZoom: 19 
        }).addTo(this.state.map);

        // 🌟 5. BULLETPROOF THEME WATCHER
        // This watches the <html> tag. The millisecond "dark" is added or removed, 
        // it forces the map to update, bypassing any other bugs.
        const observer = new MutationObserver(() => {
            const isDarkNow = document.documentElement.classList.contains('dark');
            if (this.state.baseLayer) {
                this.state.baseLayer.setUrl(isDarkNow ? mapThemes.dark : mapThemes.light);
            }
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

        // ========================================================
        // 🏥 Keep your existing marker code below this line:
        // ========================================================
        
        // Hospital marker
        this.state.hospitalMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'custom-div-icon',
                html: `<div class="w-12 h-12 bg-hospital-card rounded-xl border-2 border-hospital-accent flex items-center justify-center shadow-lg shadow-hospital-accent/20">
                        <i class="fa-solid fa-hospital text-hospital-accent text-xl animate-pulse"></i>
                       </div>`,
                iconSize: [48, 48],
                iconAnchor: [24, 24]
            })
        }).addTo(this.state.map);

        // 5KM Radar Circle
        this.state.radiusCircle = L.circle([lat, lng], {
            radius: PROXIMITY_RADIUS_KM * 1000,
            color: '#10b981',
            fillColor: '#10b981',
            fillOpacity: 0.05,
            weight: 1,
            dashArray: '5, 10'
        }).addTo(this.state.map);
    },
    // 🌟 3. Add Theme Toggle Function
    toggleTheme() {
        const html = document.documentElement;
        const isDarkNow = html.classList.toggle('dark'); 
        
        // Save preference
        localStorage.setItem('hospital_theme', isDarkNow ? 'dark' : 'light');

        // Swap icon
        const themeIcon = document.getElementById('themeIcon');
        if (themeIcon) {
            themeIcon.className = isDarkNow ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
        }

        // Swap map tiles instantly
        if (this.state.baseLayer) {
            const darkUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
            const lightUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
            this.state.baseLayer.setUrl(isDarkNow ? darkUrl : lightUrl);
        }
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
        this.cleanupOrphanRoutes();
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
            const isArrived = ambStatus === 'busy' || inc.status === 'arrived_hospital';

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

    cleanupOrphanRoutes() {
        this.state.routeLayers.forEach((layer, ambId) => {
            const exists = this.state.incomingCases.some(
                c => String(c.assigned_ambulance_id) === String(ambId)
            );

            if (!exists) {
                this.state.map.removeLayer(layer);
                this.state.routeLayers.delete(ambId);
                console.log('[CLEANUP] Removed orphan route', ambId);
            }
        });
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
                
                // Add Real-time Incident Termination Listener
                if (payload.new && (payload.new.status === 'completed' || payload.new.status === 'cancelled')) {
                    const incId = payload.new.id;
                    const existingCase = this.state.incomingCases.find(c => c.id === incId);
                    const ambId = existingCase?.assigned_ambulance_id || payload.new.assigned_ambulance_id;
                    
                    // Remove case instantly from UI
                    this.state.incomingCases = this.state.incomingCases.filter(c => c.id !== incId);
                    
                    // Remove incident marker
                    if (this.state.incidentMarkers.has(incId)) {
                        this.state.map.removeLayer(this.state.incidentMarkers.get(incId));
                        this.state.incidentMarkers.delete(incId);
                        console.log('[MAP CLEANUP] Removed incident', incId);
                    }
                    
                    // FORCE cleanup (even لو مفيش existingCase)
                    if (ambId) {
                        this.state.killedAmbulances.add(String(ambId));
                        if (this.state.routeLayers.has(ambId)) {
                            this.state.map.removeLayer(this.state.routeLayers.get(ambId));
                            this.state.routeLayers.delete(ambId);
                            console.log('[MAP CLEANUP] Removed route for amb', ambId);
                        }
                        if (this.state.ambMarkers.has(ambId)) {
                            this.state.map.removeLayer(this.state.ambMarkers.get(ambId));
                            this.state.ambMarkers.delete(ambId);
                        }
                    }

                    this.state.map.invalidateSize();
                    this.cleanupOrphanRoutes();

                    this.showToast("تم إنهاء الحالة", "info");
                    
                    // Render updates
                    this.renderIncomingCases();
                    this.updateStats();
                } else {
                    await this.loadIncomingCases();

                    const isNewAssignment = payload.eventType === 'INSERT' || 
                        (payload.eventType === 'UPDATE' && payload.new.status === 'assigned' && payload.old?.status !== 'assigned');

                    if (isNewAssignment) {
                        const alreadyLogged = this.state.logs.some(l => {
                            const meta = typeof l.metadata === 'string' ? JSON.parse(l.metadata || '{}') : (l.metadata || {});
                            return l.action === 'incident_received' && meta.incident_id == payload.new.id;
                        });

                        if (!alreadyLogged) {
                            this.showToast('🚨 حالة طوارئ جديدة واردة!', 'warning');
                            await this.addLog('incident_received', { incident_id: payload.new.id, note: 'تم استلام حالة طوارئ جديدة' });
                            await this.loadLogs(); // Refresh logs to ensure it's in state
                        }
                    }
                }
            }).subscribe();

        // Listen to ambulance status changes to load incoming cases if ambulance status changed 
        supabase.channel('hospital-amb-watch')
            .on('postgres_changes', {
                event: 'UPDATE', schema: 'public', table: DB_TABLES.AMBULANCES
            }, async (payload) => {
                const ambId = payload.new.id;
                const relevantCase = this.state.incomingCases.find(c => c.assigned_ambulance_id === ambId);
                if (!relevantCase) return;
                await this.loadIncomingCases();
            }).subscribe();
    },

    setupTrackingChannel() {
        this.state.trackingChannel = supabase.channel('live-tracking');
        if (!this.state.proximityCache) this.state.proximityCache = new Map();

        this.state.trackingChannel.on('broadcast', { event: 'fleet_update' }, (payload) => {
            const fleet = payload.payload;
            if (!fleet || !Array.isArray(fleet)) return;

            // Filter to only ambulances assigned to this hospital's cases
            const assignedAmbIds = new Set(this.state.incomingCases.map(c => String(c.assigned_ambulance_id)));

            fleet.forEach(amb => {
                if (!assignedAmbIds.has(String(amb.id))) return;

                const ambLat = parseFloat(amb.lat);
                const ambLng = parseFloat(amb.lng);
                const latLng = [ambLat, ambLng];

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

                // Proximity Logic - Only trigger if heading to hospital
                const relevantCase = this.state.incomingCases.find(c => String(c.assigned_ambulance_id) === String(amb.id));
                if (relevantCase && amb.stage === 'to_hospital') {
                    const dist = this.haversineKm(
                        parseFloat(this.state.hospital.lat), parseFloat(this.state.hospital.lng),
                        ambLat, ambLng
                    );

                    let newState = 'far';
                    let cardClass = '';
                    if (dist <= 0.5) { newState = 'arriving'; cardClass = 'arriving'; }
                    else if (dist <= 2) { newState = 'very_near'; cardClass = 'very-near'; }
                    else if (dist <= 5) { newState = 'near'; cardClass = 'nearby'; }

                    const currentState = this.state.proximityCache.get(amb.id) || 'far';
                    
                    if (newState !== currentState && newState !== 'far') {
                        this.state.proximityCache.set(amb.id, newState);
                        
                        const card = document.querySelector(`[data-inc-id="${relevantCase.id}"]`);
                        if (card) {
                            card.classList.remove('nearby', 'very-near', 'arriving');
                            card.classList.add(cardClass);
                        }

                        const ambCode = relevantCase.ambulances?.code || amb.id;
                        
                        if (newState === 'arriving') {
                            console.log("[PROXIMITY] ARRIVING");
                            this.showToast(`🚨 إسعاف ${ambCode} وصل إلى المستشفى! (${dist.toFixed(2)} كم)`, 'warning');
                        } else if (newState === 'very_near') {
                            console.log("[PROXIMITY] VERY NEAR");
                            this.showToast(`🚑 إسعاف ${ambCode} قريب جداً! (${dist.toFixed(1)} كم)`, 'info');
                        } else if (newState === 'near') {
                            console.log("[PROXIMITY] ENTERED RADIUS");
                            this.showToast(`🚑 إسعاف ${ambCode} دخل النطاق! (${dist.toFixed(1)} كم)`, 'info');
                        }
                    }
                }
            });
        })
        .on('broadcast', { event: 'route_established' }, (payload) => {
            const data = payload.payload;
            if (!data || !data.geometry) return;

            // Only show route for active mission stages
            if (data.stage !== 'to_incident' && data.stage !== 'to_hospital') return;

            if (this.state.killedAmbulances.has(String(data.ambId))) {
                console.log('[BLOCK] Dead ambulance route prevented');
                return;
            }

            const relatedCase = this.state.incomingCases.find(
                c => String(c.assigned_ambulance_id) === String(data.ambId)
            );

            // ❌ HARD BLOCK (NEW)
            if (!relatedCase) {
                console.log('[BLOCK] No related case → skip route draw');

                if (this.state.routeLayers.has(data.ambId)) {
                    this.state.map.removeLayer(this.state.routeLayers.get(data.ambId));
                    this.state.routeLayers.delete(data.ambId);
                }

                return;
            }

            // ❌ HARD BLOCK 2
            if (['completed', 'cancelled', 'hospital_confirmed'].includes(relatedCase.status)) {
                console.log('[BLOCK] Case inactive → skip route draw');

                if (this.state.routeLayers.has(data.ambId)) {
                    this.state.map.removeLayer(this.state.routeLayers.get(data.ambId));
                    this.state.routeLayers.delete(data.ambId);
                }

                return;
            }

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
            // VERIFICATION: Check if incident already has a bed mapped organically
            const { data: existingMap } = await supabase.from('hospital_beds').select('id').eq('incident_id', incidentId).limit(1);
            if (existingMap && existingMap.length > 0) {
                this.showToast('⚠️ تم تعيين سرير لهذه الحالة مسبقاً!', 'error');
                return;
            }
            // 1. Update incident to hospital_confirmed (patient admitted, NOT discharged yet).
            // The incident is still ACTIVE — 'completed' only happens at discharge.
            await supabase.from(DB_TABLES.INCIDENTS).update({ status: 'hospital_confirmed' }).eq('id', incidentId);

            // NOTE: Ambulance is NOT freed here. It remains 'busy' until discharge.
            // The Engine Simulator handles ambulance mission stage via its own realtime listener.

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

        if (bed.incident_id) {
            const { data: incident } = await supabase.from(DB_TABLES.INCIDENTS).select('device_id, assigned_ambulance_id').eq('id', bed.incident_id).single();
            
            // Complete the incident — this is the ONLY place an incident becomes 'completed'
            await supabase.from(DB_TABLES.INCIDENTS).update({
                status: 'completed',
                resolved_at: new Date().toISOString(),
                outcome: 'recovered'
            }).eq('id', bed.incident_id);
            console.log("[LIFECYCLE] INCIDENT COMPLETED via hospital discharge");

            // NOTE: Ambulance was already released to 'available' at hospital_confirmed.
            // No need to update ambulance status here.

            // Recover the device so it can resume movement on the admin dashboard
            if (incident && incident.device_id) {
                await supabase.from(DB_TABLES.DEVICES).update({ status: 'active' }).eq('id', incident.device_id);
                console.log("[DEVICE] RECOVERY TRIGGERED — device resumes simulation");
            }

            if (incident) {
                window.dispatchEvent(new CustomEvent('engine:incident_completed', {
                    detail: {
                        incidentId: bed.incident_id,
                        deviceId: incident.device_id,
                        outcome: 'recovered'
                    }
                }));
            }
        }

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

        if (bed.incident_id) {
            const { data: incident } = await supabase.from(DB_TABLES.INCIDENTS).select('device_id, assigned_ambulance_id').eq('id', bed.incident_id).single();
            
            // Complete the incident with deceased outcome
            await supabase.from(DB_TABLES.INCIDENTS).update({
                status: 'completed',
                resolved_at: new Date().toISOString(),
                outcome: 'deceased',
                patient_status: 'deceased'
            }).eq('id', bed.incident_id);
            console.log("[LIFECYCLE] INCIDENT COMPLETED (deceased)");

            // NOTE: Ambulance was already released to 'available' at hospital_confirmed.

            // Suspend the device — owner is deceased, device locked until family takes over
            if (incident && incident.device_id) {
                await supabase.from(DB_TABLES.DEVICES).update({ status: 'suspended' }).eq('id', incident.device_id);
                console.log("[DEVICE] SUSPENDED — owner deceased");
            }
            
            if (incident) {
                window.dispatchEvent(new CustomEvent('engine:incident_completed', {
                    detail: {
                        incidentId: bed.incident_id,
                        deviceId: incident.device_id,
                        outcome: 'deceased'
                    }
                }));
            }
        }
        console.log("[PATIENT] DECEASED FLOW EXECUTED");

        // Free bed
        await supabase.from('hospital_beds').update({
            status: 'available',
            patient_name: null,
            patient_id: null,
            incident_id: null,
            admission_time: null
        }).eq('id', bedId);

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

    async viewBedDetails(bedId) {
        const bed = this.state.beds.find(b => b.id === bedId);
        if (!bed) return;

        const content = document.getElementById('bedModalContent');
        content.innerHTML = `<div class="flex justify-center p-8"><i class="fa-solid fa-circle-notch fa-spin text-3xl text-hospital-accent"></i></div>`;
        this.openModal('bedModal');

        const isOccupied = bed.status === 'occupied';
        const isBlocked = bed.status === 'blocked';

        let uiHtml = '';

        if (!isOccupied || !bed.incident_id) {
            // Render basic view
            uiHtml = `
                <div class="space-y-4">
                    <div class="bg-gray-800 rounded-xl p-4">
                        <div class="grid grid-cols-2 gap-4 text-sm">
                            <div><span class="text-gray-500 text-[10px] block">رقم السرير</span><span class="font-bold text-white">#${bed.bed_number || bed.id}</span></div>
                            <div><span class="text-gray-500 text-[10px] block">الحالة</span><span class="font-bold ${isBlocked ? 'text-gray-500' : 'text-green-400'}">${isBlocked ? 'معطّل' : 'متاح'}</span></div>
                        </div>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="HospitalApp.toggleBlockBed(${bed.id})" class="flex-1 py-2.5 rounded-lg border font-bold text-sm transition ${isBlocked ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-gray-700 text-gray-300 border-gray-600'}">
                            <i class="fa-solid ${isBlocked ? 'fa-lock-open' : 'fa-ban'} ml-1"></i> ${isBlocked ? 'إلغاء التعطيل' : 'تعطيل السرير'}
                        </button>
                    </div>
                </div>
            `;
        } else {
            // New Pipeline Logic
            // 1. Fetch Incident
            const { data: incident } = await supabase.from(DB_TABLES.INCIDENTS).select('*').eq('id', bed.incident_id).single();
            if (!incident) {
                content.innerHTML = `<div class="text-center p-6 text-red-400 border border-red-500/30 bg-red-500/10 rounded-xl">خطأ: بيانات الحادث غير موجودة.</div>`;
                return;
            }

            // 2. Fetch Base Device & Application sequentially
            let device = null;
            let profile = null;
            if (incident.device_id) {
                const { data: d } = await supabase.from(DB_TABLES.DEVICES).select('*').eq('id', incident.device_id).single();
                device = d;
                
                // 3. Fetch Application (Profile bound explicitly by ID to avoid overlapping fields)
                if (device && device.application_id) {
                    const { data: p } = await supabase.from('device_applications').select('*').eq('id', device.application_id).single();
                    profile = p;
                }
            }

            // Parallel Sub-fetches
            const [ { data: logs }, { data: amb }, { count: bedsCount } ] = await Promise.all([
                supabase.from(DB_TABLES.INCIDENT_LOGS).select('*').eq('incident_id', incident.id).order('created_at', { ascending: true }),
                incident.assigned_ambulance_id ? supabase.from(DB_TABLES.AMBULANCES).select('*').eq('id', incident.assigned_ambulance_id).single() : Promise.resolve({ data: null }),
                supabase.from('hospital_beds').select('id', { count: 'exact' }).eq('incident_id', incident.id)
            ]);

            // [REQUIRED DEBUGGING METRIC]
            console.log("[DEBUG: BED_MODAL] =>", {
                incident_id: incident.id,
                device_id: device?.id || null,
                application_id: device?.application_id || null,
                patient_found: !!profile,
                logs_count: logs?.length || 0,
                overlapping_beds: bedsCount
            });

            // Standardized Required Timeline Engine
            const ACTION_MAP = {
                incident_created: { label: 'تم تسجيل الحادث', icon: 'fa-triangle-exclamation', color: 'text-red-400', border: 'border-red-500/50' },
                assigned: { label: 'تم تعيين الإسعاف', icon: 'fa-truck-medical', color: 'text-blue-400', border: 'border-blue-500/50' },
                driver_timeout: { label: 'لم يتم الرد من السائق', icon: 'fa-user-clock', color: 'text-orange-400', border: 'border-orange-500/50' },
                reassigned: { label: 'إعادة تعيين إسعاف', icon: 'fa-rotate', color: 'text-yellow-400', border: 'border-yellow-500/50' },
                accepted: { label: 'تم قبول المهمة', icon: 'fa-check', color: 'text-green-400', border: 'border-green-500/50' },
                en_route_incident: { label: 'في الطريق لتلبية الحادث', icon: 'fa-route', color: 'text-yellow-400', border: 'border-yellow-500/50' },
                arrived: { label: 'وصول الإسعاف للحادث', icon: 'fa-location-dot', color: 'text-green-500', border: 'border-green-500/50' },
                pickup: { label: 'استلام المريض', icon: 'fa-bed-pulse', color: 'text-purple-400', border: 'border-purple-500/50' },
                en_route_hospital: { label: 'في الطريق إلى المستشفى', icon: 'fa-truck-fast', color: 'text-blue-500', border: 'border-blue-500/50' },
                arrived_hospital: { label: 'الوصول للمستشفى', icon: 'fa-hospital', color: 'text-green-400', border: 'border-green-500/50' },
                hospital_confirmed: { label: 'تم استلام الحالة', icon: 'fa-clipboard-check', color: 'text-hospital-accent', border: 'border-hospital-accent' },
                completed: { label: 'تم إنهاء الحادث بنجاح', icon: 'fa-flag-checkered', color: 'text-gray-400', border: 'border-gray-500/50' },
                patient_admitted: { label: 'دخول المستشفى', icon: 'fa-user-plus', color: 'text-hospital-accent', border: 'border-hospital-accent' }
            };

            const timelineHtml = (logs && logs.length > 0) ? logs.map((log, idx) => {
                const conf = ACTION_MAP[log.action] || { label: log.action, icon: 'fa-circle-info', color: 'text-gray-400', border: 'border-gray-600' };
                const isLast = idx === logs.length - 1;
                return `
                    <div class="relative flex gap-4 ${!isLast ? 'pb-6' : ''}">
                        ${!isLast ? `<div class="absolute right-4 top-8 bottom-0 w-0.5 bg-gray-700"></div>` : ''}
                        <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${conf.border} bg-gray-800 ${conf.color} z-10">
                            <i class="fa-solid ${conf.icon} text-[10px]"></i>
                        </div>
                        <div class="flex-1 min-w-0 bg-gray-800/50 rounded-lg p-3 border border-gray-700/50 flex flex-col justify-center">
                            <div class="flex justify-between items-center mb-1">
                                <span class="text-xs font-bold ${conf.color}">${conf.label}</span>
                                <span class="text-[10px] text-gray-500 font-mono bg-gray-900 px-2 py-0.5 rounded border border-gray-700">${new Date(log.created_at).toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'})}</span>
                            </div>
                            <div class="flex justify-between items-center mt-1">
                                <div class="text-[10px] text-gray-400">${log.note || ''}</div>
                                <div class="text-[9px] text-gray-600 uppercase tracking-widest">${log.performed_by || 'SYSTEM'}</div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('') : '<div class="text-xs text-red-500 font-bold bg-red-900/20 border border-red-900/50 rounded-lg p-4 text-center">لا توجد سجلات بعد</div>';

            const patientBanner = profile 
                ? '' 
                : `<div class="col-span-2 bg-red-900/40 border border-red-500/50 text-red-300 rounded-xl p-3 mb-4 text-center text-xs font-bold w-full"><i class="fa-solid fa-triangle-exclamation ml-1"></i> لا توجد بيانات التقديم الطبية (Profile) مرتبطة بجهاز المريض حالياً!</div>`;
                
            const bedOverlapBanner = (bedsCount > 1)
                ? `<div class="bg-yellow-900/40 border border-yellow-500/50 text-yellow-300 rounded-xl p-3 mt-4 text-center text-xs font-bold"><i class="fa-solid fa-triangle-exclamation ml-1"></i> تنبيه: يوجد أكثر من سرير محجوز لهذا الحادث! يجب إغلاق التكرارات للمحافظة على البيانات.</div>`
                : '';

            uiHtml = `
                <!-- HEADER BADGE -->
                <div class="bg-hospital-card border border-hospital-border rounded-xl p-4 mb-4 flex flex-col sm:flex-row sm:justify-between items-start sm:items-center bg-gray-800 gap-4 shadow-lg shadow-black/20">
                    <div class="flex items-center gap-4">
                        <div class="w-14 h-14 bg-red-500/20 border border-red-500/30 text-red-400 rounded-xl flex items-center justify-center font-black text-2xl shrink-0">
                            #${bed.bed_number || bed.id}
                        </div>
                        <div>
                            <div class="text-[10px] text-gray-400 uppercase tracking-widest font-black mb-1">غرفة الإنقاذ (السرير المحجوز)</div>
                            <div class="text-sm font-bold text-red-400 bg-red-900/30 px-3 py-1 rounded inline-block border border-red-900/50">مشغول بالحالة #${incident.id}</div>
                        </div>
                    </div>
                    <div class="text-right sm:text-left w-full sm:w-auto bg-gray-900 p-3 rounded-xl border border-gray-700">
                        <div class="text-[10px] text-gray-500 mb-1"><i class="fa-solid fa-clock ml-1"></i> وقت الدخول للمستشفى</div>
                        <div class="text-sm font-mono text-gray-300 font-bold">${bed.admission_time ? new Date(bed.admission_time).toLocaleString('ar-EG') : 'غير معروف'}</div>
                    </div>
                </div>
                ${bedOverlapBanner}

                <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 max-h-[60vh] overflow-y-auto pr-2 mt-4 custom-scrollbar">
                    
                    ${patientBanner}

                    <!-- LEFT COLUMN: Incident & Logistics -->
                    <div class="space-y-5">
                        
                        <!-- Incident Card -->
                        <div class="bg-gray-800 rounded-xl p-5 border border-gray-700 shadow-md">
                            <h4 class="text-xs font-black text-gray-400 uppercase mb-4 border-b border-gray-700 pb-3 flex justify-between items-center">
                                <span><i class="fa-solid fa-car-burst text-orange-400 ml-2"></i> تفاصيل الحادث (Telemetry)</span>
                                <span class="bg-orange-500/20 text-orange-400 px-3 py-1 rounded text-[10px] tracking-wider">${incident.mode === 'auto' ? 'استشعار تلقائي' : 'بلاغ يدوي'}</span>
                            </h4>
                            <div class="grid grid-cols-2 gap-4 text-sm">
                                <div class="flex flex-col bg-gray-900/50 p-3 rounded-lg border border-gray-800"><span class="text-[10px] text-gray-500 mb-1">قوة الصدمة</span><span class="font-mono text-lg text-red-400 font-bold" dir="ltr">${incident.g_force ? parseFloat(incident.g_force).toFixed(2) + ' G' : '-'}</span></div>
                                <div class="flex flex-col bg-gray-900/50 p-3 rounded-lg border border-gray-800"><span class="text-[10px] text-gray-500 mb-1">السرعة لحظة الحادث</span><span class="font-mono text-lg text-white" dir="ltr">${incident.speed ? Math.round(incident.speed) + ' km/h' : '-'}</span></div>
                                <div class="flex flex-col col-span-2 mt-1">
                                    <span class="text-[10px] text-gray-500 mb-2">الموقع الجغرافي للحادث</span>
                                    <div class="flex items-center justify-between bg-gray-900 px-3 py-2.5 rounded-lg border border-gray-700">
                                        <span class="font-mono text-xs text-blue-300" dir="ltr">${incident.latitude?.toFixed(5) || '-'}, ${incident.longitude?.toFixed(5) || '-'}</span>
                                        ${(incident.latitude && incident.longitude) ? `<button onclick="window.open('https://maps.google.com/?q=${incident.latitude},${incident.longitude}', '_blank')" class="text-[10px] bg-blue-600 hover:bg-blue-500 border border-blue-400 text-white px-3 py-1.5 rounded transition font-bold"><i class="fa-solid fa-map-location-dot ml-1"></i> الخريطة</button>` : ''}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Logistics Card -->
                        <div class="bg-gray-800 rounded-xl p-5 border border-gray-700 shadow-md">
                            <h4 class="text-xs font-black text-gray-400 uppercase mb-4 border-b border-gray-700 pb-3"><i class="fa-solid fa-truck-medical text-hospital-info ml-2"></i> بيانات وحدة الإسعاف</h4>
                            <div class="space-y-3 text-sm">
                                ${amb ? `
                                    <div class="flex justify-between items-center bg-gray-900/50 p-3 rounded-lg border border-gray-700 border-l-4 border-l-hospital-info"><span class="text-gray-400">كود الوحدة المتجهة:</span> <span class="font-black text-lg text-blue-400 bg-blue-500/10 px-3 py-1 rounded" dir="ltr">${amb.code || '-'}</span></div>
                                    <div class="flex justify-between items-center px-2"><span class="text-gray-500">الحالة التشغيلية الحالية:</span> <span class="text-xs font-bold text-gray-300 uppercase tracking-widest bg-gray-700 px-2 py-1 rounded">${amb.status || '-'}</span></div>
                                    <div class="flex justify-between items-center px-2"><span class="text-gray-500">السائق المكلف:</span> <span class="text-xs font-mono text-gray-400 bg-gray-900 px-2 py-1 rounded">معرف السائق: ${amb.driver_id || 'غير مخصص'}</span></div>
                                ` : '<div class="text-gray-500 text-xs font-bold text-center py-4 bg-gray-900/50 rounded-lg border border-gray-800">لا يوجد إسعاف مخصص لهذه الحالة حتى الآن.</div>'}
                            </div>
                        </div>
                    </div>

                    <!-- RIGHT COLUMN: Patient, Medical & Emergency Contacts -->
                    <div class="space-y-5 text-sm">
                        
                        <!-- Patient Card -->
                        <div class="bg-gray-800 rounded-xl p-5 border border-gray-700 shadow-md relative overflow-hidden">
                            <div class="absolute top-0 right-0 w-2 h-full bg-blue-500"></div>
                            <h4 class="text-xs font-black text-gray-400 uppercase mb-4 border-b border-gray-700 pb-3 pr-2"><i class="fa-solid fa-user text-blue-400 ml-2"></i> الهوية الشخصية للمريض</h4>
                            <div class="space-y-3">
                                <div class="flex justify-between items-center bg-gray-900/50 px-3 py-2 rounded-lg border border-gray-700/50"><span class="text-gray-500">الاسم بالكامل:</span> <span class="font-bold text-base text-white">${profile?.full_name ? profile.full_name : '<span class="text-gray-500 text-xs font-normal">بيانات المريض غير متوفرة</span>'}</span></div>
                                <div class="flex justify-between items-center px-3 py-1"><span class="text-gray-500">رقم التواصل:</span> <span class="font-mono text-gray-300 tracking-wider">${profile?.phone || '-'}</span></div>
                                <div class="flex justify-between items-center px-3 py-1"><span class="text-gray-500">البريد الإلكتروني:</span> <span class="font-mono text-gray-400 text-xs">${profile?.email || '-'}</span></div>
                            </div>
                        </div>
                        
                        <!-- Medical Card -->
                        <div class="bg-gray-800 rounded-xl p-5 border border-gray-700 shadow-md relative overflow-hidden">
                            <div class="absolute top-0 right-0 w-2 h-full bg-red-500"></div>
                            <h4 class="text-xs font-black text-gray-400 uppercase mb-4 border-b border-gray-700 pb-3 pr-2"><i class="fa-solid fa-notes-medical text-red-500 ml-2"></i> السجل الطبي التفصيلي</h4>
                            
                            <div class="grid grid-cols-2 gap-4 mb-4">
                                <div class="bg-red-900/10 rounded-xl p-3 border border-red-900/30 flex flex-col items-center justify-center text-center shadow-inner">
                                    <span class="text-[10px] text-gray-500 uppercase tracking-widest"><i class="fa-solid fa-droplet text-red-500 mb-1"></i> فصيلة الدم</span>
                                    <span class="text-2xl font-black text-red-500 mt-1 drop-shadow" dir="ltr">${profile?.blood_type || '؟'}</span>
                                </div>
                                <div class="bg-gray-900/80 rounded-xl p-3 border border-gray-700 flex flex-col justify-center">
                                    <div class="flex items-center justify-between mb-2">
                                        <span class="text-[10px] text-gray-400 uppercase tracking-widest">الأدوية المعتادة</span>
                                        <i class="fa-solid fa-pills text-gray-600 text-xs"></i>
                                    </div>
                                    <div class="text-xs text-white font-bold leading-relaxed">${profile?.medications || 'لا تنطبق'}</div>
                                </div>
                            </div>
                            
                            <div class="grid grid-cols-2 gap-4 text-[10px]">
                                <div>
                                    <span class="text-gray-500 block mb-1.5 uppercase font-bold tracking-wider"><i class="fa-solid fa-virus text-gray-600"></i> الحساسية (Allergies)</span>
                                    <div class="bg-gray-900/80 p-3 rounded-lg text-white font-bold border border-gray-700 min-h-[3rem] shadow-inner">${profile?.allergies || 'لا توجد'}</div>
                                </div>
                                <div>
                                    <span class="text-gray-500 block mb-1.5 uppercase font-bold tracking-wider"><i class="fa-solid fa-staff-snake text-gray-600"></i> الأمراض المزمنة</span>
                                    <div class="bg-gray-900/80 p-3 rounded-lg text-white font-bold border border-gray-700 min-h-[3rem] shadow-inner">${profile?.medical_conditions || 'لا توجد'}</div>
                                </div>
                            </div>

                            ${profile?.notes ? `<div class="mt-4 bg-yellow-900/10 border border-yellow-900/30 p-3 rounded-lg border-r-2 border-r-yellow-500"><div class="text-[10px] text-yellow-500 font-bold mb-1 uppercase tracking-wider">ملاحظات طبية إضافية</div><div class="text-xs text-yellow-100">${profile.notes}</div></div>` : ''}
                        </div>

                        <!-- Emergency Contacts (NEW) -->
                        <div class="bg-gray-800 rounded-xl p-5 border border-gray-700 shadow-md relative overflow-hidden">
                            <div class="absolute top-0 right-0 w-2 h-full bg-orange-500"></div>
                            <h4 class="text-xs font-black text-gray-400 uppercase mb-4 border-b border-gray-700 pb-3 pr-2"><i class="fa-solid fa-phone-volume text-orange-400 ml-2 animate-pulse"></i> جهات الاتصال للطورائ (Emergency)</h4>
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <!-- Contact 1 -->
                                <div class="bg-gray-900/80 rounded-xl p-4 border border-orange-500/30 shadow-inner">
                                    <div class="text-[10px] text-orange-400 font-bold mb-2 flex justify-between items-center">
                                        <span>رقم (1) - رئيسية</span> <i class="fa-solid fa-star text-orange-500"></i>
                                    </div>
                                    <div class="font-black text-white text-sm mb-1">${profile?.emergency1_name || 'غير مدخل'} 
                                        ${profile?.emergency1_relation ? `<span class="inline-block bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded text-[9px] font-normal mr-1 align-top">${profile.emergency1_relation}</span>` : ''}
                                    </div>
                                    <div class="font-mono text-gray-400 text-xs bg-gray-800 px-2 py-1 rounded inline-block w-full border border-gray-700/50 mt-1">${profile?.emergency1_phone || 'لا يوجد هاتف'}</div>
                                </div>
                                <!-- Contact 2 -->
                                ${profile?.emergency2_name ? `
                                <div class="bg-gray-900/80 rounded-xl p-4 border border-gray-700 shadow-inner">
                                    <div class="text-[10px] text-gray-500 font-bold mb-2">رقم (2) - ثانوية</div>
                                    <div class="font-bold text-gray-300 text-sm mb-1">${profile?.emergency2_name} 
                                        ${profile?.emergency2_relation ? `<span class="inline-block bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded text-[9px] font-normal mr-1 align-top">${profile.emergency2_relation}</span>` : ''}
                                    </div>
                                    <div class="font-mono text-gray-500 text-xs bg-gray-800 px-2 py-1 rounded inline-block w-full border border-gray-700/50 mt-1">${profile?.emergency2_phone || 'لا يوجد هاتف'}</div>
                                </div>
                                ` : '<div class="bg-gray-900/30 rounded-xl p-4 border border-gray-800/50 border-dashed flex flex-col items-center justify-center text-gray-600 h-full"><i class="fa-solid fa-user-xmark mb-2 opacity-50"></i><span class="text-[10px] font-bold">جهة ثانية غير مسجلة</span></div>'}
                            </div>
                        </div>

                    </div>

                    <!-- BOTTOM TIMELINE -->
                    <div class="col-span-1 lg:col-span-2 mt-2">
                        <div class="bg-gray-800 rounded-xl p-5 border border-gray-700 shadow-md">
                            <h4 class="text-xs font-black text-gray-400 uppercase mb-5 border-b border-gray-700 pb-3 flex justify-between items-center">
                                <span><i class="fa-solid fa-clock-rotate-left text-hospital-accent ml-2"></i> التسلسل الزمني الكامل للاستجابة</span>
                                <span class="bg-gray-700 text-gray-300 px-2 py-0.5 rounded text-[10px] font-mono tracking-widest">${logs?.length || 0} LOGS</span>
                            </h4>
                            <div class="pr-3 pl-2 py-2 relative">
                                ${timelineHtml}
                            </div>
                        </div>
                    </div>

                </div>

                <!-- ACTION BAR -->
                <div class="flex gap-3 mt-6 pt-5 border-t border-gray-700 flex-wrap justify-between">
                    <button onclick="HospitalApp.dischargeBed(${bed.id})" class="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 border border-blue-500 text-white font-black text-sm transition shadow-lg shrink-0 w-full md:w-auto">
                        <i class="fa-solid fa-right-from-bracket ml-2"></i> إتمام العلاج / مغادرة المريض للمنزل
                    </button>
                    <div class="flex gap-3 w-full md:w-auto flex-1 md:flex-none">
                        <button onclick="HospitalApp.markDeceased(${bed.id})" class="flex-1 md:flex-none py-3 px-6 rounded-xl bg-red-900/30 hover:bg-red-900/60 text-red-400 font-bold text-sm transition border border-red-500/50 shadow-inner hover:shadow-red-500/10">
                            <i class="fa-solid fa-skull-crossbones ml-1"></i> الوفاة
                        </button>
                        <button onclick="HospitalApp.toggleBlockBed(${bed.id})" class="flex-1 md:flex-none py-3 px-6 rounded-xl bg-gray-700/50 hover:bg-gray-700 text-gray-300 font-bold text-sm transition border border-gray-600 shadow-inner">
                            <i class="fa-solid ${isBlocked ? 'fa-lock-open' : 'fa-ban'} ml-1"></i> ${isBlocked ? 'إلغاء تعطيل' : 'تعطيل السرير'}
                        </button>
                    </div>
                </div>
            `;
        }

        content.innerHTML = uiHtml;
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
