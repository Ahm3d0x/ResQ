// ============================================================================
// ملف المحاكاة والتحكم للصفحة الرئيسية (Landing Page SPA) - نظام ResQ
// ============================================================================

// ==========================================
// 1. إدارة التبديل بين الشاشات (SPA Logic)
// ==========================================
window.switchView = function(viewId) {
    document.querySelectorAll('main > section').forEach(el => {
        el.classList.remove('view-active');
        el.classList.add('view-hidden');
    });
    document.getElementById(viewId).classList.remove('view-hidden');
    document.getElementById(viewId).classList.add('view-active');

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('text-primary');
        btn.classList.add('text-gray-500', 'dark:text-gray-400');
    });
    
    if(viewId === 'homeView') document.querySelectorAll('.nav-btn')[0].classList.add('text-primary');
    if(viewId === 'searchView') document.querySelectorAll('.nav-btn')[1].classList.add('text-primary');
    if(viewId === 'howView') {
        document.querySelectorAll('.nav-btn')[2].classList.add('text-primary');
        resetAndStartWorkflowAnimation();
    }
}

// ==========================================
// 2. محرك محاكاة الـ AI لتوجيه الإسعاف (Advanced Map Simulation)
// ==========================================

// إعدادات المستشفيات الموجودة على الخريطة
const hospitals = [
    { name: 'City Hosp.', top: 20, left: 20 },
    { name: 'Central ER', top: 80, left: 80 }
];

// إعدادات سيارات الإسعاف (تبدأ في أماكن مختلفة)
const ambulances = [
    { id: 'amb_1', name: 'U-1', state: 'idle', top: 30, left: 70 },
    { id: 'amb_2', name: 'U-2', state: 'idle', top: 70, left: 30 },
    { id: 'amb_3', name: 'U-3', state: 'idle', top: 50, left: 50 }
];

// دالة لكتابة الأحداث في الـ Terminal (لإعطاء طابع حي واقعي)
const feed = document.getElementById('simFeed');
function logTerminal(msg) {
    const time = new Date().toLocaleTimeString([], {hour12:false, minute:'2-digit', second:'2-digit'});
    const line = document.createElement('div');
    line.innerHTML = `<span class="text-gray-400">[${time}]</span> <span class="text-gray-700 dark:text-gray-300">${msg}</span>`;
    feed.appendChild(line);
    // الاحتفاظ بآخر 5 رسائل فقط حتى لا تمتلئ الشاشة
    if (feed.childElementCount > 5) feed.removeChild(feed.firstChild);
}

// دالة لحساب المسافة بين نقطتين
function getDistance(t1, l1, t2, l2) {
    return Math.hypot(t1 - t2, l1 - l2);
}

// دالة لتحريك سيارة الإسعاف بسلاسة
function moveAmbulance(amb, targetTop, targetLeft, speedPercentPerSec = 15) {
    return new Promise(resolve => {
        const dist = getDistance(amb.top, amb.left, targetTop, targetLeft);
        const timeSec = Math.max(dist / speedPercentPerSec, 0.5); // حساب وقت الرحلة
        
        const el = document.getElementById(amb.id);
        
        // تغيير لون الإطار حسب حالة الإسعاف لتمييزها بصرياً
        el.classList.remove('border-gray-400', 'border-warning', 'border-blue-500');
        if (amb.state === 'idle') el.classList.add('border-gray-400');
        else if (amb.state === 'to_accident') el.classList.add('border-warning'); // رايح للحادث (أصفر)
        else if (amb.state === 'to_hospital') el.classList.add('border-blue-500'); // رايح المستشفى (أزرق)

        // تطبيق الانتقال السلس بالـ CSS
        el.style.transition = `top ${timeSec}s linear, left ${timeSec}s linear`;
        el.style.top = `calc(${targetTop}% - 16px)`; // -16px للسنتر
        el.style.left = `calc(${targetLeft}% - 16px)`;
        
        amb.top = targetTop;
        amb.left = targetLeft;
        
        setTimeout(resolve, timeSec * 1000);
    });
}

