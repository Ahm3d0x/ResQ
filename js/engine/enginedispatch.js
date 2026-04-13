// ============================================================================
// 🧠 EnQaZ Core Engine - Elite AI Dispatcher & Rerouting System (V5.0)
// ============================================================================

import { supabase, DB_TABLES } from '../config/supabase.js';
import { EngineUI } from './engineui.js';

export const EngineDispatch = {
    // تخزين الإسعافات "المتجاهلة" لكل حادث لتجنب تكرار الفشل
    // Structure: { incidentId: Set(ambId1, ambId2) }
    incidentBlacklist: new Map(),

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
        try {
            // أ. جلب قائمة الإسعافات المتاحة مع استثناء الرافضين سابقاً لهذا الحادث
            const ignoredAmbs = Array.from(this.incidentBlacklist.get(incident.id) || []);
            
            let query = supabase.from(DB_TABLES.AMBULANCES).select('*').eq('status', 'available');
            if (ignoredAmbs.length > 0) {
                query = query.not('id', 'in', `(${ignoredAmbs.join(',')})`);
            }

            const { data: availableAmbs, error: ambErr } = await query;
            if (ambErr) throw ambErr;

            // ب. التحقق من وجود موارد
            if (!availableAmbs || availableAmbs.length === 0) {
                this.handleNoResources(incident);
                return;
            }

            // ج. جلب المستشفيات (لاختيار الأقرب للحادث)
            const { data: hospitals } = await supabase.from(DB_TABLES.HOSPITALS).select('*');
            
            // د. خوارزمية المفاضلة الجغرافية (Nearest Neighbor)
            const bestAmb = this.findNearest(incident.latitude, incident.longitude, availableAmbs);
            const bestHosp = this.findNearest(incident.latitude, incident.longitude, hospitals);

            if (!bestHosp) throw new Error("No hospitals configured in region.");

            // هـ. عملية الحجز (Atomic Database Update)
            await this.lockResources(incident.id, bestAmb, bestHosp);

            // و. تفعيل رقيب استجابة السائق (The Driver Watchdog)
            this.launchDriverWatchdog(incident, bestAmb);

        } catch (err) {
            EngineUI.log('ERR', `Dispatch Failure: ${err.message}`, 'alert');
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

        EngineUI.log('DISPATCH', `Unit ${ambulance.code} locked. 10s timer started.`, 'info');
    },

    // 4. رقيب استجابة السائق (Fail-safe Protocol)
    launchDriverWatchdog(incident, ambulance) {
        let secondsLeft = 10;
        
        const monitor = setInterval(async () => {
            secondsLeft--;
            
            // جلب حالة الإسعاف الحالية للتأكد إذا كان السائق ضغط "تأكيد"
            const { data: ambStatus } = await supabase
                .from(DB_TABLES.AMBULANCES)
                .select('status')
                .eq('id', ambulance.id)
                .single();

            // إذا قام السائق بتغيير الحالة لـ en_route_incident (تم القبول)
            if (ambStatus && ambStatus.status === 'en_route_incident') {
                clearInterval(monitor);
                this.finalizeDispatch(incident, ambulance);
                return;
            }

            // إذا انتهى الوقت ولم يقبل السائق
            if (secondsLeft <= 0) {
                clearInterval(monitor);
                await this.triggerRerouting(incident, ambulance);
            }
        }, 1000);
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
        EngineUI.log('DISPATCH', `CRITICAL: No units available for Incident #${incident.id}! Retrying in 5s...`, 'alert');
        setTimeout(() => this.executePrimaryDispatch(incident), 5000);
    },

    // 📏 Haversine Formula (الدقة الجغرافية العالية)
    findNearest(lat, lng, list) {
        if (!list || list.length === 0) return null;
        let nearest = null;
        let minExp = Infinity;

        list.forEach(item => {
            const dLat = item.lat - lat;
            const dLng = item.lng - lng;
            const dist = dLat * dLat + dLng * dLng; // Euclidean square لسرعة المعالجة
            if (dist < minExp) {
                minExp = dist;
                nearest = item;
            }
        });
        return nearest;
    }
};

// التشغيل التلقائي
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => EngineDispatch.init(), 1000);
});