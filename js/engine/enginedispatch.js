// ============================================================================
// 🧠 EnQaZ Core Engine - Elite AI Dispatcher & Rerouting System (V5.0)
// ============================================================================

import { supabase, DB_TABLES } from '../config/supabase.js';
import { EngineUI } from './engineui.js';

export const EngineDispatch = {
    // تخزين الإسعافات "المتجاهلة" لكل حادث لتجنب تكرار الفشل
    // Structure: { incidentId: Set(ambId1, ambId2) }
    incidentBlacklist: new Map(),
    incidentRetryCount: new Map(), // Track retries per incident
    activeDispatchSet: new Set(), // Prevent duplicate dispatch calls

    init() {
        EngineUI.log('SYS', 'Elite Dispatch Engine V5.0 Online.', 'success');
        this.listenForIncidentReady();
    },

    // 1. الاستماع للحدث القادم من موديول IncidentLog (بعد تأكيد الـ 10 ثوانٍ الأولى)
    listenForIncidentReady() {
        window.addEventListener('engine:incident_ready', async (e) => {
            const incident = e.detail;
            EngineUI.log('DISPATCH', `New Mission: Incident #${incident.id}. Identifying resources...`, 'system');
            await this.executePrimaryDispatch(incident);
        });
    },

    // 2. المحرك الرئيسي للتخصيص
    async executePrimaryDispatch(incident) {
        if (this.activeDispatchSet.has(incident.id)) {
            return; // Prevent duplicate execution
        }
        this.activeDispatchSet.add(incident.id);

        try {
            const incLat = parseFloat(incident.latitude || incident.lat);
            const incLng = parseFloat(incident.longitude || incident.lng);

            // أ. جلب قائمة الإسعافات المتاحة مع استثناء الرافضين سابقاً لهذا الحادث
            const ignoredAmbs = Array.from(this.incidentBlacklist.get(incident.id) || []);
            
            let query = supabase.from(DB_TABLES.AMBULANCES).select('*').in('status', ['available', 'returning']);
            if (ignoredAmbs.length > 0) {
                query = query.not('id', 'in', `(${ignoredAmbs.join(',')})`);
            }

            const { data: availableAmbs, error: ambErr } = await query;
            if (ambErr) throw ambErr;

            // ب. التحقق من وجود موارد
            if (!availableAmbs || availableAmbs.length === 0) {
                this.activeDispatchSet.delete(incident.id); // unlock for retry
                this.handleNoResources(incident);
                return;
            }

            // ج. جلب المستشفيات
            const { data: hospitals } = await supabase.from(DB_TABLES.HOSPITALS).select('*');
            
            // التأكد من توافر المستشفيات (Fallback if full)
            const availableHospitals = hospitals ? hospitals.filter(h => (h.available_beds > 0 || h.capacity > 0 || h.available_capacity > 0)) : [];
            const safeHospitalsList = availableHospitals.length > 0 ? availableHospitals : hospitals;

            // د. خوارزمية المفاضلة الجغرافية (Haversine Distance)
            const bestAmb = this.findNearestHaversine(incLat, incLng, availableAmbs);
            if (!bestAmb) {
                this.activeDispatchSet.delete(incident.id);
                this.handleNoResources(incident);
                return;
            }

            const bestHosp = this.findBestHospital(incLat, incLng, bestAmb, safeHospitalsList);

            if (!bestHosp) throw new Error("No hospitals configured in region.");

            // هـ. عملية الحجز (Atomic Database Update)
            await this.lockResources(incident.id, bestAmb, bestHosp);

            // و. تفعيل رقيب استجابة السائق (The Driver Watchdog)
            this.launchDriverWatchdog(incident, bestAmb);

        } catch (err) {
            EngineUI.log('ERR', `Dispatch Failure: ${err.message}`, 'alert');
        } finally {
            this.activeDispatchSet.delete(incident.id);
        }
    },

    // 3. تأمين الموارد في قاعدة البيانات (Transaction-like)
    async lockResources(incidentId, ambulance, hospital) {
        const timestamp = new Date().toISOString();

        // تحديث حالة الإسعاف لـ Assigned
        await supabase.from(DB_TABLES.AMBULANCES).update({ status: 'assigned' }).eq('id', ambulance.id);

        // تحديث الحادث بالبيانات الجديدة
        await supabase.from(DB_TABLES.INCIDENTS).update({
            status: 'assigned',
            assigned_ambulance_id: ambulance.id,
            assigned_hospital_id: hospital.id,
            updated_at: timestamp
        }).eq('id', incidentId);

        // تسجيل العملية
        await supabase.from(DB_TABLES.INCIDENT_LOGS).insert([{
            incident_id: incidentId,
            action: 'assigned',
            performed_by: 'AI_ENGINE',
            note: `Unit ${ambulance.code} dispatched. Target: ${hospital.name}`
        }]);

        EngineUI.log('DISPATCH', `Unit ${ambulance.code} locked. 15s timer started.`, 'info');
    },

    // 4. رقيب استجابة السائق (Fail-safe Protocol)
    launchDriverWatchdog(incident, ambulance) {
        setTimeout(async () => {
            // جلب حالة الإسعاف الحالية للتأكد إذا كان السائق ضغط "تأكيد"
            const { data: ambStatus } = await supabase
                .from(DB_TABLES.AMBULANCES)
                .select('status')
                .eq('id', ambulance.id)
                .single();

            // Guard: Verify if the system is still waiting for driver
            if (!ambStatus || ambStatus.status !== 'assigned') {
                if (ambStatus && ambStatus.status === 'en_route_incident') {
                    this.finalizeDispatch(incident, ambulance);
                }
                return;
            }

            // إذا انتهى الوقت ولم يقبل السائق (لا يزال assigned)
            await this.triggerRerouting(incident, ambulance);
        }, 15000); // 15s wait
    },

    // 5. نظام إعادة التوجيه الذكي (Recursive Rerouting)
    async triggerRerouting(incident, failedAmb) {
        EngineUI.log('DISPATCH', `Unit ${failedAmb.code} failed to respond. BLACKLISTING & REROUTING...`, 'alert');

        // أ. إضافة السائق للقائمة السوداء لهذا الحادث
        if (!this.incidentBlacklist.has(incident.id)) {
            this.incidentBlacklist.set(incident.id, new Set());
        }
        this.incidentBlacklist.get(incident.id).add(failedAmb.id);

        // ب. تحرير السائق المتقاعس (إعادته متاحاً لبلاغات أخرى لعل لديه عطل في تطبيق السائق فقط)
        await supabase.from(DB_TABLES.AMBULANCES).update({ status: 'available' }).eq('id', failedAmb.id);

        // ج. توثيق الفشل
        await supabase.from(DB_TABLES.INCIDENT_LOGS).insert([{
            incident_id: incident.id,
            action: 'driver_timeout',
            performed_by: 'system',
            note: `Ambulance ${failedAmb.code} ignored dispatch. Initiating search for next nearest unit.`
        }]);

        // د. إعادة تشغيل المحرك للبحث عن بديل (Recursion)
        await this.executePrimaryDispatch(incident);
    },

    // 6. إنهاء العملية وبدء الحركة في السيموليشن
    finalizeDispatch(incident, ambulance) {
        EngineUI.log('DISPATCH', `Mission Confirmed by ${ambulance.code}. Simulator taking control.`, 'success');
        
        // إخطار المحاكي (EngineSimulator) للبدء في طلب المسار والحركة الفعلية
        window.dispatchEvent(new CustomEvent('engine:dispatch_complete', {
            detail: { incident, ambulance }
        }));
    },

    handleNoResources(incident) {
        let retries = this.incidentRetryCount.get(incident.id) || 0;
        const maxRetries = 5;

        if (retries >= maxRetries) {
            EngineUI.log('DISPATCH', `CRITICAL: Incident #${incident.id} FAILED to find resources after ${maxRetries} attempts. Stopping retries.`, 'alert');
            supabase.from(DB_TABLES.INCIDENTS).update({ status: 'failed' }).eq('id', incident.id).catch(()=>{});
            return;
        }

        retries++;
        this.incidentRetryCount.set(incident.id, retries);

        const delayMs = 5000 * Math.pow(2, retries - 1); // 5s -> 10s -> 20s -> 40s -> 80s
        
        EngineUI.log('DISPATCH', `CRITICAL: No units available for Incident #${incident.id}! Retrying in ${delayMs/1000}s... (Attempt ${retries}/${maxRetries})`, 'alert');
        
        setTimeout(() => this.executePrimaryDispatch(incident), delayMs);
    },

    // 📏 Haversine Formula (الدقة الجغرافية العالية)
    calculateHaversine(lat1, lon1, lat2, lon2) {
        lat1 = parseFloat(lat1); lon1 = parseFloat(lon1);
        lat2 = parseFloat(lat2); lon2 = parseFloat(lon2);
        const R = 6371; // نصف قطر الأرض بالكيلومتر
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c; 
    },

    findNearestHaversine(lat, lng, list) {
        if (!list || list.length === 0) return null;

        list.sort((a, b) => {
            const latA = parseFloat(a.lat || a.latitude);
            const lngA = parseFloat(a.lng || a.longitude);
            const latB = parseFloat(b.lat || b.latitude);
            const lngB = parseFloat(b.lng || b.longitude);
            return this.calculateHaversine(lat, lng, latA, lngA) - this.calculateHaversine(lat, lng, latB, lngB);
        });

        const nearest = list[0];
        
        list.forEach(item => {
            const itemLat = parseFloat(item.lat || item.latitude);
            const itemLng = parseFloat(item.lng || item.longitude);
            const dist = this.calculateHaversine(lat, lng, itemLat, itemLng);
            
            console.log("AMB CANDIDATE:", item.id, "DIST:", dist.toFixed(2));
            EngineUI.log('DISPATCH', `Candidate: Unit ID ${item.id} (${item.code}) -> Distance: ${dist.toFixed(2)} km`, 'dim');
        });
        
        if (nearest) EngineUI.log('DISPATCH', `Selected Unit ${nearest.code} (ID: ${nearest.id}) at minimal distance: ${this.calculateHaversine(lat, lng, parseFloat(nearest.lat || nearest.latitude), parseFloat(nearest.lng || nearest.longitude)).toFixed(2)} km`, 'info');
        return nearest;
    },

    findBestHospital(incLat, incLng, amb, list) {
        if (!list || list.length === 0) return null;
        let best = null;
        let bestScore = -Infinity;

        const ambLat = parseFloat(amb.lat || amb.latitude);
        const ambLng = parseFloat(amb.lng || amb.longitude);

        list.forEach(item => {
            const hospLat = parseFloat(item.lat || item.latitude);
            const hospLng = parseFloat(item.lng || item.longitude);
            
            // Distance optimization limit: (ambulance->incident) + (incident->hospital)
            const distAmbToInc = this.calculateHaversine(ambLat, ambLng, incLat, incLng);
            const distIncToHosp = this.calculateHaversine(incLat, incLng, hospLat, hospLng);
            const totalDist = distAmbToInc + distIncToHosp;

            // Priority weighting: availability minus distance (higher availability is better, larger distance is worse)
            const availability = item.available_beds || item.capacity || item.available_capacity || 1;
            const load = item.current_load || 0; // if load exists, factor it in
            const availableCapacity = availability - load;

            // Score: + capacity weight, - distance weight
            const score = (availableCapacity * 10) - totalDist; 
            
            if (score > bestScore) {
                bestScore = score;
                best = item;
            }
        });
        
        if (best) EngineUI.log('DISPATCH', `Selected Hospital ${best.name} (ID: ${best.id}) for optimal routing.`, 'info');
        return best;
    }
};

// التشغيل التلقائي
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => EngineDispatch.init(), 1000);
});