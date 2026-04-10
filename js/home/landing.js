// ============================================================================
// ملف المحاكاة والتحكم للصفحة الرئيسية (Landing Page SPA) - نظام ResQ
// الإصدار المتقدم: مرور سيارات، دوريات ذكية، حوادث متعددة مع دعم تعدد اللغات
// ============================================================================

import { t } from '../core/language.js'; // استدعاء دالة الترجمة

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
// 2. محرك محاكاة الـ AI (Advanced Map Simulation v4)
// ==========================================

const hospitals = [
    { name: 'City Hosp.', top: 20, left: 20 },
    { name: 'Central ER', top: 80, left: 80 }
];

// إسعافات موزعة بشكل مبدئي على الخريطة
const ambulances = [
    { id: 'amb_1', name: 'U-1', state: 'idle', top: 20, left: 80, isMoving: false, moveTimeout: null },
    { id: 'amb_2', name: 'U-2', state: 'idle', top: 80, left: 20, isMoving: false, moveTimeout: null },
    { id: 'amb_3', name: 'U-3', state: 'idle', top: 50, left: 50, isMoving: false, moveTimeout: null }
];

const feed = document.getElementById('simFeed');
const trafficLayer = document.getElementById('trafficLayer');
let carIdCounter = 1;
let activeCars = 0;
const MAX_CARS = 4; // أقصى عدد للسيارات المدنية على الخريطة في نفس الوقت

function logTerminal(msg) {
    const time = new Date().toLocaleTimeString([], {hour12:false, minute:'2-digit', second:'2-digit'});
    const line = document.createElement('div');
    line.innerHTML = `<span class="text-gray-400">[${time}]</span> <span class="text-gray-700 dark:text-gray-300">${msg}</span>`;
    feed.appendChild(line);
    if (feed.childElementCount > 5) feed.removeChild(feed.firstChild);
}

function getDistance(t1, l1, t2, l2) {
    return Math.hypot(t1 - t2, l1 - l2);
}

// دالة لتجميد الإسعاف في مكانه الحالي لقطع الدورية والتوجه للحادث
function interruptAmbulance(amb) {
    if (amb.moveTimeout) {
        clearTimeout(amb.moveTimeout);
        amb.moveTimeout = null;
    }
    const el = document.getElementById(amb.id);
    const parent = el.parentElement;
    const comp = window.getComputedStyle(el);
    
    // حساب الإحداثيات اللحظية بالنسبة المئوية
    const currentLeft = (parseFloat(comp.left) / parent.clientWidth) * 100;
    const currentTop = (parseFloat(comp.top) / parent.clientHeight) * 100;

    el.style.transition = 'none';
    el.style.top = `calc(${currentTop}% - 16px)`;
    el.style.left = `calc(${currentLeft}% - 16px)`;

    amb.top = currentTop;
    amb.left = currentLeft;
    amb.isMoving = false;
}

// دالة التحريك الذكية (يمكن مقاطعتها)
function moveAmbulance(amb, targetTop, targetLeft, speedPercentPerSec = 15) {
    return new Promise(resolve => {
        // لو الإسعاف بيتحرك، نوقفه الأول عشان نحدث مساره
        interruptAmbulance(amb);

        const dist = getDistance(amb.top, amb.left, targetTop, targetLeft);
        const timeSec = Math.max(dist / speedPercentPerSec, 0.5);
        
        const el = document.getElementById(amb.id);
        
        el.classList.remove('border-gray-400', 'border-warning', 'border-blue-500');
        if (amb.state === 'idle') el.classList.add('border-gray-400');
        else if (amb.state === 'to_accident') el.classList.add('border-warning');
        else if (amb.state === 'to_hospital') el.classList.add('border-blue-500');

        amb.isMoving = true;
        // إجبار المتصفح على تطبيق الإيقاف قبل بدء الحركة الجديدة
        void el.offsetWidth; 

        el.style.transition = `top ${timeSec}s linear, left ${timeSec}s linear`;
        el.style.top = `calc(${targetTop}% - 16px)`;
        el.style.left = `calc(${targetLeft}% - 16px)`;
        
        amb.top = targetTop;
        amb.left = targetLeft;
        
        amb.moveTimeout = setTimeout(() => {
            amb.isMoving = false;
            resolve();
        }, timeSec * 1000);
    });
}

// دوريات واسعة المدى تمنع التكتل
function patrolIdleAmbulances() {
    ambulances.forEach(amb => {
        if (amb.state === 'idle' && !amb.isMoving) {
            // اختيار نقطة عشوائية بعيدة في الخريطة لنشر الإسعافات
            let rTop = 15 + Math.random() * 70;
            let rLeft = 15 + Math.random() * 70;
            moveAmbulance(amb, rTop, rLeft, 8); // دورية هادئة
        }
    });
}

