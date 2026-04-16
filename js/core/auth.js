// ============================================================================
// ملف المصادقة المخصص (Custom Authentication) - نظام ResQ
// مفصول تماماً عن Supabase Auth ويعتمد على جدول users المستقل
// ============================================================================

import { supabase, DB_TABLES, ROLES } from '../config/supabase.js';

const loginForm = document.getElementById('loginForm');
const loginEmailInput = document.getElementById('loginEmail');
const loginPasswordInput = document.getElementById('loginPassword');
const loginBtn = document.getElementById('loginBtn');
const alertMessage = document.getElementById('alertMessage');

// ==========================================
// 1. دوال مساعدة للواجهة (UI Helpers)
// ==========================================
function showAlert(message, type = 'error') {
    alertMessage.innerText = message;
    alertMessage.classList.remove('hidden', 'bg-red-100', 'text-red-700', 'dark:bg-red-900', 'dark:text-red-100', 'bg-green-100', 'text-green-700', 'dark:bg-green-900', 'dark:text-green-100');
    
    if (type === 'success') {
        alertMessage.classList.add('bg-green-100', 'text-green-700', 'dark:bg-green-900', 'dark:text-green-100');
    } else {
        alertMessage.classList.add('bg-red-100', 'text-red-700', 'dark:bg-red-900', 'dark:text-red-100');
    }
}

function hideAlert() {
    alertMessage.classList.add('hidden');
    alertMessage.innerText = '';
}

function setButtonLoadingState(isLoading) {
    if (isLoading) {
        loginBtn.disabled = true;
        loginBtn.classList.add('opacity-75', 'cursor-not-allowed');
        loginBtn.innerHTML = `<span class="animate-pulse flex items-center justify-center gap-2">
            <i class="fa-solid fa-circle-notch fa-spin"></i> جاري التحقق...
        </span>`;
    } else {
        loginBtn.disabled = false;
        loginBtn.classList.remove('opacity-75', 'cursor-not-allowed');
        const currentLang = document.documentElement.lang || 'en';
        loginBtn.innerText = currentLang === 'ar' ? 'تسجيل الدخول' : 'Sign In';
    }
}

// ==========================================
// 2. منطق تسجيل الدخول المخصص (Custom Login)
// ==========================================
loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault(); 
    hideAlert();
    setButtonLoadingState(true);

    const email = loginEmailInput.value.trim();
    const password = loginPasswordInput.value;

    try {
        // الخطوة 1: البحث عن المستخدم في جدولنا المستقل
        const { data: userData, error: userError } = await supabase
            .from('users') // تأكد من اسم الجدول الخاص بك
            .select('*')
            .eq('email', email)
            .single();

        if (userError || !userData) {
            throw new Error('البريد الإلكتروني غير مسجل في النظام.');
        }

        // الخطوة 2: التحقق من كلمة المرور
        if (userData.password_hash !== password) {
            throw new Error('كلمة المرور غير صحيحة.');
        }

        // الخطوة 3: التحقق من حالة الحساب
        if (userData.is_active === false) {
            throw new Error('حسابك موقوف حالياً. يرجى التواصل مع الإدارة.');
        }

        // الخطوة 4: إنشاء جلسة مخصصة (Custom Session) في المتصفح
        const sessionData = {
            id: userData.id,
            name: userData.name,
            email: userData.email,
            role: userData.role
        };
        localStorage.setItem('resq_custom_session', JSON.stringify(sessionData));

        showAlert('تم تسجيل الدخول بنجاح! جاري التوجيه...', 'success');

        // التوجيه بناءً على الصلاحية
        setTimeout(() => {
            if (userData.role === 'admin') window.location.replace('admin.html');
            else if (userData.role === 'hospital') window.location.replace('hospital.html');
            else if (userData.role === 'driver') window.location.replace('driver.html');
            else window.location.replace('user.html');
        }, 1500);

    } catch (error) {
        console.error('Login Error:', error);
        showAlert(error.message);
        setButtonLoadingState(false);
    }
});

// ==========================================
// 3. الحفاظ على الجلسة المخصصة (Session Persistence)
// ==========================================
function checkCurrentSession() {
    try {
        const sessionString = localStorage.getItem('resq_custom_session');
        
        // Skip redirect logic for Engine System
        if (window.location.pathname.includes('engine')) {
            return;
        }

        if (sessionString) {
            const userData = JSON.parse(sessionString);
            
            // لو مسجل دخول، نوجهه فوراً لصفحته عشان ميشوفش فورم اللوجين
            if (userData.role === 'admin') window.location.replace('admin.html');
            else if (userData.role === 'hospital') window.location.replace('hospital.html');
            else if (userData.role === 'driver') window.location.replace('driver.html');
            else window.location.replace('user.html');
        }
    } catch (error) {
        console.error('Session Check Error:', error);
        localStorage.removeItem('resq_custom_session'); // تنظيف لو في خطأ
    }
}

// تنفيذ الفحص فور تحميل الصفحة
document.addEventListener('DOMContentLoaded', checkCurrentSession);