// قاموس الترجمة المبدئي
const translations = {
    en: {
        title: "Welcome Back",
        subtitle: "Enter your credentials to access the portal.",
        email: "Email Address",
        password: "Password",
        forgotPassword: "Forgot?",
        signInBtn: "Sign In",
        langBtn: "العربية",
        systemStatus: "System Online • 99.9% Uptime",
        heroTitle: "Intelligent Emergency Coordination.",
        heroDesc: "ResQ platform automates accident detection, instantly confirming incidents and dispatching the nearest ambulance within seconds.",
        activeAmbulances: "Active Ambulances",
        avgResponseTime: "Avg Response Time",
        incidentDetected: "Incident Confirmed (#892)",
        routingAction: "Auto-routing Unit 7 to City Hospital..."
    },
    ar: {
        title: "مرحباً بعودتك",
        subtitle: "أدخل بياناتك للوصول إلى لوحة التحكم.",
        email: "البريد الإلكتروني",
        password: "كلمة المرور",
        forgotPassword: "نسيت الكلمة؟",
        signInBtn: "تسجيل الدخول",
        langBtn: "English",
        systemStatus: "النظام متصل • 99.9% جاهزية",
        heroTitle: "تنسيق ذكي لحالات الطوارئ.",
        heroDesc: "منصة ResQ تعمل على أتمتة اكتشاف الحوادث، وتأكيدها فوراً، وتوجيه أقرب سيارة إسعاف في غضون ثوانٍ معدودة.",
        activeAmbulances: "سيارات الإسعاف النشطة",
        avgResponseTime: "متوسط وقت الاستجابة",
        incidentDetected: "تم تأكيد حادث (#892)",
        routingAction: "توجيه تلقائي للوحدة 7 إلى مستشفى المدينة..."
    }
};

const langToggleBtn = document.getElementById('langToggleBtn');
let currentLang = localStorage.getItem('resq_lang') || 'en';

function applyLanguage(lang) {
    // تغيير اتجاه الصفحة
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    
    // تحديث النصوص في كل عنصر يحتوي على data-i18n
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[lang][key]) {
            el.innerText = translations[lang][key];
        }
    });

    // تحديث زر تبديل اللغة
    if(langToggleBtn) {
        langToggleBtn.innerText = translations[lang].langBtn;
    }

    // تحديث اتجاه الـ Input Placeholders (اختياري بس بيدي شكل أحسن)
    document.querySelectorAll('input').forEach(input => {
        input.style.textAlign = lang === 'ar' ? 'right' : 'left';
    });
}

// عند الضغط على الزر
langToggleBtn?.addEventListener('click', () => {
    currentLang = currentLang === 'en' ? 'ar' : 'en';
    localStorage.setItem('resq_lang', currentLang);
    applyLanguage(currentLang);
});

// التنفيذ عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
    applyLanguage(currentLang);
});