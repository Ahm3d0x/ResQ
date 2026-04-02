// ============================================================================
// القاموس الشامل (يحتوي على نصوص النظام بالكامل)
// ============================================================================
export const translations = {
    en: {
        // --- Shared & General ---
        langBtn: "العربية",
        logo: "ResQ",
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

        // --- Admin Global UI ---
        desktopOnly: "Desktop & Tablet Only",
        desktopOnlyDesc: "Command Center requires a larger screen for real-time map telemetry.",
        returnHome: "Return to Home",
        adminTitle: "ResQ Admin",
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

        // --- Admin Global UI ---
        desktopOnly: "للكمبيوتر والتابلت فقط",
        desktopOnlyDesc: "غرفة التحكم تتطلب شاشة أكبر لعرض الخريطة والتتبع اللحظي.",
        returnHome: "العودة للرئيسية",
        adminTitle: "إدارة ريسكيو",
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