const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeIcon = document.getElementById('themeIcon');
const htmlElement = document.documentElement;

// التحقق من الوضع المحفوظ أو إعدادات نظام المستخدم
let currentTheme = localStorage.getItem('resq_theme');
if (!currentTheme) {
    // لو مفيش حاجة محفوظة، شوف المتصفح/الجهاز بتاعه نظامه إيه
    currentTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
    if (theme === 'dark') {
        htmlElement.classList.add('dark');
        if(themeIcon) themeIcon.innerText = '☀️'; // لما يكون ليلي، الزرار يظهر شمس
    } else {
        htmlElement.classList.remove('dark');
        if(themeIcon) themeIcon.innerText = '🌙'; // لما يكون نهاري، الزرار يظهر هلال
    }
}

// عند الضغط على الزر
themeToggleBtn?.addEventListener('click', () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('resq_theme', currentTheme);
    applyTheme(currentTheme);
});

// التنفيذ عند تحميل الصفحة
applyTheme(currentTheme);