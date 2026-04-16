// ============================================================================
// 🚑 EnQaZ Driver Dashboard - Tactical Navigation & Mission Control (V7.1 Fixed)
// ============================================================================

import { supabase } from '../config/supabase.js';
import { t, currentLang } from '../core/language.js';

// ==========================================
// 1. نظام إدارة واجهة المستخدم (UI Helpers)
// ==========================================
window.showModal = function(title, msg) {
    document.getElementById('modalTitle').innerText = title;
    document.getElementById('modalMsg').innerText = msg;
    const modal = document.getElementById('customModal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
};

window.closeModal = function() {
    const modal = document.getElementById('customModal');
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
};

window.toggleSidePanel = function() {
    document.getElementById('sidePanel').classList.toggle('translate-x-full');
};

// ==========================================
// 2. المحرك الرئيسي (Driver Engine)
// ==========================================
export const DriverApp = {
    state: {
        driverUser: null,
        ambulance: null,
        activeIncident: null,
        patientDetails: null,
        
        // 🗺️ عناصر الخريطة
        map: null,
        ambMarker: null,
        incidentMarker: null,
        hospitalMarker: null,
        routeLayer: null,
        currentTileLayer: null,
        
        isAutoTracking: true,
        isCompassLocked: false,
        currentLocation: { lat: 30.0444, lng: 31.2357 },
        
        isSimulationMode: true, 
        actualGpsWatchId: null,

        // 🎥 Camera & Marker smoothing
        targetCameraPos: null,
        currentCameraPos: null,
        targetMarkerPos: null,
        currentMarkerPos: null,
        cameraLoopId: null,
    },

    async init() {
        console.log("🚀 Initializing Driver Engine V7.1");
        
        await this.authenticateDriver();
        this.initMap();
        this.startTrackingSystem();
        await this.checkActiveIncidents();
        this.setupRealtimeListeners();
        this.bindEvents();
        this.startSmoothCameraLoop();
    },

    async authenticateDriver() {
        const sessionString = localStorage.getItem('resq_custom_session');
        const currentDriverId = sessionString ? JSON.parse(sessionString).id : null; 

        if (!currentDriverId) {
            window.showModal(t('alert'), 'لم يتم العثور على جلسة تسجيل دخول.');
            return;
        }

        const { data: ambData } = await supabase
            .from('ambulances')
            .select('*, users(*)')
            .eq('driver_id', currentDriverId)
            .single();

        if (!ambData) {
            window.showModal(t('error'), t('noAmb'));
            return;
        }
        
        this.state.ambulance = ambData;
        this.state.driverUser = ambData.users;
        this.state.currentLocation = { lat: ambData.lat || 30.0444, lng: ambData.lng || 31.2357 };
        
        document.getElementById('driverName').innerText = this.state.driverUser?.name || t('driverUnknown');
        document.getElementById('ambulanceCode').innerText = ambData.code;
    },

    // ==========================================
    // 🗺️ الخرائط والملاحة
    // ==========================================
    initMap() {
        if (window.map) { window.map.remove(); }

        this.state.map = L.map('map-container', { zoomControl: false }).setView([this.state.currentLocation.lat, this.state.currentLocation.lng], 16);
        window.map = this.state.map;

        this.updateMapTheme();

        this.state.ambMarker = L.marker([this.state.currentLocation.lat, this.state.currentLocation.lng], {
            icon: L.divIcon({
                className: 'custom-amb-marker',
                html: `<div class="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-[0_0_15px_rgba(37,99,235,0.6)] border-2 border-white dark:border-gray-800" style="transition: transform 0.3s linear"><i class="fa-solid fa-truck-medical text-lg"></i></div>`,
                iconSize: [48, 48], iconAnchor: [24, 24]
            }),
            zIndexOffset: 1000
        }).addTo(this.state.map);

        this.state.map.on('dragstart', () => {
            this.state.isAutoTracking = false;
            const btn = document.getElementById('trackToggleBtn');
            if (btn) {
                btn.classList.replace('bg-blue-500', 'bg-gray-400');
                btn.classList.remove('shadow-blue-500/30');
            }
        });
        
        this.state.map.on('dragend', () => {
            setTimeout(() => this.state.map.getContainer().classList.remove('is-interacting'), 500);
        });
    },

    updateMapTheme() {
        const isDark = document.documentElement.classList.contains('dark');
        const tileUrl = isDark 
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' 
            : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
            
        if (this.state.currentTileLayer) this.state.map.removeLayer(this.state.currentTileLayer);
        this.state.currentTileLayer = L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(this.state.map);
    },

    // 🎯 توقيع الأهداف ورسم المسار
    updateTacticalMap() {
        const inc = this.state.activeIncident;
        if (!inc) {
            this.clearTacticalMap();
            return;
        }

        const ambStatus = this.state.ambulance.status;

        // 1. توقيع المستشفى (ثابت طوال المهمة)
        if (!this.state.hospitalMarker && inc.hospitals) {
            this.state.hospitalMarker = L.marker([inc.hospitals.lat, inc.hospitals.lng], {
                icon: L.divIcon({
                    className: 'custom-hosp-marker',
                    html: `<div class="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center text-white shadow-lg border-2 border-white dark:border-gray-800"><i class="fa-solid fa-square-h text-xl"></i></div>`,
                    iconSize: [40, 40], iconAnchor: [20, 20]
                }),
                zIndexOffset: 800
            }).addTo(this.state.map);
        }

        // 2. المرحلة الأولى: متجه للحادث
        if (ambStatus === 'assigned' || ambStatus === 'en_route_incident' || ambStatus === 'arrived') {
            if (!this.state.incidentMarker) {
                this.state.incidentMarker = L.marker([inc.latitude, inc.longitude], {
                    icon: L.divIcon({
                        className: 'custom-inc-marker',
                        html: `<div class="w-10 h-10 bg-red-600 rounded-full flex items-center justify-center text-white shadow-[0_0_15px_rgba(220,38,38,0.8)] border-2 border-white dark:border-gray-800 animate-pulse"><i class="fa-solid fa-car-burst"></i></div>`,
                        iconSize: [40, 40], iconAnchor: [20, 20]
                    }),
                    zIndexOffset: 900
                }).addTo(this.state.map);
            }
            
            if (inc.route_geometry) {
                try {
                    let geo = typeof inc.route_geometry === 'string' ? JSON.parse(inc.route_geometry) : inc.route_geometry;
                    let coords = geo.coordinates.map(c => [c[1], c[0]]);
                    this.drawStableRoute(coords, '#ef4444'); 
                } catch(e){}
            }
        } 
        
        // 3. المرحلة الثانية: نقل للمستشفى
        else if (ambStatus === 'en_route_hospital' || ambStatus === 'busy') {
            if (this.state.incidentMarker) {
                this.state.map.removeLayer(this.state.incidentMarker);
                this.state.incidentMarker = null;
            }
            if (inc.route_geometry) {
                try {
                    let geo = typeof inc.route_geometry === 'string' ? JSON.parse(inc.route_geometry) : inc.route_geometry;
                    let coords = geo.coordinates.map(c => [c[1], c[0]]);
                    this.drawStableRoute(coords, '#3b82f6');
                } catch(e){}
            }
        }
    },

    // 🛣️ رسم المسار (Unified Routing)
    async drawStableRoute(coords, color) {
        if (!coords || coords.length === 0) return;
        if (this.state.routeLayer) this.state.map.removeLayer(this.state.routeLayer);
        
        this.state.routeLayer = L.polyline(coords, { 
            color: color || '#3b82f6', 
            weight: 7, 
            opacity: 0.9,
            lineCap: 'round',
            lineJoin: 'round',
            dashArray: '1, 12'
        }).addTo(this.state.map);
        
        this.state.map.fitBounds(this.state.routeLayer.getBounds(), { padding: [60, 60], maxZoom: 17 });
        this.state.isAutoTracking = false;
        
        setTimeout(() => {
            if (window.toggleTracking) window.toggleTracking();
        }, 4000);
    },

    clearTacticalMap() {
        if (this.state.incidentMarker) { this.state.map.removeLayer(this.state.incidentMarker); this.state.incidentMarker = null; }
        if (this.state.hospitalMarker) { this.state.map.removeLayer(this.state.hospitalMarker); this.state.hospitalMarker = null; }
        if (this.state.routeLayer) { this.state.map.removeLayer(this.state.routeLayer); this.state.routeLayer = null; }
    },

    // ==========================================
    // 🎥 Camera Smooth Follow Loop
    // ==========================================
    startSmoothCameraLoop() {
        const CAMERA_SMOOTHING = 0.08; // أعلى = أسرع
        const MARKER_SMOOTHING = 0.15; // LERP Marker Smoothing
        
        const loop = () => {
            // 1. Camera LERP
            if (this.state.isAutoTracking && this.state.targetCameraPos && !this.state.map._animatingZoom) {
                if (!this.state.currentCameraPos) {
                    this.state.currentCameraPos = { ...this.state.targetCameraPos };
                }

                const dLat = this.state.targetCameraPos.lat - this.state.currentCameraPos.lat;
                const dLng = this.state.targetCameraPos.lng - this.state.currentCameraPos.lng;

                this.state.currentCameraPos.lat += dLat * CAMERA_SMOOTHING;
                this.state.currentCameraPos.lng += dLng * CAMERA_SMOOTHING;

                if (Math.abs(dLat) > 0.000001 || Math.abs(dLng) > 0.000001) {
                    this.state.map.setView(
                        [this.state.currentCameraPos.lat, this.state.currentCameraPos.lng],
                        this.state.map.getZoom(),
                        { animate: false }
                    );
                }
            }
            
            // 2. Marker LERP (Tracking smoothness)
            if (this.state.targetMarkerPos && this.state.ambMarker) {
                if (!this.state.currentMarkerPos) {
                    this.state.currentMarkerPos = { ...this.state.targetMarkerPos };
                }
                
                const dLat = this.state.targetMarkerPos.lat - this.state.currentMarkerPos.lat;
                const dLng = this.state.targetMarkerPos.lng - this.state.currentMarkerPos.lng;
                
                this.state.currentMarkerPos.lat += dLat * MARKER_SMOOTHING;
                this.state.currentMarkerPos.lng += dLng * MARKER_SMOOTHING;
                
                this.state.currentLocation = { lat: this.state.currentMarkerPos.lat, lng: this.state.currentMarkerPos.lng };
                this.state.ambMarker.setLatLng([this.state.currentMarkerPos.lat, this.state.currentMarkerPos.lng]);
            }
            
            this.state.cameraLoopId = requestAnimationFrame(loop);
        };
        
        this.state.cameraLoopId = requestAnimationFrame(loop);
    },

    // ==========================================
    // 📡 نظام التتبع
    // ==========================================
    startTrackingSystem() {
        if (this.state.isSimulationMode) this.startSimulatedTracking();
        else this.startActualGpsTracking();
    },

    startSimulatedTracking() {
        const trackingChannel = supabase.channel('live-tracking');
        trackingChannel.on('broadcast', { event: 'fleet_update' }, (payload) => {
            if (!this.state.ambulance) return;

            const myAmb = payload.payload.find(a => String(a.id) === String(this.state.ambulance.id));
            if (myAmb) {
                // ✅ Update target marker directly instead of jumping
                this.state.targetMarkerPos = { lat: myAmb.lat, lng: myAmb.lng };
                
                // ✅ تحديث هدف الكاميرا بدلاً من تحريكها مباشرة
                if (this.state.isAutoTracking) {
                    this.state.targetCameraPos = { lat: myAmb.lat, lng: myAmb.lng };
                }
                
                if (this.state.isCompassLocked && myAmb.heading !== undefined) {
                    window.rotateMap(360 - myAmb.heading);
                }
            }
        })
        .on('broadcast', { event: 'route_established' }, (payload) => {
            if (!this.state.activeIncident) return; // Guard 
            const data = payload.payload;
            if (String(data.ambId) === String(this.state.ambulance.id)) {
                const color = data.stage === 'to_incident' ? '#ef4444' : '#3b82f6';
                this.drawStableRoute(data.geometry, color);
            }
        })
        .subscribe();
    },

    startActualGpsTracking() {
        if (!navigator.geolocation) return;
        this.state.actualGpsWatchId = navigator.geolocation.watchPosition(
            async (pos) => {
                const { latitude, longitude, heading } = pos.coords;
                const newLatLng = [latitude, longitude];
                
                this.state.currentLocation = { lat: latitude, lng: longitude };
                this.state.ambMarker.setLatLng(newLatLng);

                await supabase.from('ambulances').update({ lat: latitude, lng: longitude }).eq('id', this.state.ambulance.id);

                if (this.state.isAutoTracking) {
                    this.state.targetCameraPos = { lat: latitude, lng: longitude };
                }
                if (this.state.isCompassLocked && heading !== null) window.rotateMap(360 - heading);
            },
            (err) => console.warn("GPS Warning:", err),
            { enableHighAccuracy: true, maximumAge: 2000, timeout: 5000 }
        );
    },

    // ==========================================
    // 🧠 دورة حياة الحادث
    // ==========================================
    async checkActiveIncidents() {
        if (!this.state.ambulance) return;

        const { data: incident } = await supabase.from('incidents')
            .select('*, devices(car_plate, car_model, users(email)), hospitals(*)')
            .eq('assigned_ambulance_id', this.state.ambulance.id)
            .in('status', ['assigned', 'in_progress'])
            .order('created_at', { ascending: false }).limit(1)
            .maybeSingle();

        if (incident) {
            this.state.activeIncident = incident;
            await this.fetchPatientMedicalDetails(incident.devices?.users?.email);
            this.renderActiveIncident();
            this.updateTacticalMap();
        } else {
            this.state.activeIncident = null;
            this.renderIdleState();
            this.clearTacticalMap();
        }
    },

    async fetchPatientMedicalDetails(userEmail) {
        if (!userEmail) return;
        const { data } = await supabase.from('device_applications').select('*').eq('email', userEmail).maybeSingle();
        this.state.patientDetails = data;
    },

    renderIdleState() {
        document.getElementById('emergencyGlow').classList.remove('active');
        document.getElementById('sirenAudio').pause();
        document.getElementById('actionArea').classList.add('hidden');
        
        document.getElementById('panelContent').innerHTML = `
            <div class="flex flex-col items-center justify-center h-full opacity-60 mt-20">
                <div class="relative w-32 h-32 flex items-center justify-center mb-6">
                    <div class="absolute inset-0 border-4 border-blue-500 rounded-full animate-ping opacity-20"></div>
                    <i class="fa-solid fa-radar fa-4x text-blue-500 animate-spin-slow"></i>
                </div>
                <h2 class="text-xl font-black text-gray-800 dark:text-white">${t('waiting')}</h2>
                <p class="text-sm text-gray-500 text-center mt-2">${t('standby')}</p>
            </div>
        `;
    },

    renderActiveIncident() {
        const inc = this.state.activeIncident;
        const pd = this.state.patientDetails || {};
        const hosp = inc.hospitals || { name: t('determining') };
        const alignClass = currentLang === 'en' ? 'text-left' : 'text-right';

        document.getElementById('panelContent').innerHTML = `
            <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4 mb-4 ${alignClass}">
                <h3 class="text-red-600 dark:text-red-400 font-black flex items-center gap-2 mb-2"><i class="fa-solid fa-triangle-exclamation animate-pulse"></i> ${t('incDetails')}</h3>
                <div class="text-xs text-gray-600 dark:text-gray-300 mb-1">${t('incNum')} #${inc.id}</div>
                <div class="text-xs text-gray-600 dark:text-gray-300 font-bold">قوة الاصطدام: ${inc.g_force} G</div>
                <div class="text-xs text-gray-600 dark:text-gray-300 mt-1">${inc.devices?.car_model || ''} - [${inc.devices?.car_plate || ''}]</div>
            </div>

            <div class="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-4 shadow-sm ${alignClass}">
                <h4 class="font-bold mb-3 text-gray-800 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-2"><i class="fa-solid fa-user-injured text-primary mx-1"></i> ${t('patientData')}</h4>
                <div class="grid grid-cols-2 gap-3 text-sm">
                    <div class="col-span-2"><span class="text-gray-400 block text-xs">${t('name')}</span><span class="font-bold">${pd.full_name || t('unknown')}</span></div>
                    <div><span class="text-gray-400 block text-xs">${t('bloodType')}</span><span class="font-bold text-red-500" dir="ltr">${pd.blood_type || '-'}</span></div>
                    <div><span class="text-gray-400 block text-xs">أمراض مزمنة</span><span class="font-bold text-yellow-600">${pd.medical_conditions || 'لا يوجد'}</span></div>
                    <div class="col-span-2"><span class="text-gray-400 block text-xs">جهة اتصال الطوارئ</span><span class="font-bold" dir="ltr">${pd.emergency1_name || ''} - ${pd.emergency1_phone || ''}</span></div>
                    <div class="col-span-2"><span class="text-gray-400 block text-xs">حساسية/أدوية</span><span class="font-bold">${pd.allergies || '-'} / ${pd.medications || '-'}</span></div>
                </div>
            </div>

            <div class="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-4 shadow-sm mt-4 ${alignClass}">
                <h4 class="font-bold mb-3 text-gray-800 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-2"><i class="fa-solid fa-hospital text-green-500 mx-1"></i> ${t('hospital')}</h4>
                <div class="text-sm font-bold text-gray-800 dark:text-white">${hosp.name}</div>
            </div>
        `;

        document.getElementById('actionArea').classList.remove('hidden');
        this.updateActionLogic();
    },

    updateActionLogic() {
        const btn = document.getElementById('mainActionBtn');
        const ambStatus = this.state.ambulance.status;

        btn.onclick = null;
        btn.disabled = false;

        if (ambStatus === 'assigned' || ambStatus === 'available') {
            document.getElementById('emergencyGlow').classList.add('active');
            document.getElementById('sirenAudio').play().catch(()=>{});
            
            btn.innerHTML = `<i class="fa-solid fa-hand-pointer"></i> ${t('confirmRec')}`;
            btn.className = "w-full py-4 rounded-xl font-black text-lg text-white bg-red-600 hover:bg-red-700 animate-bounce";
            
            btn.onclick = async () => {
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>...';
                btn.disabled = true;
                document.getElementById('emergencyGlow').classList.remove('active');
                document.getElementById('sirenAudio').pause();
                
                // ✅ تحويل لـ en_route_incident (المحاكي بيسمع لده ويبدأ الحركة)
                await this.changeStatus('en_route_incident');
                window.showModal(t('confirmed'), t('ackMsg'));
                this.updateTacticalMap();
            };
        } 
        else if (ambStatus === 'en_route_incident') {
            document.getElementById('emergencyGlow').classList.remove('active');
            document.getElementById('sirenAudio').pause();

            btn.innerHTML = `<i class="fa-solid fa-location-dot"></i> تأكيد الوصول للموقع`;
            btn.className = "w-full py-4 rounded-xl font-black text-lg text-white bg-orange-600 hover:bg-orange-700";
            
            btn.onclick = async () => {
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>...';
                btn.disabled = true;
                
                await this.changeStatus('arrived');
                window.showModal(t('arrivedLoc'), 'تم تسجيل الوصول للحادث.. بانتظار استلام المصاب');
                this.updateTacticalMap(); 
            };
        }
        else if (ambStatus === 'arrived') {
            btn.innerHTML = `<i class="fa-solid fa-user-check"></i> استلام المريض`;
            btn.className = "w-full py-4 rounded-xl font-black text-lg text-white bg-blue-600 hover:bg-blue-700";
            
            btn.onclick = async () => {
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>...';
                btn.disabled = true;
                
                await this.changeStatus('en_route_hospital');
                window.showModal(t('pickedUp'), t('hospMsg'));
                // Route drawing will be handled automatically via route_update broadcast
            };
        }
        else if (ambStatus === 'en_route_hospital') {
            btn.innerHTML = `<i class="fa-solid fa-location-dot"></i> ${t('arrivedHosp')}`;
            btn.className = "w-full py-4 rounded-xl font-black text-lg text-white bg-purple-600 hover:bg-purple-700";
            
            btn.onclick = async () => {
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>...';
                btn.disabled = true;
                await this.changeStatus('busy');
                this.updateActionLogic();
            };
        }
        else if (ambStatus === 'busy') {
            btn.innerHTML = `<i class="fa-solid fa-hourglass-half fa-spin"></i> ${t('waitingHosp')}`;
            btn.className = "w-full py-4 rounded-xl font-black text-lg text-white bg-gray-500 cursor-not-allowed";
            btn.disabled = true;
        }
    },

    async changeStatus(newAmbStatus, logNote = '') {
        try {
            await supabase.from('ambulances').update({ status: newAmbStatus }).eq('id', this.state.ambulance.id);
            this.state.ambulance.status = newAmbStatus;

            // تحديث حالة الحادث
            let incStatus = this.state.activeIncident.status;
            if (newAmbStatus === 'en_route_hospital') incStatus = 'in_progress';
            await supabase.from('incidents').update({ status: incStatus }).eq('id', this.state.activeIncident.id);

            this.updateActionLogic();
        } catch (error) {
            window.showModal(t('error'), t('statusUpdateError'));
        }
    },

    // ==========================================
    // 📡 Real-time Listeners
    // ==========================================
    setupRealtimeListeners() {
        // 1. مراقبة الحوادث
        supabase.channel('driver-incident-watch')
            .on('postgres_changes', { 
                event: '*', schema: 'public', table: 'incidents', filter: `assigned_ambulance_id=eq.${this.state.ambulance.id}` 
            }, async (payload) => {
                if (payload.new.status === 'assigned' && !this.state.activeIncident) {
                    window.showModal(t('newIncident'), t('newIncidentMsg'));
                    await this.checkActiveIncidents();
                }
                if (payload.new.status === 'completed' && this.state.activeIncident) {
                    window.showModal(t('missionSuccess'), t('missionSuccessMsg'));
                    await supabase.from('ambulances').update({ status: 'available' }).eq('id', this.state.ambulance.id);
                    this.state.ambulance.status = 'available';
                    this.state.activeIncident = null;
                    this.renderIdleState();
                    this.clearTacticalMap(); 
                }
            }).subscribe();

        // 2. مراقبة الإسعاف (للـ Watchdog)
        supabase.channel('driver-watchdog-sync')
            .on('postgres_changes', {
                event: 'UPDATE', schema: 'public', table: 'ambulances', filter: `id=eq.${this.state.ambulance.id}`
            }, (payload) => {
                const newStatus = payload.new.status;
                
                if (newStatus === 'available' && this.state.activeIncident && this.state.ambulance.status === 'assigned') {
                    window.showModal("تم سحب المهمة ⏱️", "تأخرت في الاستجابة (15 ثانية). تم تحويل البلاغ لإسعاف آخر.");
                    
                    document.getElementById('emergencyGlow').classList.remove('active');
                    document.getElementById('sirenAudio').pause();
                    
                    this.state.activeIncident = null;
                    this.state.ambulance.status = 'available';
                    this.renderIdleState();
                    this.clearTacticalMap();
                }
            }).subscribe();
    },

    bindEvents() {
        window.toggleTracking = () => {
            this.state.isAutoTracking = true;
            this.state.currentCameraPos = null; // إعادة ضبط الكاميرا
            const btn = document.getElementById('trackToggleBtn');
            if (btn) {
                btn.classList.replace('bg-gray-400', 'bg-blue-500');
                btn.classList.add('shadow-blue-500/30');
            }
            if (this.state.ambMarker) {
                const pos = this.state.ambMarker.getLatLng();
                this.state.targetCameraPos = { lat: pos.lat, lng: pos.lng };
                this.state.map.setView([pos.lat, pos.lng], 17, { animate: true });
            }
        };

        window.toggleCompassLock = () => {
            this.state.isCompassLocked = !this.state.isCompassLocked;
            const btn = document.getElementById('compassLockBtn');
            const icon = document.getElementById('compassLockIcon');
            
            if (this.state.isCompassLocked) {
                btn.classList.replace('text-gray-500', 'text-blue-500');
                btn.classList.add('bg-blue-100', 'dark:bg-blue-900/40');
                icon.classList.replace('fa-lock-open', 'fa-lock');
                window.showModal(t('smartNav'), t('navMsg'));
                if(!this.state.isAutoTracking) window.toggleTracking();
            } else {
                btn.classList.replace('text-blue-500', 'text-gray-500');
                btn.classList.remove('bg-blue-100', 'dark:bg-blue-900/40');
                icon.classList.replace('fa-lock', 'fa-lock-open');
                window.rotateMap(0); 
            }
        };

        window.rotateMap = (angle) => {
            const scale = (angle % 180 !== 0) ? 1.4 : 1.1; 
            const container = document.getElementById('map-container');
            container.style.transition = 'transform 1s linear';
            container.style.transform = `scale(${scale}) rotate(${angle}deg)`;
        };

        window.addEventListener('languageChanged', () => {
            if (this.state.activeIncident) this.renderActiveIncident();
            else this.renderIdleState();
        });
    }
};

document.addEventListener('DOMContentLoaded', () => DriverApp.init());