// دالة لعمل دوريات عشوائية لسيارات الإسعاف الفاضية (Patrol)
function patrolIdleAmbulances() {
    ambulances.forEach(amb => {
        if (amb.state === 'idle') {
            // تحريك عشوائي في محيط بسيط
            let newTop = amb.top + (Math.random() * 20 - 10);
            let newLeft = amb.left + (Math.random() * 20 - 10);
            // منع خروجهم بره الخريطة (حصرهم بين 10% و 90%)
            newTop = Math.max(10, Math.min(90, newTop));
            newLeft = Math.max(10, Math.min(90, newLeft));
            
            moveAmbulance(amb, newTop, newLeft, 8); // سرعة بطيئة في الدوريات
        }
    });
}

// دالة توليد حادث عشوائي وإدارته
function spawnAccident() {
    const accTop = 15 + Math.random() * 70;
    const accLeft = 15 + Math.random() * 70;
    const accId = 'acc_' + Date.now();
    
    // 1. إنشاء عنصر الحادث على الخريطة
    const simCanvas = document.getElementById('simCanvas');
    const accEl = document.createElement('div');
    accEl.id = accId;
    accEl.className = 'absolute w-8 h-8 flex items-center justify-center z-10 transition-opacity duration-500';
    accEl.style.top = `calc(${accTop}% - 16px)`;
    accEl.style.left = `calc(${accLeft}% - 16px)`;
    accEl.innerHTML = `
        <div class="absolute inset-0 bg-primary/40 rounded-full animate-pingSoft"></div>
        <div class="w-3 h-3 bg-primary rounded-full shadow-[0_0_15px_red] animate-pulseRed"></div>
    `;
    simCanvas.appendChild(accEl);
    
    logTerminal(`🚨 New Crash Detected! Loc: [${Math.round(accTop)}, ${Math.round(accLeft)}]`);
    
    // 2. إدارة دورة الإنقاذ
    handleRescueMission(accTop, accLeft, accEl);
}

async function handleRescueMission(accTop, accLeft, accEl) {
    // 1. البحث عن أقرب إسعاف فاضي (إذا كانوا كلهم مشغولين، هينتظر ثانية ويحاول تاني)
    let assignedAmb = null;
    while(!assignedAmb) {
        let nearestDist = Infinity;
        ambulances.forEach(amb => {
            if (amb.state === 'idle') {
                // قراءة الموقع اللحظي للإسعاف أثناء حركته العشوائية
                const el = document.getElementById(amb.id);
                const rect = el.parentElement.getBoundingClientRect();
                const currentLeft = (parseFloat(window.getComputedStyle(el).left) / rect.width) * 100;
                const currentTop = (parseFloat(window.getComputedStyle(el).top) / rect.height) * 100;
                amb.left = currentLeft; amb.top = currentTop;

                const dist = getDistance(currentTop, currentLeft, accTop, accLeft);
                if (dist < nearestDist) {
                    nearestDist = dist;
                    assignedAmb = amb;
                }
            }
        });
        if (!assignedAmb) await new Promise(r => setTimeout(r, 1000));
    }
    
    // 2. توجيه الإسعاف للحادث
    assignedAmb.state = 'to_accident';
    logTerminal(`🚑 Dispatching ${assignedAmb.name} to crash site...`);
    await moveAmbulance(assignedAmb, accTop, accLeft, 25); // سرعة عالية للإنقاذ
    
    // 3. الوصول للحادث ونقل المريض
    logTerminal(`⚕️ ${assignedAmb.name} arrived. Stabilizing patient...`);
    accEl.style.opacity = '0'; // إخفاء الحادث
    await new Promise(r => setTimeout(r, 1500)); // وقت المعالجة
    accEl.remove(); // إزالة الحادث من الخريطة
    
    // 4. البحث عن أقرب مستشفى للحادث
    let nearestHosp = hospitals[0];
    let minHDist = Infinity;
    hospitals.forEach(h => {
        const dist = getDistance(assignedAmb.top, assignedAmb.left, h.top, h.left);
        if (dist < minHDist) {
            minHDist = dist;
            nearestHosp = h;
        }
    });
    
    // 5. التحرك للمستشفى
    assignedAmb.state = 'to_hospital';
    logTerminal(`🏥 ${assignedAmb.name} routing to ${nearestHosp.name}...`);
    await moveAmbulance(assignedAmb, nearestHosp.top, nearestHosp.left, 20);
    
    // 6. الوصول للمستشفى وإنهاء المهمة
    logTerminal(`✅ ${assignedAmb.name} dropped patient. Unit available.`);
    document.getElementById(assignedAmb.id).classList.remove('border-blue-500');
    document.getElementById(assignedAmb.id).classList.add('border-gray-400');
    await new Promise(r => setTimeout(r, 1000));
    assignedAmb.state = 'idle'; // جاهز لمهمة جديدة
}