// ==========================================
// محاكاة السيارات المدنية والحوادث
// ==========================================
function spawnCivilianCar() {
    if (activeCars >= MAX_CARS) return;
    activeCars++;

    const carId = `car_${carIdCounter++}`;
    const carEl = document.createElement('div');
    carEl.id = carId;
    carEl.className = 'absolute w-6 h-6 flex items-center justify-center transition-all ease-linear drop-shadow-md text-xl';
    carEl.innerHTML = '🚙'; // أيقونة السيارة
    
    // نقطة بداية عشوائية
    let currentTop = 10 + Math.random() * 80;
    let currentLeft = 10 + Math.random() * 80;
    
    carEl.style.top = `calc(${currentTop}% - 12px)`;
    carEl.style.left = `calc(${currentLeft}% - 12px)`;
    trafficLayer.appendChild(carEl);

    // حركة السيارة المدنية
    function driveCar() {
        // 15% نسبة إن العربية دي تعمل حادثة في كل محطة
        if (Math.random() < 0.15) {
            triggerAccident(carId, carEl, currentTop, currentLeft);
            return; // توقف عن القيادة
        }

        // تحرك لمكان جديد
        let nextTop = 10 + Math.random() * 80;
        let nextLeft = 10 + Math.random() * 80;
        let dist = getDistance(currentTop, currentLeft, nextTop, nextLeft);
        let timeSec = dist / 10; // سرعة العربيات العادية

        carEl.style.transition = `top ${timeSec}s linear, left ${timeSec}s linear`;
        carEl.style.top = `calc(${nextTop}% - 12px)`;
        carEl.style.left = `calc(${nextLeft}% - 12px)`;
        
        currentTop = nextTop;
        currentLeft = nextLeft;

        setTimeout(() => {
            if (document.getElementById(carId)) driveCar(); // استمر في القيادة
        }, timeSec * 1000);
    }

    // الانتظار قليلاً ثم بدء الحركة
    setTimeout(driveCar, 500);
}

// تحويل السيارة العادية لحادث
function triggerAccident(carId, carEl, accTop, accLeft) {
    // إيقاف السيارة في مكانها
    const parent = carEl.parentElement;
    const comp = window.getComputedStyle(carEl);
    const stoppedLeft = (parseFloat(comp.left) / parent.clientWidth) * 100;
    const stoppedTop = (parseFloat(comp.top) / parent.clientHeight) * 100;
    
    carEl.style.transition = 'none';
    carEl.style.top = `calc(${stoppedTop}% - 12px)`;
    carEl.style.left = `calc(${stoppedLeft}% - 12px)`;
    
    // تحويل الشكل لحادث
    carEl.innerHTML = `
        <div class="absolute inset-0 bg-primary/40 rounded-full animate-pingSoft z-0"></div>
        <div class="relative z-10 text-xl">💥</div>
    `;
    
    const crashText = t('crashDetected') || 'CRASH DETECTED: Civilian Vehicle #';
    logTerminal(`🚨 ${crashText}${carId.split('_')[1]}`);
    
    // إرسال الإسعاف
    handleRescueMission(stoppedTop, stoppedLeft, carEl);
}

async function handleRescueMission(accTop, accLeft, accEl) {
    let assignedAmb = null;
    
    // 1. البحث المستمر عن أقرب إسعاف "فاضي"
    while(!assignedAmb) {
        let nearestDist = Infinity;
        ambulances.forEach(amb => {
            if (amb.state === 'idle') {
                // مقاطعة وحساب المكان اللحظي أثناء الدورية
                const el = document.getElementById(amb.id);
                const rect = el.parentElement.getBoundingClientRect();
                const comp = window.getComputedStyle(el);
                const currentLeft = (parseFloat(comp.left) / rect.width) * 100;
                const currentTop = (parseFloat(comp.top) / rect.height) * 100;
                
                const dist = getDistance(currentTop, currentLeft, accTop, accLeft);
                if (dist < nearestDist) {
                    nearestDist = dist;
                    assignedAmb = amb;
                    // تحديث الإحداثيات اللحظية لاستخدامها في التحرك
                    amb.top = currentTop;
                    amb.left = currentLeft;
                }
            }
        });
        if (!assignedAmb) await new Promise(r => setTimeout(r, 1000)); // انتظار لو كلهم مشغولين
    }
    
    // 2. توجيه الأقرب
    assignedAmb.state = 'to_accident';
    const dispatchText = t('dispatching') || 'Dispatching';
    const siteText = t('toCrashSite') || 'to crash site...';
    logTerminal(`🚑 ${dispatchText} ${assignedAmb.name} ${siteText}`);
    await moveAmbulance(assignedAmb, accTop, accLeft, 25); // سرعة قصوى للإنقاذ
    
    // 3. التحميل (اختفاء الحادث)
    const secureText = t('securingPatient') || 'securing patient...';
    logTerminal(`⚕️ ${assignedAmb.name} ${secureText}`);
    accEl.style.opacity = '0'; 
    await new Promise(r => setTimeout(r, 1000)); 
    accEl.remove(); // إزالة السيارة
    activeCars--; // إتاحة مكان لسيارة جديدة
    
    // 4. اختيار أقرب مستشفى بناءً على موقع الحادث/الإسعاف الحالي
    let nearestHosp = hospitals[0];
    let minHDist = Infinity;
    hospitals.forEach(h => {
        const dist = getDistance(assignedAmb.top, assignedAmb.left, h.top, h.left);
        if (dist < minHDist) {
            minHDist = dist;
            nearestHosp = h;
        }
    });
    
    // 5. التوجه للمستشفى
    assignedAmb.state = 'to_hospital';
    const routingText = t('routingTo') || 'routing to';
    logTerminal(`🏥 ${assignedAmb.name} ${routingText} ${nearestHosp.name}...`);
    await moveAmbulance(assignedAmb, nearestHosp.top, nearestHosp.left, 20);
    
    // 6. إنهاء المهمة والعودة للدورية
    const droppedText = t('droppedPatient') || 'dropped patient. Resuming patrol.';
    logTerminal(`✅ ${assignedAmb.name} ${droppedText}`);
    document.getElementById(assignedAmb.id).classList.remove('border-blue-500');
    document.getElementById(assignedAmb.id).classList.add('border-gray-400');
    assignedAmb.state = 'idle'; 
    assignedAmb.isMoving = false; // جاهز ليتلقى أوامر دورية جديدة
}

