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
    SETTINGS: 'settings'
};

export const ROLES = {
    ADMIN: 'admin',
    USER: 'user',
    HOSPITAL: 'hospital',
    DRIVER: 'driver'
};

export const INCIDENT_STATUS = {
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    CANCELED: 'canceled',
    ASSIGNED: 'assigned',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed'
};

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