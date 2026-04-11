// ============================================================================
// القاموس الشامل (يحتوي على نصوص النظام بالكامل)
// ============================================================================
export const translations = {
    en: {
        // --- Shared & General ---
        langBtn: "العربية",
        logo: "EnQaZ",
        loading: "Loading...",
        processing: "Processing...",
        save: "Save",
        cancel: "Cancel",
        close: "Close",
        delete: "Delete",
        edit: "Edit",
        view: "View",
        status: "Status",
        actions: "Actions",

        navHome: "Home",
        navApply: "Apply for Device",
        navTrack: "Track Patient",
        navHow: "How it Works",
        navLogin: "Login Portal",
        
        liveBadge: "Intelligent Ambulance Dispatch Active",
        mainHeroTitle: "Every Second <br> <span class=\"text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-primary\">Counts.</span>",
        mainHeroDesc: "ResQ platform automates accident detection, instantly verifying incidents and dispatching the nearest ambulance.",
        btnTrack: "Track Patient Status",
        
        simTitle: "Live Coordination Map",
        
        searchTitle: "Track Patient Status",
        searchDesc: "Enter the unique Device UID to check the real-time status and destination hospital of the patient.",
        deviceUid: "Device UID",
        btnSearch: "Search Database",
        
        howTitle: "System Protocol",
        step1Title: "Hardware Detection",
        step1Desc: "G-Force sensors detect impact instantly and send coords.",
        step2Title: "10-Sec Verification",
        step3Title: "Auto-Dispatch",
        step4Title: "Hospital Alert",
        // --- Admin Global UI ---
        desktopOnly: "Desktop & Tablet Only",
        desktopOnlyDesc: "Command Center requires a larger screen for real-time map telemetry.",
        returnHome: "Return to Home",
        adminTitle: "EnQaZ Admin",
        aiDispatch: "AI Dispatch Live",
        maximizeMap: "Maximize Map",
        showPanels: "Show Panels",
        
        // --- Sidebar ---
        navDash: "Dashboard",
        navUsers: "Users",
        navHospitals: "Hospitals",
        navAmbulances: "Ambulances",

        // --- Dashboard Module ---
        dashIncidents: "Incidents",
        dashFleet: "Fleet",
        dashDevices: "Active Devices",
        searchDevicePlaceholder: "Search ID or Owner...",
        panelDetailsTitle: "Details",

        // --- Users Module ---
        usersTitle: "Users Management",
        usersDesc: "Manage drivers, hospitals, admins, and app users.",
        addNewUser: "Add New User",
        searchUsers: "Search Name, Email, ID...",
        allRoles: "All Roles",
        allStatus: "All Status",
        active: "Active",
        suspended: "Suspended",
        id: "ID",
        name: "Name",
        email: "Email",
        phone: "Phone",
        role: "Role",

        // --- Hospitals Module ---
        hospTitle: "Hospitals Network",
        hospDesc: "Manage facilities, locations, and real-time bed capacities.",
        addHosp: "Add Hospital",
        searchHosp: "Search Name, City, ID...",
        allCapacities: "All Capacities",
        bedsAvailable: "Beds Available",
        fullBeds: "Full (0 Beds)",
        hospName: "Hospital Name",
        location: "Location",
        availBeds: "Available Beds",
        adminAcc: "Admin Account",
// --- Devices Module ---
        navDevices: "Devices",
        devTitle: "Devices Management",
        devDesc: "Manage hardware crash-detection units, assign owners, and track status.",
        addDevice: "Add Device",
        searchDevice: "Search UID, Owner, Car Plate...",
        colDeviceUid: "Device UID",
        colOwner: "Owner Info",
        colCarInfo: "Car Details",
        modalAddDevTitle: "Add New Device",
        lblDeviceUid: "Hardware UID (Unique)",
        lblAssignUser: "Assign to User",
        lblCarModel: "Car Model & Year",
        lblCarPlate: "License Plate",
        btnSaveDevice: "Save Device",
        modalViewDevTitle: "Device Profile",
        lblRegDate: "Registration Date",
        modalDevFilterTitle: "Geographic Devices Filter",
        lblFilterDescDev: "Click on the map to set a center point, then adjust the radius to find active devices within that zone.",
        unassigned: "Unassigned",
        confirmTitle: "Are you sure?",
        confirmMessage: "This action cannot be undone.",
        btnTraffic: "Live Traffic",
        btnHeatmap: "Incident Heatmap",
        notifications: "Notifications",
        noNotifs: "No new notifications",
        logout: "Logout",
        // --- Ambulances Module ---
        ambTitle: "Fleet Management",
        ambDesc: "Manage ambulance units, drivers, and dispatch base zones.",
        addAmb: "Add Unit",
        searchAmb: "Search Code, Driver...",
        mapFilter: "Map Filter",
        unitCode: "Unit Code",
        assignedDriver: "Assigned Driver",
        baseZone: "Base Zone",
        // --- Logs Module ---
        navLogs: "System Logs",
        logsTitle: "Audit & Activity Logs",
        logsDesc: "Track all administrative actions, updates, and deletions.",
        searchLogs: "Search admin name, notes...",
        allActions: "All Actions",
        allTables: "All Modules",
        colDate: "Date & Time",
        colAdmin: "Admin",
        colAction: "Action",
        colTarget: "Target Module",
        colNote: "Details / Note",
        // --- Incidents Module ---
        navIncidents: "Incident Records",
        incRecordsTitle: "Emergency Incident Logs",
        incRecordsDesc: "Review historic incidents, impact data, and response times.",
        searchInc: "Search Incident ID, Device UID...",
        colGForce: "G-Force",
        colResponse: "Response Status",
        modalViewIncTitle: "Incident Report",
        lblIncidentTime: "Incident Time",
        lblResolvedTime: "Resolved At",
        lblAssignedAmb: "Assigned Ambulance",
        lblAssignedHosp: "Assigned Hospital",
        modalIncFilterTitle: "Geographic Incident Search",
        lblFilterDescInc: "Locate incidents within a specific radius on the map.",

        speed: "Speed at Impact",
        timeline: "Incident Lifecycle Timeline",
        outcome: "Medical Outcome",
        treated: "Discharged / Treated",
        deceased: "Deceased",
        impactPoint: "Impact Location",
        stepCreated: "Collision Detected",
        stepAssigned: "Ambulance Dispatched",
        stepArrived: "Ambulance Reached Site",
        stepHospital: "Arrived at Hospital",
        stepResolved: "Medical Case Closed",
        sysInit: "System Initialized. Scanning area...",
crashDetected: "CRASH DETECTED: Civilian Vehicle #",
dispatching: "Dispatching",
toCrashSite: "to crash site...",
securingPatient: "securing patient...",
routingTo: "routing to",
droppedPatient: "dropped patient. Resuming patrol.",
wfComplete: "PROTOCOL COMPLETE. RESTARTING...",
wfImpact: "IMPACT DETECTED. CAPTURING TELEMETRY...",
wfUplink: "UPLINK ESTABLISHED. VERIFYING SIGNAL...",
wfAnalysing: "ANALYSING GPS MATRIX. DISPATCHING UNIT...",
wfHospital: "HOSPITAL HANDSHAKE SUCCESSFUL. PREPARING ER.",
navApps: "Device Applications",
appTitle: "Hardware Requests",
appTableOwner: "Applicant Name",
appTableCar: "Vehicle Info",
appStatus: "Status",
sysInit: "System Initialized. Scanning area...",
        crashDetected: "CRASH DETECTED: Civilian Vehicle #",
        dispatching: "Dispatching",
        toCrashSite: "to crash site...",
        securingPatient: "securing patient...",
        routingTo: "routing to",
        droppedPatient: "dropped patient. Resuming patrol.",
        wfComplete: "PROTOCOL COMPLETE. RESTARTING...",
        wfImpact: "IMPACT DETECTED. CAPTURING TELEMETRY...",
        wfUplink: "UPLINK ESTABLISHED. VERIFYING SIGNAL...",
        wfAnalysing: "ANALYSING GPS MATRIX. DISPATCHING UNIT...",
        wfHospital: "HOSPITAL HANDSHAKE SUCCESSFUL. PREPARING ER.",

    },
    ar: {
        // --- Shared & General ---
        langBtn: "English",
        logo: "ريسكيو",
        loading: "جاري التحميل...",
        processing: "جاري المعالجة...",
        save: "حفظ",
        cancel: "إلغاء",
        close: "إغلاق",
        delete: "حذف",
        edit: "تعديل",
        view: "عرض",
        status: "الحالة",
        actions: "الإجراءات",
        logo: "إنقاذ",
        navHome: "الرئيسية",
        navApply: "طلب جهاز",
        navTrack: "تتبع مريض",
        navHow: "كيف يعمل النظام",
        navLogin: "بوابة الدخول",
        navApps: "طلبات الأجهزة",
appTitle: "سجل طلبات الأجهزة",
appTableOwner: "اسم المتقدم",
appTableCar: "بيانات المركبة",
appStatus: "الحالة",
sysInit: "تم تشغيل النظام. جاري فحص المنطقة...",
        crashDetected: "تم رصد حادث: سيارة مدنية رقم ",
        dispatching: "جاري توجيه",
        toCrashSite: "إلى موقع الحادث...",
        securingPatient: "يقوم بتأمين المصاب...",
        routingTo: "في طريقه إلى مستشفى",
        droppedPatient: "تم تسليم الحالة. العودة للدورية.",
        wfComplete: "اكتمل البروتوكول. جاري إعادة التشغيل...",
        wfImpact: "تم اكتشاف اصطدام. جاري جمع البيانات...",
        wfUplink: "تم الاتصال بالشبكة. جاري التحقق من الإشارة...",
        wfAnalysing: "جاري تحليل إحداثيات GPS. توجيه الإسعاف...",
        wfHospital: "تم التواصل مع المستشفى بنجاح. تجهيز الطوارئ.",
        liveBadge: "نظام توجيه الإسعاف الذكي مفعل",
        mainHeroTitle: "كل ثانية <br> <span class=\"text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-primary\">تُنقذ حياة.</span>",
        mainHeroDesc: "منصة إنقاذ تقوم بأتمتة كشف الحوادث، والتحقق منها لحظياً، وتوجيه أقرب سيارة إسعاف لإنقاذ المصابين.",
        btnTrack: "تتبع حالة المريض",
        
        simTitle: "خريطة التنسيق اللحظي",
        
        searchTitle: "تتبع حالة المريض",
        searchDesc: "أدخل المعرف الفريد للجهاز (Device UID) لمعرفة الحالة اللحظية والمستشفى الموجه إليه المريض.",
        deviceUid: "معرف الجهاز (UID)",
        btnSearch: "البحث في قاعدة البيانات",
        
        howTitle: "بروتوكول النظام",
        step1Title: "اكتشاف الحادث",
        step1Desc: "مستشعرات الحركة تكتشف الاصطدام فوراً وترسل الإحداثيات.",
        step2Title: "10 ثواني للتحقق",
        step3Title: "التوجيه التلقائي",
        step4Title: "تنبيه المستشفى",
        step4Desc: "أقرب مستشفى يستلم بيانات المريض لتجهيز الطوارئ فوراً.",
        // --- Admin Global UI ---
        desktopOnly: "للكمبيوتر والتابلت فقط",
        desktopOnlyDesc: "غرفة التحكم تتطلب شاشة أكبر لعرض الخريطة والتتبع اللحظي.",
        returnHome: "العودة للرئيسية",
        adminTitle: "إدارة إنقاذ",
        aiDispatch: "توجيه ذكي نشط",
        maximizeMap: "تكبير الخريطة",
        showPanels: "إظهار القوائم",
        
        // --- Sidebar ---
        navDash: "لوحة القيادة",
        navUsers: "المستخدمين",
        navHospitals: "المستشفيات",
        navAmbulances: "الإسعافات",

        // --- Dashboard Module ---
        dashIncidents: "الحوادث",
        dashFleet: "الأسطول",
        dashDevices: "الأجهزة النشطة",
        searchDevicePlaceholder: "بحث بالمعرف أو المالك...",
        panelDetailsTitle: "التفاصيل",

        // --- Users Module ---
        usersTitle: "إدارة المستخدمين",
        usersDesc: "إدارة السائقين، المستشفيات، المديرين، ومستخدمي التطبيق.",
        addNewUser: "إضافة مستخدم",
        searchUsers: "بحث بالاسم، الإيميل، ID...",
        allRoles: "جميع الصلاحيات",
        allStatus: "جميع الحالات",
        active: "نشط",
        suspended: "موقوف",
        id: "الرقم",
        name: "الاسم",
        email: "البريد الإلكتروني",
        phone: "الهاتف",
        role: "الصلاحية",

        // --- Hospitals Module ---
        hospTitle: "شبكة المستشفيات",
        hospDesc: "إدارة المنشآت، المواقع، والسعة اللحظية للأسرة.",
        addHosp: "إضافة مستشفى",
        searchHosp: "بحث بالاسم، المدينة، ID...",
        allCapacities: "جميع السعات",
        bedsAvailable: "يوجد أسرة",
        fullBeds: "ممتلئ (0 أسرة)",
        hospName: "اسم المستشفى",
        location: "الموقع",
        availBeds: "الأسرة المتاحة",
        adminAcc: "حساب الإدارة",
// --- Devices Module ---
        navDevices: "الأجهزة النشطة",
        devTitle: "إدارة الأجهزة",
        devDesc: "إدارة وحدات رصد الحوادث، تعيين الملاك، وتتبع الحالة اللحظية.",
        addDevice: "إضافة جهاز",
        searchDevice: "بحث بالمعرف، المالك، اللوحة...",
        colDeviceUid: "المعرف (UID)",
        colOwner: "بيانات المالك",
        colCarInfo: "بيانات السيارة",
        modalAddDevTitle: "إضافة جهاز جديد",
        lblDeviceUid: "المعرف الفريد للجهاز",
        lblAssignUser: "ربط بمستخدم",
        lblCarModel: "موديل وسنة الصنع",
        lblCarPlate: "رقم اللوحة",
        btnSaveDevice: "حفظ الجهاز",
        modalViewDevTitle: "ملف الجهاز",
        lblRegDate: "تاريخ التسجيل",
        modalDevFilterTitle: "فلتر الأجهزة الجغرافي",
        lblFilterDescDev: "اضغط على الخريطة لتحديد نقطة المركز، ثم اضبط النطاق للبحث عن الأجهزة في هذا المحيط.",
        unassigned: "غير معين",
        confirmTitle: "هل أنت متأكد؟",
        confirmMessage: "هذا الإجراء لا يمكن التراجع عنه.",
        btnTraffic: "الزحام المروري",
        btnHeatmap: "الخريطة الحرارية",
        notifications: "الإشعارات الحية",
        noNotifs: "لا توجد إشعارات جديدة",
        logout: "تسجيل الخروج",
        // --- Ambulances Module ---
        ambTitle: "إدارة الأسطول",
        ambDesc: "إدارة سيارات الإسعاف، السائقين، ونقاط التمركز.",
        addAmb: "إضافة سيارة",
        searchAmb: "بحث بالكود، السائق...",
        mapFilter: "فلتر الخريطة",
        unitCode: "كود السيارة",
        assignedDriver: "السائق المعين",
        baseZone: "نقطة التمركز",
        // --- Logs Module ---
        navLogs: "سجل العمليات",
        logsTitle: "سجل نشاطات النظام",
        logsDesc: "تتبع جميع الإجراءات الإدارية، التحديثات، وعمليات الحذف.",
        searchLogs: "بحث باسم المدير، تفاصيل...",
        allActions: "كل الإجراءات",
        allTables: "كل الوحدات",
        colDate: "التاريخ والوقت",
        colAdmin: "المدير (المسؤول)",
        colAction: "الإجراء",
        colTarget: "الوحدة المستهدفة",
        colNote: "التفاصيل / ملاحظات",
        // --- Incidents Module ---
        navIncidents: "سجل الحوادث",
        incRecordsTitle: "سجلات الطوارئ والحوادث",
        incRecordsDesc: "مراجعة تاريخ الحوادث، بيانات الاصطدام، وأوقات الاستجابة.",
        searchInc: "بحث برقم الحادث، معرف الجهاز...",
        colGForce: "قوة الاصطدام",
        colResponse: "حالة الاستجابة",
        modalViewIncTitle: "تقرير الحادث التفصيلي",
        lblIncidentTime: "وقت وقوع الحادث",
        lblResolvedTime: "وقت الإغلاق",
        lblAssignedAmb: "الإسعاف الموكل",
        lblAssignedHosp: "المستشفى المستقبل",
        modalIncFilterTitle: "بحث الحوادث الجغرافي",
        lblFilterDescInc: "تحديد موقع الحوادث ضمن نطاق معين على الخريطة.",

        speed: "السرعة عند الاصطدام",
        timeline: "التسلسل الزمني للحادثة",
        outcome: "النتيجة الطبية",
        treated: "تمت المعالجة / خروج",
        deceased: "وفاة",
        impactPoint: "موقع الاصطدام",
        stepCreated: "رصد الاصطدام",
        stepAssigned: "تعيين سيارة إسعاف",
        stepArrived: "وصول الإسعاف للموقع",
        stepHospital: "الوصول للمستشفى",
        stepResolved: "إغلاق الحالة الطبية",
        sysInit: "تم تشغيل النظام. جاري فحص المنطقة...",
crashDetected: "تم رصد حادث: سيارة مدنية رقم ",
dispatching: "جاري توجيه إسعاف",
toCrashSite: "إلى موقع الحادث...",
securingPatient: "يقوم بتأمين المصاب...",
routingTo: "في طريقه إلى مستشفى",
droppedPatient: "تم تسليم الحالة. العودة للدورية.",
wfComplete: "اكتمل البروتوكول. جاري إعادة التشغيل...",
wfImpact: "تم اكتشاف اصطدام. جاري جمع البيانات...",
wfUplink: "تم الاتصال بالشبكة. جاري التحقق من الإشارة...",
wfAnalysing: "جاري تحليل إحداثيات GPS. توجيه الإسعاف...",
wfHospital: "تم التواصل مع المستشفى بنجاح. تجهيز الطوارئ."

    }
};