// ==========================================
// التهيئة العامة
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // توزيع الإسعافات مبدئياً
    ambulances.forEach(amb => {
        document.getElementById(amb.id).style.top = `calc(${amb.top}% - 16px)`;
        document.getElementById(amb.id).style.left = `calc(${amb.left}% - 16px)`;
    });
    
    logTerminal(t('sysInit') || 'System Initialized. Scanning area...');
    
    // تشغيل الدوريات (كل إسعاف فاضي بيختار نقطة جديدة كل 4 ثواني لو مش بيتحرك)
    setInterval(patrolIdleAmbulances, 4000);
    
    // ضخ سيارات مدنية جديدة بشكل مستمر
    setInterval(spawnCivilianCar, 3000);
    // سيارتين في البداية فوراً
    spawnCivilianCar(); 
    setTimeout(spawnCivilianCar, 1500);
});

// ==========================================
// 3. محاكي بروتوكول البيانات (How it Works) 
// ==========================================
let wfLoop;

function resetAndStartWorkflowAnimation() {
    clearInterval(wfLoop);
    const cards = document.querySelectorAll('.wf-card');
    const pulse = document.getElementById('wfPulse');
    const motion = document.getElementById('wfMotion');
    const log = document.getElementById('wfLog');

    cards.forEach(c => {
        // ضفنا bg-red-50 للوضع الفاتح
        c.classList.remove('active', 'border-primary/40', 'bg-red-50', 'dark:bg-gray-800/60');
        const loader = c.querySelector('.wf-loader');
        if(loader) loader.style.width = '0%';
        const bits = c.querySelectorAll('.wf-bit');
        bits.forEach(b => b.style.width = '0%');
    });
    if(pulse) pulse.classList.add('opacity-0');

    let step = 0;

    async function nextStep() {
        if (step >= 4) {
            if(log) log.innerText = t('wfComplete') || "PROTOCOL COMPLETE. RESTARTING...";
            setTimeout(resetAndStartWorkflowAnimation, 3000);
            return;
        }
        
        const card = document.getElementById(`step-${step}`);
        if(!card) return;
        
        // تفعيل الكارت الحالي
        card.classList.add('active', 'border-primary/40', 'bg-red-50', 'dark:bg-gray-800/60');
        
        if (step === 0 && log) {
            log.innerText = t('wfImpact') || "IMPACT DETECTED. CAPTURING TELEMETRY...";
            card.querySelector('.wf-loader').style.width = '100%';
        } else if (step === 1 && log) {
            log.innerText = t('wfUplink') || "UPLINK ESTABLISHED. VERIFYING SIGNAL...";
            let timeLeft = 10;
            const counter = card.querySelector('.wf-counter');
            const bits = card.querySelectorAll('.wf-bit');
            const cd = setInterval(() => {
                timeLeft -= 0.5;
                if(counter) counter.innerText = timeLeft.toFixed(2) + 's';
                if(timeLeft <= 8 && bits[0]) bits[0].style.width = '100%';
                if(timeLeft <= 6 && bits[1]) bits[1].style.width = '100%';
                if(timeLeft <= 4 && bits[2]) bits[2].style.width = '100%';
                if(timeLeft <= 2 && bits[3]) bits[3].style.width = '100%';
                if(timeLeft <= 0) { if(bits[4]) bits[4].style.width = '100%'; clearInterval(cd); }
            }, 100);
        } else if (step === 2 && log) {
            log.innerText = t('wfAnalysing') || "ANALYSING GPS MATRIX. DISPATCHING UNIT...";
        } else if (step === 3 && log) {
            log.innerText = t('wfHospital') || "HOSPITAL HANDSHAKE SUCCESSFUL. PREPARING ER.";
        }

        if (step < 3 && pulse && motion) {
            const path = document.getElementById(`path-${step}-${step+1}`);
            pulse.classList.remove('opacity-0');
            motion.setAttribute('path', path.getAttribute('d'));
            motion.beginElement();
        } else if (pulse) {
            pulse.classList.add('opacity-0');
        }

        step++;
        setTimeout(nextStep, step === 2 ? 3000 : 2500);
    }

    nextStep();
}