// تهيئة النظام عند التحميل
document.addEventListener('DOMContentLoaded', () => {
    // وضع الإسعافات في أماكنهم الابتدائية
    ambulances.forEach(amb => moveAmbulance(amb, amb.top, amb.left, 50));
    logTerminal('System Initialized. Scanning area...');
    
    // تشغيل دوريات الإسعاف كل 4 ثواني
    setInterval(patrolIdleAmbulances, 4000);
    
    // توليد حادث جديد كل 9 ثواني (يسمح بتعدد الحوادث وعمل النظام بكامل طاقته)
    setInterval(spawnAccident, 9000);
    setTimeout(spawnAccident, 1000); // أول حادثة بعد ثانية
});
// ==========================================
// 3. محاكي بروتوكول البيانات (The ResQ Protocol Engine)
// ==========================================

let wfLoop;

function resetAndStartWorkflowAnimation() {
    clearInterval(wfLoop);
    const cards = document.querySelectorAll('.wf-card');
    const pulse = document.getElementById('wfPulse');
    const motion = document.getElementById('wfMotion');
    const log = document.getElementById('wfLog');

    // Reset All UI
    cards.forEach(c => {
        c.classList.remove('active', 'border-primary/40', 'bg-gray-800/60');
        const loader = c.querySelector('.wf-loader');
        if(loader) loader.style.width = '0%';
        const bits = c.querySelectorAll('.wf-bit');
        bits.forEach(b => b.style.width = '0%');
    });
    pulse.classList.add('opacity-0');

    let step = 0;

    async function nextStep() {
        if (step >= 4) {
            log.innerText = "PROTOCOL COMPLETE. RESTARTING...";
            setTimeout(resetAndStartWorkflowAnimation, 3000);
            return;
        }

        const card = document.getElementById(`step-${step}`);
        card.classList.add('active', 'border-primary/40', 'bg-gray-800/60');
        
        // المحاكاة بناءً على كل خطوة
        if (step === 0) {
            log.innerText = "IMPACT DETECTED. CAPTURING TELEMETRY...";
            card.querySelector('.wf-loader').style.width = '100%';
        } else if (step === 1) {
            log.innerText = "UPLINK ESTABLISHED. VERIFYING SIGNAL...";
            let timeLeft = 10;
            const counter = card.querySelector('.wf-counter');
            const bits = card.querySelectorAll('.wf-bit');
            const cd = setInterval(() => {
                timeLeft -= 0.5;
                counter.innerText = timeLeft.toFixed(2) + 's';
                if(timeLeft <= 8) bits[0].style.width = '100%';
                if(timeLeft <= 6) bits[1].style.width = '100%';
                if(timeLeft <= 4) bits[2].style.width = '100%';
                if(timeLeft <= 2) bits[3].style.width = '100%';
                if(timeLeft <= 0) { bits[4].style.width = '100%'; clearInterval(cd); }
            }, 100);
        } else if (step === 2) {
            log.innerText = "ANALYSING GPS MATRIX. DISPATCHING UNIT...";
        } else if (step === 3) {
            log.innerText = "HOSPITAL HANDSHAKE SUCCESSFUL. PREPARING ER.";
        }

        // تحريك النبضة (SVG Animation)
        if (step < 3) {
            const path = document.getElementById(`path-${step}-${step+1}`);
            pulse.classList.remove('opacity-0');
            motion.setAttribute('path', path.getAttribute('d'));
            motion.beginElement();
        } else {
            pulse.classList.add('opacity-0');
        }

        step++;
        setTimeout(nextStep, step === 2 ? 3000 : 2500);
    }

    nextStep();
}