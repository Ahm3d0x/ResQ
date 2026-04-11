import { supabase, DB_TABLES, INCIDENT_STATUS } from '../config/supabase.js';

/**
 * محرك تشغيل واجهة السائق - ResQ Driver Engine
 */
class DriverDashboard {
    constructor() {
        this.driverSession = JSON.parse(localStorage.getItem('resq_custom_session'));
        this.currentAmbulance = null;
        this.activeIncident = null;
        this.watchId = null;

        // العناصر الواجهة
        this.btnAction = document.getElementById('actionBtn');
        this.overlay = document.getElementById('missionOverlay');
        
        this.init();
    }

    async init() {
        if (!this.driverSession || this.driverSession.role !== 'driver') {
            window.location.replace('login.html');
            return;
        }

        await this.loadAmbulanceData();
        this.startLocationTracking();
        this.subscribeToMissions();
    }

    // 1. جلب بيانات مركبة الإسعاف المرتبطة بالسائق [cite: 338]
    async loadAmbulanceData() {
        const { data, error } = await supabase
            .from(DB_TABLES.AMBULANCES)
            .select('*')
            .eq('driver_id', this.driverSession.id)
            .single();

        if (error) {
            console.error("Ambulance not found:", error);
            return;
        }
        this.currentAmbulance = data;
        document.getElementById('unitCode').innerText = `وحدة: ${data.code}`; [cite: 319]
        this.updateDriverStatusUI(data.status);
    }

    // 2. تتبع الموقع الجغرافي الحي للسائق وتحديثه في Supabase [cite: 202]
    startLocationTracking() {
        if ("geolocation" in navigator) {
            this.watchId = navigator.geolocation.watchPosition(async (position) => {
                const { latitude, longitude } = position.coords;
                
                // تحديث موقع الإسعاف في قاعدة البيانات لحظياً [cite: 202, 114]
                if (this.currentAmbulance) {
                    await supabase.from(DB_TABLES.AMBULANCES)
                        .update({ lat: latitude, lng: longitude })
                        .eq('id', this.currentAmbulance.id);
                }
                
                // هنا يمكن إضافة كود تحديث مركز الخريطة (Map Engine)
            }, (err) => console.error("GPS Error:", err), { enableHighAccuracy: true });
        }
    }

    // 3. الاشتراك اللحظي في الحوادث الموجهة لهذه المركبة [cite: 107, 110]
    subscribeToMissions() {
        supabase
            .channel('driver-task')
            .on('postgres_changes', { 
                event: 'UPDATE', 
                schema: 'public', 
                table: DB_TABLES.INCIDENTS,
                filter: `assigned_ambulance_id=eq.${this.currentAmbulance.id}` 
            }, payload => {
                this.processIncidentChange(payload.new);
            })
            .subscribe();
            
        // البحث عن أي مهمة نشطة حالياً عند فتح الصفحة
        this.checkExistingMissions();
    }

    async checkExistingMissions() {
        const { data } = await supabase
            .from(DB_TABLES.INCIDENTS)
            .select('*, devices(car_plate, car_model)')
            .eq('assigned_ambulance_id', this.currentAmbulance.id)
            .in('status', ['assigned', 'in_progress'])
            .single();

        if (data) this.processIncidentChange(data);
    }

    // 4. معالجة حالة المهمة وتحديث الواجهة [cite: 231, 234, 235]
    processIncidentChange(incident) {
        this.activeIncident = incident;
        
        if (incident.status === INCIDENT_STATUS.ASSIGNED || incident.status === INCIDENT_STATUS.IN_PROGRESS) {
            this.overlay.classList.remove('hidden');
            document.getElementById('patientName').innerText = incident.devices?.car_model || "مركبة غير معروفة";
            document.getElementById('impactG').innerText = `${incident.g_force}G`; [cite: 323]
            
            this.updateActionButton(incident.status);
        } else {
            this.overlay.classList.add('hidden');
        }
    }

    updateActionButton(status) {
        this.btnAction.onclick = () => this.handleActionClick(status);
        
        if (status === INCIDENT_STATUS.ASSIGNED) {
            this.btnAction.innerText = "تأكيد الوصول لموقع الحادث";
            this.btnAction.className = "col-span-2 bg-orange-600 hover:bg-orange-700 text-white font-black py-4 rounded-2xl shadow-lg";
        } else if (status === INCIDENT_STATUS.IN_PROGRESS) {
            this.btnAction.innerText = "تأكيد تسليم الحالة للمستشفى";
            this.btnAction.className = "col-span-2 bg-green-600 hover:bg-green-700 text-white font-black py-4 rounded-2xl shadow-lg";
        }
    }

    // 5. منطق تغيير الحالات عند ضغط الأزرار [cite: 254]
    async handleActionClick(currentStatus) {
        this.btnAction.disabled = true;
        this.btnAction.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري التحديث...';

        try {
            let nextStatus = '';
            let ambStatus = '';

            if (currentStatus === INCIDENT_STATUS.ASSIGNED) {
                nextStatus = INCIDENT_STATUS.IN_PROGRESS; // الإسعاف وصل وبدأ نقل المريض [cite: 235]
                ambStatus = 'en_route_hospital'; [cite: 313]
            } else {
                nextStatus = INCIDENT_STATUS.COMPLETED; // المهمة انتهت [cite: 235]
                ambStatus = 'available'; [cite: 313]
            }

            // تحديث حالة الحادث [cite: 323]
            await supabase.from(DB_TABLES.INCIDENTS)
                .update({ status: nextStatus, updated_at: new Date() })
                .eq('id', this.activeIncident.id);

            // تحديث حالة مركبة الإسعاف [cite: 319]
            await supabase.from(DB_TABLES.AMBULANCES)
                .update({ status: ambStatus })
                .eq('id', this.currentAmbulance.id);

            // إضافة سجل في الـ Logs 
            await supabase.from('incident_logs').insert({
                incident_id: this.activeIncident.id,
                action: `driver_${nextStatus}`,
                performed_by: `driver:${this.driverSession.name}`,
                note: `قام السائق بتحديث الحالة إلى ${nextStatus}`
            });

        } catch (error) {
            console.error("Update failed:", error);
        } finally {
            this.btnAction.disabled = false;
        }
    }

    updateDriverStatusUI(status) {
        const statusEl = document.getElementById('driverStatus');
        statusEl.innerText = status;
        // تغيير الألوان بناءً على الجاهزية
        statusEl.className = status === 'available' ? 'text-green-500 font-bold' : 'text-orange-500 font-bold';
    }
}

// تشغيل المحرك عند تحميل الصفحة
new DriverDashboard();