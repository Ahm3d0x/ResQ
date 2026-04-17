// ============================================================================
// ملف الإعدادات الأساسي لربط قاعدة بيانات Supabase بمشروع ResQ
// ============================================================================

// استدعاء مكتبة Supabase
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// 1. مفاتيح الربط (API Keys)
const SUPABASE_URL = 'https://pjyoqvxkflaxayxbmpmy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqeW9xdnhrZmxheGF5eGJtcG15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NTQ3MTMsImV4cCI6MjA4OTUzMDcxM30.c4Oc8gHHep1_7WTBRiNHJXLUco6m6O1bunpagEftFYk';

// 2. التهيئة المتقدمة للعميل (Advanced Client Initialization)
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        autoRefreshToken: true,      // تجديد التوكن تلقائياً عشان المستخدم ميخرجش فجأة
        persistSession: true,        // حفظ الجلسة في المتصفح (Local Storage)
        detectSessionInUrl: true     // قراءة بيانات الدخول لو راجعة من رابط (زي استعادة كلمة المرور)
    },
    realtime: {
        params: {
            eventsPerSecond: 10      // ضبط التردد لـ 10 أحداث في الثانية (ممتاز لتتبع الإسعاف لحظياً)
        }
    },
    global: {
        headers: { 'x-application-name': 'ResQ-Emergency-System' }
    }
});

// ============================================================================
// 3. ثوابت النظام (System Constants) - لمنع الأخطاء الإملائية في الكود
// ============================================================================

export const DB_TABLES = {
    USERS: 'users',
    DEVICES: 'devices',
    HOSPITALS: 'hospitals',
    AMBULANCES: 'ambulances',
    INCIDENTS: 'incidents',
    HARDWARE_REQUESTS: 'hardware_requests',
    INCIDENT_LOGS: 'incident_logs',
    VISITOR_SEARCHES: 'visitor_searches',
    NOTIFICATIONS: 'notifications',
    SETTINGS: 'system_settings',
    HOSPITAL_BEDS: 'hospital_beds',
    HOSPITAL_LOGS: 'hospital_logs',
    ENGINE_SESSIONS: 'engine_sessions'
};

export const ROLES = {
    ADMIN: 'admin',
    USER: 'user',
    HOSPITAL: 'hospital',
    DRIVER: 'driver'
};

export const INCIDENT_STATUS = {
    PENDING:     'pending',
    CONFIRMED:   'confirmed',
    CANCELLED:   'cancelled',   // AUTHORITATIVE spelling — double-L only. 'canceled' (1L) is deprecated.
    ASSIGNED:    'assigned',
    IN_PROGRESS: 'in_progress',
    COMPLETED:   'completed'
    // NOTE: 'failed' is NOT a valid incident_status_enum value in the DB. Do NOT use it.
};

// Helper: check if an incident status string represents a terminal/cancelled state.
// Use this instead of manual string comparisons throughout the codebase.
export function isIncidentCancelled(status) {
    // 'cancelled' (2L) is the authoritative spelling.
    // 'canceled' (1L) guards against any legacy rows that may exist before the DB migration.
    // 'CANCELLED' uppercase is NOT a valid enum value and must NEVER be passed to DB queries.
    return status === 'cancelled' || status === 'canceled';
}

export function isIncidentTerminal(status) {
    // Only 'cancelled'/'canceled' and 'completed' are valid terminal states in the DB enum.
    // 'failed' does NOT exist in incident_status_enum.
    return status === 'cancelled' || status === 'canceled' || status === 'completed';
}

// ============================================================================
// 4. دوال مساعدة عامة (Global Helper Functions)
// ============================================================================

/**
 * دالة لاختبار استقرار الاتصال بقاعدة البيانات
 */
export async function checkDatabaseConnection() {
    try {
        const { data, error } = await supabase.from(DB_TABLES.SETTINGS).select('key').limit(1);
        if (error) throw error;
        console.log('✅ Supabase Connection: STABLE & READY');
        return true;
    } catch (err) {
        console.error('❌ Supabase Connection Error:', err.message);
        return false;
    }
}

/**
 * دالة للاشتراك اللحظي في أي جدول (Real-time Subscription Wrapper)
 * مفيدة جداً لصفحة الأدمن والمستشفى لسماع الحوادث الجديدة
 */
export function subscribeToTable(tableName, callback) {
    const channel = supabase
        .channel(`public:${tableName}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: tableName }, (payload) => {
            callback(payload);
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log(`📡 Real-time Connected to: [${tableName}]`);
            }
        });
    return channel; // لإمكانية إغلاق الاتصال لاحقاً لو احتجنا
}

/**
 * 🔒 Idempotent Incident Action Logger
 *
 * ARCHITECTURE NOTE: This function is a FAST-FAIL in-app guard only.
 * The authoritative idempotency enforcement is the PostgreSQL UNIQUE INDEX
 * on incident_logs(incident_id, action) — defined in cancellation_hardening.sql.
 * The SELECT check here avoids a round-trip INSERT when we already know it'll
 * fail, but it is NOT race-condition-proof on its own (TOCTOU).
 * The DB constraint is the true lock.
 *
 * @param {number} incidentId - The incident primary key (NOT NULL — skip for pre-incident events)
 * @param {string} action     - The event action name (must be unique per incident)
 * @param {string} performedBy
 * @param {string} note
 * @returns {boolean} true if written, false if duplicate or error
 */
export async function logIncidentAction(incidentId, action, performedBy = 'system', note = '') {
    if (!incidentId || !action) {
        console.warn(`[LogIncidentAction] Skipped: missing incidentId or action. action=${action}`);
        return false;
    }

    // In-app fast-fail: skip INSERT if we already know this log exists.
    // NOTE: This check can still race — the DB unique constraint is the final enforcer.
    const { data: existing } = await supabase
        .from(DB_TABLES.INCIDENT_LOGS)
        .select('id')
        .eq('incident_id', incidentId)
        .eq('action', action)
        .limit(1);

    if (existing && existing.length > 0) {
        console.log(`[DEBUG:CANCEL_FLOW] [Idempotency] Skipping duplicate log: ${action} for INC#${incidentId}`);
        return false;
    }

    const { error } = await supabase.from(DB_TABLES.INCIDENT_LOGS).insert([{
        incident_id: incidentId,
        action,
        performed_by: performedBy,
        note
    }]);

    if (error) {
        // 23505 = PostgreSQL unique_violation — DB constraint caught the duplicate.
        if (error.code === '23505') {
            console.log(`[DEBUG:CANCEL_FLOW] [DB Constraint] Duplicate blocked by UNIQUE INDEX: ${action} for INC#${incidentId}`);
            return false;
        }
        console.error(`[LogError] Failed to write event '${action}' for INC#${incidentId}:`, error.message);
        return false;
    }
    return true;
}