export let currentLang = localStorage.getItem('resq_lang') || 'en';

// دالة تصدير لترجمة الكلمات داخل ملفات الـ JS
export function t(key) {
    return translations[currentLang][key] || key;
}

export function applyLanguage(lang) {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    
    // ترجمة عناصر الـ HTML الثابتة
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[lang][key]) {
            el.innerHTML = translations[lang][key];
        }
    });

    // ترجمة الـ Placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (translations[lang][key]) {
            el.placeholder = translations[lang][key];
        }
    });

    const langToggleBtn = document.getElementById('langToggleBtn');
    if(langToggleBtn) {
        langToggleBtn.innerHTML = translations[lang].langBtn;
    }

    // عكس اتجاه النصوص في الحقول (اختياري)
    document.querySelectorAll('input:not([type="hidden"])').forEach(input => {
        input.style.textAlign = lang === 'ar' ? 'right' : 'left';
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const langToggleBtn = document.getElementById('langToggleBtn');
    
    langToggleBtn?.addEventListener('click', () => {
        currentLang = currentLang === 'en' ? 'ar' : 'en';
        localStorage.setItem('resq_lang', currentLang);
        applyLanguage(currentLang);
        
        // إرسال حدث (Event) لباقي الملفات لتحديث الجداول والنصوص الديناميكية
        window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang: currentLang } }));
    });

    applyLanguage(currentLang);
});