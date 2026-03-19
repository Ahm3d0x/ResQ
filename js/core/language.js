// ============================================================================
// القاموس الشامل (يحتوي على نصوص الصفحة الرئيسية + صفحة الدخول)
// ============================================================================
const translations = {
    en: {
        // ------------------ Shared & Navbar ------------------
        langBtn: "العربية",
        logo: "ResQ",
        
        // ------------------ Login Page ------------------
        title: "Welcome Back",
        subtitle: "Enter your credentials to access the portal.",
        email: "Email Address",
        password: "Password",
        forgotPassword: "Forgot?",
        signInBtn: "Sign In",
        systemStatus: "System Online • 99.9% Uptime",
        loginHeroTitle: "Intelligent <span class='text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-primary'>Emergency</span> Coordination.",
        loginHeroDesc: "ResQ platform automates accident detection, instantly confirming incidents and dispatching the nearest ambulance within seconds.",
        activeAmbulances: "Active Ambulances",
        avgResponseTime: "Avg Response Time",
        incidentDetected: "Incident Confirmed (#892)",
        routingAction: "Auto-routing Unit 7 to City Hospital...",

        // ------------------ Index Page (Landing) ------------------
        navHome: "Home",
        navTrack: "Track Patient",
        navHow: "How it Works",
        navLogin: "Login Portal",
        
        liveBadge: "Live Emergency Grid Active",
        mainHeroTitle: "Every Second <br> <span class='text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-primary'>Counts.</span>",
        mainHeroDesc: "ResQ instantly detects accidents, bypasses traffic, and dispatches the nearest ambulance before anyone even dials for help.",
        btnTrack: "Track an Incident",
        simTitle: "Live Routing Engine",
        
        searchTitle: "Track Patient Status",
        searchDesc: "Enter the unique Device UID to check the real-time status and destination hospital of the patient.",
        deviceUid: "Device UID (128-chars or shortcode)",
        btnSearch: "Search Database",
        
        howTitle: "The ResQ Workflow",
        step1Title: "Hardware Detection",
        step1Desc: "G-Force sensors detect impact instantly and send coordinates.",
        step2Title: "10-Sec Verification",
        step2Desc: "A 10s timer allows driver cancellation to prevent false alarms.",
        step3Title: "Auto-Dispatch",
        step3Desc: "Our algorithm finds the nearest available ambulance instantly.",
        step4Title: "Hospital Alert",
        step4Desc: "Nearest hospital receives patient data to prepare ER instantly."
    },
    ar: {
        // ------------------ Shared & Navbar ------------------
        langBtn: "English",
        logo: "ريسكيو",

        // ------------------ Login Page ------------------
        title: "مرحباً بعودتك",
        subtitle: "أدخل بياناتك للوصول إلى لوحة التحكم.",
        email: "البريد الإلكتروني",
        password: "كلمة المرور",
        forgotPassword: "نسيت الكلمة؟",
        signInBtn: "تسجيل الدخول",
        systemStatus: "النظام متصل • 99.9% جاهزية",
        loginHeroTitle: "تنسيق <span class='text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-primary'>ذكي</span> لحالات الطوارئ.",
        loginHeroDesc: "منصة ResQ تعمل على أتمتة اكتشاف الحوادث، وتأكيدها فوراً، وتوجيه أقرب سيارة إسعاف في غضون ثوانٍ معدودة.",
        activeAmbulances: "سيارات الإسعاف النشطة",
        avgResponseTime: "متوسط وقت الاستجابة",
        incidentDetected: "تم تأكيد حادث (#892)",
        routingAction: "توجيه تلقائي للوحدة 7 إلى مستشفى المدينة...",

        // ------------------ Index Page (Landing) ------------------
        navHome: "الرئيسية",
        navTrack: "تتبع مريض",
        navHow: "كيف نعمل",
        navLogin: "بوابة الدخول",
        
        liveBadge: "شبكة الطوارئ الحية مفعلة",
        mainHeroTitle: "كل ثانية <br> <span class='text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-primary'>فارقة.</span>",
        mainHeroDesc: "يقوم النظام باكتشاف الحوادث فوراً، وتجاوز الزحام، وتوجيه أقرب سيارة إسعاف قبل حتى أن يطلب أحد المساعدة.",
        btnTrack: "تتبع حالة حادث",
        simTitle: "محرك التوجيه اللحظي",
        
        searchTitle: "تتبع حالة المريض",
        searchDesc: "أدخل الرقم التعريفي للجهاز (Device UID) لمعرفة الحالة اللحظية للمريض والمستشفى الموجه إليها.",
        deviceUid: "الرقم التعريفي (Device UID)",
        btnSearch: "البحث في النظام",
        
        howTitle: "كيف يعمل النظام؟",
        step1Title: "رصد فوري للحادث",
        step1Desc: "مستشعرات الجاذبية ترصد الاصطدام فوراً وترسل الإحداثيات.",
        step2Title: "تأكيد الـ 10 ثواني",
        step2Desc: "مؤقت 10 ثوانٍ يتيح للسائق إلغاء الإنذار لمنع البلاغات الكاذبة.",
        step3Title: "التوجيه التلقائي",
        step3Desc: "خوارزمياتنا تبحث عن أقرب سيارة إسعاف متاحة وتقوم بتوجيهها.",
        step4Title: "تنبيه المستشفى",
        step4Desc: "المستشفى الأقرب يتلقى بيانات الحالة لتجهيز الطوارئ قبل وصولها."
    }
};

const langToggleBtn = document.getElementById('langToggleBtn');
let currentLang = localStorage.getItem('resq_lang') || 'en';

function applyLanguage(lang) {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[lang][key]) {
            // استخدام innerHTML للحفاظ على التصميمات الفاخرة (Spans & Colors)
            el.innerHTML = translations[lang][key];
        }
    });

    if(langToggleBtn) {
        langToggleBtn.innerHTML = translations[lang].langBtn;
    }

    document.querySelectorAll('input').forEach(input => {
        input.style.textAlign = lang === 'ar' ? 'right' : 'left';
    });
}

langToggleBtn?.addEventListener('click', () => {
    currentLang = currentLang === 'en' ? 'ar' : 'en';
    localStorage.setItem('resq_lang', currentLang);
    applyLanguage(currentLang);
});

document.addEventListener('DOMContentLoaded', () => {
    applyLanguage(currentLang);
});