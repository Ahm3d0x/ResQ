// ============================================================================
// ملف المصادقة (Authentication) - نظام ResQ
// ============================================================================

// 1. استدعاء الاتصال بقاعدة البيانات والثوابت من ملف الإعدادات
import { supabase, DB_TABLES, ROLES } from '../config/supabase.js';

// ==========================================
// 2. تحديد عناصر واجهة المستخدم (DOM Elements)
// ==========================================
const loginForm = document.getElementById('loginForm');
const loginEmailInput = document.getElementById('loginEmail');
const loginPasswordInput = document.getElementById('loginPassword');
const loginBtn = document.getElementById('loginBtn');
const alertMessage = document.getElementById('alertMessage');

// ==========================================
// 3. دوال مساعدة للواجهة (UI Helpers)
// ==========================================

/**
 * دالة لإظهار رسائل النجاح أو الخطأ
 * @param {string} message - نص الرسالة
 * @param {string} type - نوع الرسالة ('error' أو 'success')
 */
function showAlert(message, type = 'error') {
    alertMessage.innerText = message;
    
    // إزالة الكلاسات السابقة
    alertMessage.classList.remove('hidden', 'bg-red-100', 'text-red-700', 'dark:bg-red-900', 'dark:text-red-100', 'bg-green-100', 'text-green-700', 'dark:bg-green-900', 'dark:text-green-100');
    
    // إضافة الكلاسات بناءً على النوع (مع دعم الوضع الليلي)
    if (type === 'success') {
        alertMessage.classList.add('bg-green-100', 'text-green-700', 'dark:bg-green-900', 'dark:text-green-100');
    } else {
        alertMessage.classList.add('bg-red-100', 'text-red-700', 'dark:bg-red-900', 'dark:text-red-100');
    }
}

/**
 * دالة لإخفاء رسالة التنبيه
 */
function hideAlert() {
    alertMessage.classList.add('hidden');
    alertMessage.innerText = '';
}

/**
 * دالة للتحكم في حالة زر تسجيل الدخول (لمنع التكرار أثناء التحميل)
 */
function setButtonLoadingState(isLoading) {
    if (isLoading) {
        loginBtn.disabled = true;
        loginBtn.classList.add('opacity-75', 'cursor-not-allowed');
        // تغيير النص مع تأثير النبض وإضافة أيقونة تحميل بسيطة
        loginBtn.innerHTML = `<span class="animate-pulse flex items-center justify-center gap-2">
            <svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            جاري تسجيل الدخول...
        </span>`;
    } else {
        loginBtn.disabled = false;
        loginBtn.classList.remove('opacity-75', 'cursor-not-allowed');
        // استرجاع النص الأصلي بناءً على اللغة الحالية
        const currentLang = document.documentElement.lang || 'en';
        loginBtn.innerText = currentLang === 'ar' ? 'تسجيل الدخول' : 'Sign In';
    }
}

// ==========================================
// 4. منطق تسجيل الدخول (Login Logic)
// ==========================================
loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault(); // منع إعادة تحميل الصفحة الافتراضي
    hideAlert();
    setButtonLoadingState(true);

    const email = loginEmailInput.value.trim();
    const password = loginPasswordInput.value;

    try {
        // الخطوة الأولى: مصادقة المستخدم عبر Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email: email,
            password: password,
        });

        if (authError) {
            // معالجة أخطاء المصادقة الشائعة
            if (authError.message.includes('Invalid login credentials')) {
                throw new Error('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
            }
            throw authError;
        }

        // الخطوة الثانية: جلب بيانات المستخدم (الدور وحالة الحساب) من جدول users
        const { data: userData, error: userError } = await supabase
            .from(DB_TABLES.USERS)
            .select('role, is_active')
            .eq('email', email)
            .single();

        if (userError) {
            await supabase.auth.signOut(); // تسجيل خروج أمني إذا لم نجد بياناته
            throw new Error('حدث خطأ أثناء جلب بيانات حسابك. يرجى مراجعة الإدارة.');
        }

        // الخطوة الثالثة: التحقق مما إذا كان الحساب مفعلاً
        if (userData.is_active === false) {
            await supabase.auth.signOut(); // تسجيل خروجه فوراً
            throw new Error('حسابك موقوف حالياً. يرجى التواصل مع الدعم الفني.');
        }

        // الخطوة الرابعة: نجاح العملية والتوجيه
        showAlert('تم تسجيل الدخول بنجاح! جاري توجيهك...', 'success');

        // التوجيه بناءً على دور المستخدم (Role-Based Redirect)
        setTimeout(() => {
            switch (userData.role) {
                case ROLES.ADMIN:
                    window.location.replace('admin.html');
                    break;
                case ROLES.HOSPITAL:
                    window.location.replace('hospital.html');
                    break;
                case ROLES.DRIVER:
                    window.location.replace('driver.html');
                case ROLES.USER:
                default:
                    window.location.replace('user.html');
                    break;
            }
        }, 1500); // تأخير بسيط لرؤية رسالة النجاح

    } catch (error) {
        console.error('Login Error:', error);
        showAlert(error.message || 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.');
    } finally {
        // إعادة الزر لحالته الطبيعية في حالة الخطأ
        // ملاحظة: في حالة النجاح سيتم تحويل الصفحة ولن نحتاج لإعادة الزر
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
            setButtonLoadingState(false);
        }
    }
});

// ==========================================
// 5. الحفاظ على الجلسة (Session Persistence)
// ==========================================
/**
 * التحقق مما إذا كان المستخدم مسجلاً للدخول بالفعل عند فتح الصفحة
 * لتوجيهه فوراً دون الحاجة لكتابة بياناته مرة أخرى
 */
async function checkCurrentSession() {
    try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) throw sessionError;

        if (session && session.user) {
            // جلب دور المستخدم للتوجيه
            const { data: userData } = await supabase
                .from(DB_TABLES.USERS)
                .select('role, is_active')
                .eq('email', session.user.email)
                .single();
                
            if (userData && userData.is_active !== false) {
                // استخدام replace لمنع الرجوع لصفحة اللوجين عبر زر "Back" في المتصفح
                if (userData.role === ROLES.ADMIN) window.location.replace('admin.html');
                else if (userData.role === ROLES.HOSPITAL) window.location.replace('hospital.html');
                else window.location.replace('user.html');
            } else if (userData && userData.is_active === false) {
                // إذا كان الحساب مسجل دخول ولكنه توقف مؤخراً
                await supabase.auth.signOut();
            }
        }
    } catch (error) {
        console.error('Session Check Error:', error);
        // في حالة وجود خطأ في الجلسة، نقوم بمسحها لضمان بداية نظيفة
        await supabase.auth.signOut();
    }
}

// تنفيذ فحص الجلسة بمجرد تحميل الصفحة (قبل أن يتفاعل المستخدم)
document.addEventListener('DOMContentLoaded', checkCurrentSession);