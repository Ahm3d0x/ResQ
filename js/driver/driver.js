// ============================================================================
// 🚑 EnQaZ Driver Dashboard - Tactical Navigation & Mission Control (V7.1 Fixed)
// ============================================================================

import { supabase, isIncidentCancelled, isIncidentTerminal } from '../config/supabase.js';
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
        this.startStatusPolling();
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
        if (ambStatus === 'assigned' || ambStatus === 'en_route_incident' || ambStatus === 'in_progress') {
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

    async drawStableRoute(coords, color) {
        // 🔥 HARD GUARD: Never draw routes for terminal incidents
        if (!this.state.activeIncident) return;
        if (['completed', 'cancelled'].includes(this.state.activeIncident.status)) return;
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

    // 🧹 HARD CLEANUP — removes all map overlays unconditionally
    forceCleanup() {
        if (!this.state.map) return;
        if (this.state.routeLayer) {
            this.state.map.removeLayer(this.state.routeLayer);
            this.state.routeLayer = null;
        }
        if (this.state.incidentMarker) {
            this.state.map.removeLayer(this.state.incidentMarker);
            this.state.incidentMarker = null;
        }
        if (this.state.hospitalMarker) {
            this.state.map.removeLayer(this.state.hospitalMarker);
            this.state.hospitalMarker = null;
        }
        console.log('[MAP] FULL CLEANUP DONE');
    },

    clearTacticalMap() {
        this.forceCleanup();
    },

    // 🔄 HARD RESET — full atomic state reset, no stale leftovers
    resetDriverState() {
        this.state.activeIncident = null;
        this.state.patientDetails = null;

        document.getElementById('emergencyGlow').classList.remove('active');
        document.getElementById('sirenAudio').pause();

        this.forceCleanup();
        this.hideActionButton();
        this.renderIdleState();

        console.log('[DRIVER] STATE RESET → READY FOR NEXT INCIDENT');
    },

    // ⏱️ Periodic polling — catches missed realtime events + proximity arrival detection
    startStatusPolling() {
        this._statusPollInterval = setInterval(async () => {
            if (!this.state.ambulance) return;

            // 1. Sync ambulance status from DB
            const { data } = await supabase.from('ambulances')
                .select('status').eq('id', this.state.ambulance.id).maybeSingle();
            if (data && data.status !== this.state.ambulance.status) {
                console.log(`[POLL] Ambulance status drift: ${this.state.ambulance.status} → ${data.status}`);
                this.state.ambulance.status = data.status;
                if (this.state.activeIncident) {
                    this.updateActionLogic();
                }
            }

            // 2. Client-side proximity arrival detection
            // If ambulance is near the destination but simulator hasn't set 'arrived' yet
            if (!this.state.activeIncident || !this.state.currentLocation) return;
            const loc = this.state.currentLocation;
            const inc = this.state.activeIncident;

            // Proximity to INCIDENT — trigger 'in_progress'
            if (this.state.ambulance.status === 'en_route_incident' && inc.latitude && inc.longitude) {
                const dLat = (loc.lat - parseFloat(inc.latitude)) * 111320;
                const dLng = (loc.lng - parseFloat(inc.longitude)) * 111320 * Math.cos(loc.lat * Math.PI / 180);
                const dist = Math.sqrt(dLat * dLat + dLng * dLng);
                if (dist < 150) {
                    console.log(`[PROXIMITY] Arrived at incident: ${dist.toFixed(0)}m`);
                    await supabase.from('ambulances').update({ status: 'in_progress' }).eq('id', this.state.ambulance.id);
                    this.state.ambulance.status = 'in_progress';
                    this.updateActionLogic();
                }
            }

            // Proximity to HOSPITAL — trigger 'busy'
            if (this.state.ambulance.status === 'en_route_hospital' && inc.hospitals) {
                const hosp = inc.hospitals;
                const dLat = (loc.lat - parseFloat(hosp.lat)) * 111320;
                const dLng = (loc.lng - parseFloat(hosp.lng)) * 111320 * Math.cos(loc.lat * Math.PI / 180);
                const dist = Math.sqrt(dLat * dLat + dLng * dLng);
                if (dist < 150) {
                    console.log(`[PROXIMITY] Arrived at hospital: ${dist.toFixed(0)}m`);
                    await supabase.from('ambulances').update({ status: 'busy' }).eq('id', this.state.ambulance.id);
                    this.state.ambulance.status = 'busy';
                    this.updateActionLogic();
                }
            }

            // 3. Ambulance released (available) while still showing active incident → RESET
            if (this.state.ambulance.status === 'available' && this.state.activeIncident) {
                console.log('[POLL] Ambulance is available but incident still shown → resetting driver');
                this.forceCleanup();
                this.resetDriverState();
                return;
            }

            // 4. Check incident status directly — catch hospital_confirmed/completed even if missed
            const { data: incData } = await supabase.from('incidents')
                .select('status').eq('id', inc.id).maybeSingle();
            if (incData) {
                const incStatus = incData.status;
                if (incStatus === 'hospital_confirmed' || incStatus === 'completed' || incStatus === 'cancelled') {
                    if (this.state.activeIncident) {
                        console.log(`[POLL] Incident #${inc.id} is ${incStatus} → resetting driver`);
                        this.forceCleanup();
                        this.resetDriverState();
                        if (incStatus === 'hospital_confirmed') {
                            window.showModal('تم التسليم ✅', 'تم تسليم المصاب للمستشفى بنجاح. أنت الآن متاح لمهمة جديدة.');
                        }
                    }
                }
            }
        }, 3000);
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
            // 🚫 Never draw patrol routes — only incident/hospital routes
            if (data.stage === 'patrol') return;
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

        // ✅ Explicit active statuses — .not('in') causes 400 Bad Request with Supabase JS v2
        const { data: incident, error } = await supabase.from('incidents')
            .select('*, devices(car_plate, car_model, users(email)), hospitals(*)')
            .eq('assigned_ambulance_id', this.state.ambulance.id)
            .in('status', ['pending', 'confirmed', 'assigned', 'in_progress'])
            .order('created_at', { ascending: false }).limit(1)
            .maybeSingle();

        if (error) console.error('[DRIVER] checkActiveIncidents error:', error);

        if (!incident) {
            this.resetDriverState();
            return;
        }

        this.state.activeIncident = incident;

        // Refresh ambulance status from DB so updateActionLogic() has correct state
        const { data: ambData } = await supabase.from('ambulances')
            .select('status').eq('id', this.state.ambulance.id).maybeSingle();
        if (ambData) this.state.ambulance.status = ambData.status;

        await this.fetchPatientMedicalDetails(incident.devices?.users?.email);
        this.renderActiveIncident();
        this.updateTacticalMap();
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
                <div class="text-xs text-gray-600 dark:text-gray-300 mt-1">${inc.devices?.car_model || '-'} - [${inc.devices?.car_plate || '-'}]</div>
            </div>

            <div class="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-4 shadow-sm ${alignClass}">
                <h4 class="font-bold mb-3 text-gray-800 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-2"><i class="fa-solid fa-user text-blue-500 mx-1"></i> معلومات المريض</h4>
                <div class="grid grid-cols-2 gap-3 text-sm">
                    <div class="col-span-2">
                        <span class="text-gray-400 text-xs">الاسم</span>
                        <div class="font-bold">${pd.full_name || 'غير متوفر'}</div>
                    </div>
                    <div>
                        <span class="text-gray-400 text-xs">فصيلة الدم</span>
                        <div class="font-bold text-red-500">${pd.blood_type || 'غير متوفر'}</div>
                    </div>
                    <div>
                        <span class="text-gray-400 text-xs">العمر</span>
                        <div class="font-bold">${pd.age || 'غير متوفر'}</div>
                    </div>
                </div>
                
                <h4 class="font-bold mt-4 mb-3 text-gray-800 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-2"><i class="fa-solid fa-notes-medical text-primary mx-1"></i> معلومات طبية</h4>
                <div class="grid grid-cols-1 gap-3 text-sm">
                    <div>
                        <span class="text-gray-400 text-xs">أمراض مزمنة</span>
                        <div class="font-bold">${pd.medical_conditions || 'لا يوجد'}</div>
                    </div>
                    <div>
                        <span class="text-gray-400 text-xs">أدوية حالية</span>
                        <div class="font-bold">${pd.medications || 'لا يوجد'}</div>
                    </div>
                    <div>
                        <span class="text-gray-400 text-xs">حساسية</span>
                        <div class="font-bold">${pd.allergies || 'لا يوجد'}</div>
                    </div>
                </div>

                <h4 class="font-bold mt-4 mb-3 text-gray-800 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-2"><i class="fa-solid fa-address-book text-green-500 mx-1"></i> جهات الاتصال للطوارئ</h4>
                <div class="grid grid-cols-1 gap-3 text-sm">
                    <div>
                        <span class="text-gray-400 text-xs">جهة اتصال 1</span>
                        <div class="font-bold">${pd.emergency1_name || 'غير متوفر'} <br> <span class="text-blue-500">${pd.emergency1_phone || ''}</span></div>
                    </div>
                    <div>
                        <span class="text-gray-400 text-xs">جهة اتصال 2</span>
                        <div class="font-bold">${pd.emergency2_name || 'غير متوفر'} <br> <span class="text-blue-500">${pd.emergency2_phone || ''}</span></div>
                    </div>
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

    // ⚠️ NEVER reuse onclick without resetting it first
    showActionBtn(label, cssClass, handler) {
        const actionArea = document.getElementById('actionArea');
        // Clone to nuke ALL stale event listeners
        const oldBtn = document.getElementById('mainActionBtn');
        const btn = oldBtn.cloneNode(false);
        oldBtn.parentNode.replaceChild(btn, oldBtn);

        btn.innerHTML = label;
        btn.className = cssClass;
        btn.disabled = false;
        btn.onclick = handler;
        actionArea.classList.remove('hidden');
    },

    hideActionButton() {
        const actionArea = document.getElementById('actionArea');
        if (actionArea) actionArea.classList.add('hidden');
        const btn = document.getElementById('mainActionBtn');
        if (btn) { btn.onclick = null; btn.disabled = true; }
    },

    updateActionLogic() {
        const ambStatus = this.state.ambulance?.status;
        if (!ambStatus) return this.hideActionButton();

        switch (ambStatus) {
            case 'assigned':
                // 🔔 Incident just assigned — show accept button with siren
                document.getElementById('emergencyGlow').classList.add('active');
                document.getElementById('sirenAudio').play().catch(() => {});
                this.showActionBtn(
                    `<i class="fa-solid fa-hand-pointer"></i> بدء التحرك`,
                    'w-full py-4 rounded-xl font-black text-lg text-white bg-red-600 hover:bg-red-700 animate-bounce',
                    async (e) => {
                        e.currentTarget.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>...';
                        e.currentTarget.disabled = true;
                        document.getElementById('emergencyGlow').classList.remove('active');
                        document.getElementById('sirenAudio').pause();
                        await this.changeStatus('en_route_incident');
                        window.showModal(t('confirmed'), t('ackMsg'));
                        this.updateTacticalMap();
                    }
                );
                break;

            case 'en_route_incident':
                // 🚗 Driving to incident — hide button, simulator auto-sets 'in_progress' on arrival
                document.getElementById('emergencyGlow').classList.remove('active');
                document.getElementById('sirenAudio').pause();
                this.hideActionButton();
                break;

            case 'in_progress':
                // 📍 Arrived at incident — show pickup button
                this.showActionBtn(
                    `<i class="fa-solid fa-user-check"></i> استلام المصاب`,
                    'w-full py-4 rounded-xl font-black text-lg text-white bg-blue-600 hover:bg-blue-700',
                    async (e) => {
                        e.currentTarget.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>...';
                        e.currentTarget.disabled = true;
                        await this.changeStatus('en_route_hospital');
                        window.showModal(t('pickedUp'), t('hospMsg'));
                    }
                );
                break;

            case 'en_route_hospital':
                // 🚗 Driving to hospital — hide button, simulator auto-sets 'busy' on arrival
                this.hideActionButton();
                break;

            case 'busy':
                // 🏥 Arrived at hospital — show confirm delivery button
                this.showActionBtn(
                    `<i class="fa-solid fa-hospital"></i> تسليم المصاب للمستشفى`,
                    'w-full py-4 rounded-xl font-black text-lg text-white bg-purple-600 hover:bg-purple-700',
                    async (e) => {
                        e.currentTarget.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>...';
                        e.currentTarget.disabled = true;
                        // Update incident to arrived_hospital
                        await supabase.from('incidents').update({ status: 'arrived_hospital' })
                            .eq('id', this.state.activeIncident.id);
                        // Release ambulance immediately — driver's job is DONE
                        await supabase.from('ambulances').update({ status: 'available' })
                            .eq('id', this.state.ambulance.id);
                        this.state.ambulance.status = 'available';
                        window.showModal('تم التسليم ✅', 'تم تسليم المصاب للمستشفى بنجاح. أنت الآن متاح لمهمة جديدة.');
                        // Full cleanup and reset
                        this.forceCleanup();
                        this.resetDriverState();
                    }
                );
                break;

            default:
                this.hideActionButton();
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
        // ✅ Single terminal handler — only resets UI, does NOT touch ambulance DB status
        // (engine/simulator owns the ambulance status transition after completion)
        const handleTerminal = async (newIncStatus) => {
            console.log('[DRIVER LIFECYCLE] Terminal detected → FULL RESET', newIncStatus);
            this.forceCleanup();
            this.resetDriverState();

            if (newIncStatus === 'completed') {
                window.showModal(t('missionSuccess'), t('missionSuccessMsg'));
            } else {
                window.showModal('تم الإلغاء', 'تم إنهاء البلاغ أو إلغاؤه من قبل العمليات.');
            }
        };

        // 1. مراقبة الحوادث — event:'*' handles UPDATE + DELETE in one reliable subscription
        supabase.channel('driver-incident-watch')
            .on('postgres_changes', { 
                event: '*', schema: 'public', table: 'incidents'
            }, async (payload) => {
                const newInc = payload.new;
                const oldInc = payload.old;

                // Handle DELETE
                if (payload.eventType === 'DELETE') {
                    if (this.state.activeIncident && oldInc?.id === this.state.activeIncident.id) {
                        console.log('[REALTIME] INCIDENT DELETED');
                        await handleTerminal('cancelled');
                    }
                    return;
                }

                if (!newInc) return;

                // New assignment for this driver while idle
                if (newInc.status === 'assigned'
                    && String(newInc.assigned_ambulance_id) === String(this.state.ambulance?.id)
                    && !this.state.activeIncident) {
                    window.showModal(t('newIncident'), t('newIncidentMsg'));
                    await this.checkActiveIncidents();
                    return;
                }

                // Only react to our active incident
                if (!this.state.activeIncident || newInc.id !== this.state.activeIncident.id) return;

                // Detect terminal transition (completed/cancelled)
                const isTerminalNow = newInc.status === 'completed' || newInc.status === 'cancelled' || newInc.status === 'canceled';
                const becameTerminal = isTerminalNow && oldInc?.status !== newInc.status;

                if (becameTerminal) {
                    await handleTerminal(newInc.status);
                    return;
                }

                // Hospital confirmed = driver's job is DONE (ambulance released by simulator)
                if (newInc.status === 'hospital_confirmed' && oldInc?.status !== 'hospital_confirmed') {
                    console.log('[DRIVER LIFECYCLE] Hospital confirmed → Driver mission complete');
                    this.forceCleanup();
                    this.resetDriverState();
                    window.showModal(t('missionSuccess'), 'تم تسليم المصاب للمستشفى بنجاح. أنت الآن متاح لمهمة جديدة.');
                    return;
                }

                // Detect unassignment from this ambulance
                if (newInc.assigned_ambulance_id === null
                    || String(newInc.assigned_ambulance_id) !== String(this.state.ambulance?.id)) {
                    console.log('[REALTIME] INCIDENT UNASSIGNED');
                    await handleTerminal('cancelled');
                    return;
                }

                // Non-terminal update — sync local state and refresh button
                this.state.activeIncident = { ...this.state.activeIncident, ...newInc };
                this.updateActionLogic();
            })
            .subscribe();

        // 2. مراقبة الإسعاف — sync local status on EVERY update
        supabase.channel('driver-watchdog-sync')
            .on('postgres_changes', {
                event: 'UPDATE', schema: 'public', table: 'ambulances', filter: `id=eq.${this.state.ambulance.id}`
            }, (payload) => {
                const oldLocalStatus = this.state.ambulance.status;
                const newStatus = payload.new.status;
                console.log(`[AMB SYNC] ${oldLocalStatus} → ${newStatus}`);

                // Always sync local ambulance status
                this.state.ambulance.status = newStatus;

                // Watchdog revocation: engine set ambulance back to 'available' while we thought we were assigned
                if (newStatus === 'available' && this.state.activeIncident && oldLocalStatus === 'assigned') {
                    window.showModal("تم سحب المهمة ⏱️", "تأخرت في الاستجابة (15 ثانية). تم تحويل البلاغ لإسعاف آخر.");
                    document.getElementById('emergencyGlow').classList.remove('active');
                    document.getElementById('sirenAudio').pause();
                    this.resetDriverState();
                    return;
                }

                // Re-evaluate action button for the new ambulance status
                if (this.state.activeIncident) {
                    this.updateActionLogic();
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

        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.onclick = () => {
                if (confirm('هل تريد تسجيل الخروج؟')) {
                    this.resetDriverState();
                    localStorage.removeItem('resq_custom_session');
                    window.location.replace('../index.html');
                }
            };
        }
    }
};

document.addEventListener('DOMContentLoaded', () => DriverApp.init());