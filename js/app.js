// ==========================================
// PAVE - Pocket AI Value Engine
// app.js - Main application logic
// ==========================================

// --- Service Worker Registration ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then(r => console.log('[PAVE] SW registered:', r.scope))
            .catch(e => console.warn('[PAVE] SW failed:', e));
    });
}

// ==========================================
// In-Browser Store Analysis Cache
// (mirrors the backend cache for offline-first operation)
// ==========================================
const PAVE_STORE_CACHE_KEY = 'pave_store_cache';

function getStoreCache() {
    try { return JSON.parse(localStorage.getItem(PAVE_STORE_CACHE_KEY)) || {}; }
    catch { return {}; }
}

function saveStoreCache(cache) {
    localStorage.setItem(PAVE_STORE_CACHE_KEY, JSON.stringify(cache));
}

// Pre-seeded patterns (same as backend)
const CACHE_SEED = [
    {
        keys: ['コンビニ', 'セブン', 'ファミマ', 'ローソン', 'ミニストップ'],
        result: { emoji: '🏪', category: '食費', emotion: '手軽な日常補充。スムーズな生活リズム。', normalizedName: 'コンビニ' }
    },
    {
        keys: ['スタバ', 'スターバックス', 'カフェ', 'コーヒー', 'ドトール'],
        result: { emoji: '☕️', category: '食費', emotion: '心地よい空間での時間投資。創造性を育む環境。', normalizedName: 'カフェ' }
    },
    {
        keys: ['apple', 'アップル', 'app store', 'itunes'],
        result: { emoji: '🪐', category: '自己投資', emotion: '2ハウス天王星的なテクノロジー投資。未来の可能性を広げるブレイクスルー！', normalizedName: 'Apple' }
    },
    {
        keys: ['amazon', 'アマゾン'],
        result: { emoji: '📦', category: 'その他', emotion: '効率的な現代のインフラ活用。8ハウス木星的な蓄積への投資。', normalizedName: 'Amazon' }
    },
    {
        keys: ['電車', '鉄道', 'suica', 'pasmo', 'jr', 'バス'],
        result: { emoji: '🚃', category: '交通費', emotion: '移動は人生の流れ。新たな出会いへの投資。', normalizedName: '交通費' }
    },
    {
        keys: ['本', '書店', '書籍', 'kindle', '技術書'],
        result: { emoji: '📚', category: '自己投資', emotion: '知識への投資は永遠のリターンをもたらす。未来への種まき。', normalizedName: '書籍' }
    },
    {
        keys: ['gym', 'ジム', 'スポーツ', 'フィットネス'],
        result: { emoji: '💪', category: '自己投資', emotion: '体は最大の資本。健康への長期投資。', normalizedName: 'フィットネス' }
    },
];

function initStoreCache() {
    const cache = getStoreCache();
    if (Object.keys(cache).length === 0) {
        CACHE_SEED.forEach(({ keys, result }) => {
            keys.forEach(k => { cache[k.toLowerCase()] = { ...result, usageCount: 0, lastUsed: null }; });
        });
        saveStoreCache(cache);
    }
    return cache;
}

function normalizeName(name) {
    return name.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.,！？!?。、]/g, '');
}

function lookupStoreCache(rawName) {
    const cache = getStoreCache();
    const key = normalizeName(rawName);

    // Exact match
    if (cache[key]) {
        cache[key].usageCount = (cache[key].usageCount || 0) + 1;
        cache[key].lastUsed = new Date().toISOString();
        saveStoreCache(cache);
        return { ...cache[key], fromCache: true };
    }

    // Partial match
    for (const [cacheKey, val] of Object.entries(cache)) {
        if (key.includes(cacheKey) || cacheKey.includes(key)) {
            val.usageCount = (val.usageCount || 0) + 1;
            val.lastUsed = new Date().toISOString();
            cache[cacheKey] = val;
            saveStoreCache(cache);
            return { ...val, fromCache: true };
        }
    }
    return null;
}

function saveToStoreCache(rawName, result) {
    const cache = getStoreCache();
    cache[normalizeName(rawName)] = { ...result, usageCount: 1, lastUsed: new Date().toISOString() };
    saveStoreCache(cache);
}

// ==========================================
// Mock Gemini Analysis (browser-side)
// In production this would call /api/webhook/payment
// which then calls the real Gemini API
// ==========================================
async function mockGeminiAnalyze(storeName, amount) {
    // Simulate network delay (100-500ms)
    await new Promise(r => setTimeout(r, 150 + Math.random() * 350));

    const n = storeName.toLowerCase();
    if (n.includes('食') || n.includes('ランチ') || n.includes('レストラン') || n.includes('スーパー')) {
        return { emoji: '🍜', category: '食費', emotion: '活力の源泉。身体という神殿への投資。', normalizedName: storeName };
    }
    if (n.includes('投資') || n.includes('セミナー') || n.includes('学習') || n.includes('勉強')) {
        return { emoji: '📈', category: '自己投資', emotion: '知識は最強の複利。未来への種まき。', normalizedName: storeName };
    }
    if (n.includes('薬') || n.includes('クリニック') || n.includes('病院') || n.includes('医')) {
        return { emoji: '💊', category: '医療', emotion: '健康は最大の資産。先行投資。', normalizedName: storeName };
    }
    if (n.includes('映画') || n.includes('ゲーム') || n.includes('娯楽') || n.includes('カラオケ')) {
        return { emoji: '🎮', category: '娯楽', emotion: '休息と充電。持続可能なエネルギー管理。', normalizedName: storeName };
    }
    return { emoji: '✨', category: 'その他', emotion: '日々の生活を豊かにする堅実な選択。', normalizedName: storeName };
}

// ==========================================
// Sync Status Bar
// ==========================================
const syncStats = { hits: 0, misses: 0, total: 0, lastSyncAt: null };

function setSyncStatus(state, message, showCacheBadge = false) {
    const bar = document.getElementById('sync-status-bar');
    const dot = document.getElementById('sync-dot');
    const text = document.getElementById('sync-status-text');
    const badge = document.getElementById('sync-cache-badge');
    if (!bar || !dot || !text) return;

    bar.className = `sync-status-bar ${state}`;
    dot.className = `sync-dot ${state}`;
    text.textContent = message;

    if (badge) {
        if (showCacheBadge && syncStats.total > 0) {
            const rate = Math.round((syncStats.hits / syncStats.total) * 100);
            badge.textContent = `⚡ キャッシュ率 ${rate}%`;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }
}

function formatSyncTime(isoStr) {
    if (!isoStr) return '未同期';
    const d = new Date(isoStr);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')} 同期済`;
}

// ==========================================
// Core: Process a payment through the pipeline
// ==========================================
async function processPayment({ storeName, amount, dateStr, source = 'manual' }) {
    setSyncStatus('syncing', `解析中: ${storeName}...`);

    let analysis;
    let fromCache = false;

    // 1. Check store cache first
    const cached = lookupStoreCache(storeName);

    if (cached) {
        // Cache HIT - no AI call needed
        analysis = cached;
        fromCache = true;
        syncStats.hits++;
        console.log(`[PAVE Cache] HIT: ${storeName} → ${cached.category}`);
    } else {
        // Cache MISS - call Gemini
        syncStats.misses++;
        console.log(`[PAVE Gemini] Analyzing: ${storeName}`);
        analysis = await mockGeminiAnalyze(storeName, amount);
        saveToStoreCache(storeName, analysis);
        console.log(`[PAVE Cache] Saved: ${storeName} → ${analysis.category}`);
    }

    syncStats.total++;
    syncStats.lastSyncAt = new Date().toISOString();

    // 2. Save entry
    const entry = {
        emoji: analysis.emoji,
        name: analysis.normalizedName || storeName,
        rawName: storeName,
        amount,
        category: analysis.category,
        emotion: analysis.emotion,
        source,
        cachedAnalysis: fromCache,
    };

    addEntry(dateStr, entry);

    // 3. Update UI
    updateSummaryUI();
    refreshChart();
    renderCalendar();
    renderDayDetails(dateStr);

    // 4. Update sync bar
    const cacheRate = syncStats.total > 0 ? Math.round((syncStats.hits / syncStats.total) * 100) : 0;
    const statusMsg = fromCache
        ? `⚡ ${formatSyncTime(syncStats.lastSyncAt)} — キャッシュ利用`
        : `✓ ${formatSyncTime(syncStats.lastSyncAt)} — Gemini解析`;

    setSyncStatus(fromCache ? 'cached' : 'success', statusMsg, true);

    return { entry, fromCache };
}

// ==========================================
// Payment Method Detection & Icons
// ==========================================
const PAYMENT_METHODS = {
    paypay: { label: 'PayPay', icon: '🔴', color: '#f43f5e', keywords: ['paypay', 'ペイペイ', 'paypay支払'] },
    rakuten: { label: '楽天Pay', icon: '🏅', color: '#ef4444', keywords: ['楽天pay', 'rakuten pay', '楽天ペイ'] },
    aupay: { label: 'au PAY', icon: '🟠', color: '#f97316', keywords: ['au pay', 'aupay', 'auペイ'] },
    suica: { label: 'Suica / PASMO', icon: '🟢', color: '#10b981', keywords: ['suica', 'pasmo', 'スイカ', 'パスモ'] },
    linepay: { label: 'LINE Pay', icon: '💚', color: '#16a34a', keywords: ['line pay', 'ラインペイ'] },
    merpay: { label: 'メルペイ', icon: '🔵', color: '#3b82f6', keywords: ['メルペイ', 'merpay'] },
    credit: { label: 'クレジットカード', icon: '💳', color: '#6366f1', keywords: ['visa', 'mastercard', 'jcb', 'amex', 'クレジット', 'カード番号'] },
    cash: { label: '現金', icon: '💴', color: '#78716c', keywords: ['レシート', 'receipt', '領収', 'お買い上げ'] },
};

// Determine payment method from text
function detectPaymentMethod(text) {
    const lower = text.toLowerCase();
    for (const [key, method] of Object.entries(PAYMENT_METHODS)) {
        if (method.keywords.some(kw => lower.includes(kw))) {
            return { key, ...method };
        }
    }
    return { key: 'unknown', label: '不明', icon: '❓', color: '#94a3b8', keywords: [] };
}

// Mock Gemini Vision: analyze an image file
// In production: send image as base64 to Gemini Vision API
async function geminiVisionAnalyze(file) {
    // Read image as base64 (for actual Gemini Vision call)
    const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result.split(',')[1]); // strip data:image/... prefix
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });

    /* ===== Real Gemini Vision Call (uncomment when GEMINI_API_KEY is set) =====
    const response = await fetch('/api/webhook/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType: file.type })
    });
    return await response.json();
    ===================================================================== */

    // Simulate processing delay (1.5 – 2.5s)
    await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));

    // Simulate varying results based on file name hints
    const fn = file.name.toLowerCase();
    const scenarios = [
        { storeName: 'スターバックスコーヒー', amount: 650, paymentKey: 'paypay', confidence: '高 (94%)' },
        { storeName: '楽天市場', amount: 3280, paymentKey: 'rakuten', confidence: '高 (91%)' },
        { storeName: 'Apple Store', amount: 1500, paymentKey: 'credit', confidence: '高 (97%)' },
        { storeName: 'セブン-イレブン', amount: 428, paymentKey: 'suica', confidence: '中 (78%)' },
        { storeName: 'Netflix', amount: 1590, paymentKey: 'credit', confidence: '高 (99%)' },
    ];

    // Pick based on file size hash for reproducible demo
    const pick = scenarios[Math.floor(file.size % scenarios.length)];
    const paymentInfo = PAYMENT_METHODS[pick.paymentKey] || PAYMENT_METHODS.cash;
    const storeAnalysis = await mockGeminiAnalyze(pick.storeName, pick.amount);

    return {
        storeName: pick.storeName,
        amount: pick.amount,
        payment: { key: pick.paymentKey, ...paymentInfo },
        confidence: pick.confidence,
        category: storeAnalysis.category,
        emoji: storeAnalysis.emoji,
        emotion: storeAnalysis.emotion,
    };
}

// Global state for pending result
let _pendingVisionResult = null;

// Show preview zone with scanning animation
function showPreviewWithScan(file) {
    const previewZone = document.getElementById('capture-preview-zone');
    const previewImg = document.getElementById('capture-preview-img');
    const previewOverlay = document.getElementById('capture-preview-overlay');
    const resultCard = document.getElementById('capture-result-card');
    const cameraBtn = document.getElementById('btn-camera');

    if (!previewZone || !previewImg) return;

    resultCard.style.display = 'none';
    previewOverlay.classList.remove('done');
    previewZone.style.display = 'block';
    cameraBtn.style.display = 'none';

    // Show image
    const objectURL = URL.createObjectURL(file);
    previewImg.src = objectURL;
    previewImg.onload = () => URL.revokeObjectURL(objectURL);

    setSyncStatus('syncing', '◈ Gemini Vision 解析中...');
}

// Populate and show result card
function showResultCard(result) {
    const previewOverlay = document.getElementById('capture-preview-overlay');
    const resultCard = document.getElementById('capture-result-card');

    // Hide scan overlay
    previewOverlay.classList.add('done');
    resultCard.style.display = 'block';

    // Fill in fields
    document.getElementById('result-payment-icon').textContent = result.payment.icon;
    document.getElementById('result-payment-label').textContent = result.payment.label;
    document.getElementById('result-confidence').textContent = `信頼度: ${result.confidence}`;
    document.getElementById('result-store-name').textContent = result.storeName;
    document.getElementById('result-amount').textContent = `¥ ${result.amount.toLocaleString()}`;
    document.getElementById('result-category').textContent = result.category;
    document.getElementById('result-emotion').textContent = result.emotion;

    const syncMsg = `✓ 解析完了 — ${result.payment.label} / ${result.storeName}`;
    setSyncStatus('success', syncMsg, false);
}

// Reset capture UI
function resetCaptureUI() {
    document.getElementById('capture-preview-zone').style.display = 'none';
    document.getElementById('capture-result-card').style.display = 'none';
    document.getElementById('btn-camera').style.display = '';
    document.getElementById('receipt-file-input').value = '';
    _pendingVisionResult = null;
    setSyncStatus('', '未同期 — データ受信を待機中');
}


// ==========================================
const STORAGE_KEY = 'pave_entries';

function getEntries() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch { return {}; }
}

function saveEntries(entries) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function addEntry(dateStr, entry) {
    const entries = getEntries();
    if (!entries[dateStr]) entries[dateStr] = [];
    entries[dateStr].unshift({ ...entry, id: Date.now() });
    saveEntries(entries);
    return entries;
}

// Seed mock data if empty
(function seedMockData() {
    const entries = getEntries();
    if (Object.keys(entries).length > 0) return;
    const today = new Date();
    const yr = today.getFullYear();
    const mo = String(today.getMonth() + 1).padStart(2, '0');
    const mock = {
        [`${yr}-${mo}-01`]: [{ emoji: '✨', name: 'コンビニ', emotion: '気軽な補充。', amount: 900, id: 1 }],
        [`${yr}-${mo}-02`]: [
            { emoji: '☕️', name: 'カフェでの作業', emotion: '心地よい集中。自己投資。', amount: 650, id: 2 },
            { emoji: '📚', name: '技術書の購入', emotion: '未来への種まき。', amount: 3200, id: 3 }
        ],
        [`${yr}-${mo}-03`]: [{ emoji: '💸', name: 'ランチ', emotion: '栄養補給。', amount: 1200, id: 4 }],
    };
    saveEntries(mock);
})();

// Calculate totals from entries
function calcMonthTotal(yr, mo) {
    const entries = getEntries();
    const prefix = `${yr}-${String(mo).padStart(2, '0')}`;
    let total = 0;
    Object.entries(entries).forEach(([k, v]) => {
        if (k.startsWith(prefix)) v.forEach(e => total += e.amount);
    });
    return total;
}

// ==========================================
// Calendar Engine
// ==========================================
let calYear, calMonth, calSelectedDate;

function initCalendar() {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth(); // 0-indexed
    calSelectedDate = null;
    renderCalendar();
}

function renderCalendar() {
    const entries = getEntries();
    const grid = document.getElementById('calendar-grid');
    const label = document.getElementById('cal-month-label');
    if (!grid || !label) return;

    const yr = calYear;
    const mo = calMonth;

    label.textContent = `${yr}年 ${mo + 1}月`;

    // Day headers
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    let html = days.map(d => `<div class="calendar-day-header">${d}</div>`).join('');

    // First day of month and total days
    const firstDay = new Date(yr, mo, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(yr, mo + 1, 0).getDate();
    const prevMonthDays = new Date(yr, mo, 0).getDate();

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // Previous month tail
    for (let i = firstDay - 1; i >= 0; i--) {
        html += `<div class="calendar-day other-month"><span class="day-num">${prevMonthDays - i}</span></div>`;
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${yr}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dayEntries = entries[dateStr] || [];
        const total = dayEntries.reduce((s, e) => s + e.amount, 0);
        const isToday = dateStr === todayStr;
        const isSelected = dateStr === calSelectedDate;
        const hasData = dayEntries.length > 0;

        let cls = 'calendar-day';
        if (isToday) cls += ' today';
        if (isSelected) cls += ' selected';
        if (hasData) cls += ' has-data';

        const expense = hasData ? `<span class="day-expense">¥${total.toLocaleString()}</span>` : '';
        // Show payment method icon if available on any entry
        const paymentEntry = dayEntries.find(e => e.paymentIcon);
        const paymentTag = paymentEntry
            ? `<span class="day-payment-icon" title="${paymentEntry.paymentLabel || ''}">${paymentEntry.paymentIcon}</span>`
            : '';
        html += `<div class="${cls}" data-date="${dateStr}">
            <span class="day-num">${d}</span>${expense}${paymentTag}
        </div>`;
    }


    // Next month fill
    const total = firstDay + daysInMonth;
    const remaining = total % 7 === 0 ? 0 : 7 - (total % 7);
    for (let i = 1; i <= remaining; i++) {
        html += `<div class="calendar-day other-month"><span class="day-num">${i}</span></div>`;
    }

    grid.innerHTML = html;

    // Attach day click handlers
    grid.querySelectorAll('.calendar-day:not(.other-month)').forEach(el => {
        el.addEventListener('click', () => {
            calSelectedDate = el.getAttribute('data-date');
            renderCalendar(); // re-render to show selection
            renderDayDetails(calSelectedDate);
        });
    });

    // Auto-show today's details on init
    if (!calSelectedDate) {
        renderDayDetails(todayStr);
        calSelectedDate = todayStr;
    }
}

function renderDayDetails(dateStr) {
    const titleEl = document.getElementById('day-details-title');
    const listEl = document.getElementById('day-details-list');
    if (!titleEl || !listEl) return;

    const parts = dateStr.split('-');
    titleEl.textContent = `${parseInt(parts[1])}月${parseInt(parts[2])}日の記録`;

    const entries = getEntries();
    const dayEntries = entries[dateStr] || [];

    if (dayEntries.length === 0) {
        listEl.innerHTML = `<p style="color:var(--text-secondary);font-size:13px;text-align:center;padding:16px 0;">記録なし</p>`;
        return;
    }

    listEl.innerHTML = dayEntries.map(e => `
        <div class="log-item">
            <div class="log-info">
                <div class="log-emoji">${e.emoji || '💸'}</div>
                <div class="log-text">
                    <h4>${e.name}</h4>
                    <p>${e.emotion || ''}</p>
                </div>
            </div>
            <div class="log-amount">¥ ${e.amount.toLocaleString()}</div>
        </div>
    `).join('');
}

// ==========================================
// Summary / Chart
// ==========================================
let expenseChartInstance = null;

function calcCategoryTotals() {
    const entries = getEntries();
    const now = new Date();
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const cats = { '食費': 0, '自己投資': 0, '交通費': 0, 'その他': 0 };
    Object.entries(entries).forEach(([k, v]) => {
        if (!k.startsWith(prefix)) return;
        v.forEach(e => {
            if (e.name.includes('カフェ') || e.name.includes('ランチ') || e.name.includes('コンビニ')) cats['食費'] += e.amount;
            else if (e.name.includes('技術') || e.name.includes('Apple') || e.name.includes('書')) cats['自己投資'] += e.amount;
            else if (e.name.includes('交通') || e.name.includes('電車')) cats['交通費'] += e.amount;
            else cats['その他'] += e.amount;
        });
    });
    return cats;
}

function updateSummaryUI() {
    const now = new Date();
    const total = calcMonthTotal(now.getFullYear(), now.getMonth() + 1);
    const el = document.getElementById('total-expense');
    if (el) el.textContent = `¥ ${total.toLocaleString()}`;
}

function initChart() {
    const ctx = document.getElementById('expenseChart');
    if (!ctx || typeof Chart === 'undefined') { setTimeout(initChart, 100); return; }

    const cats = calcCategoryTotals();

    expenseChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(cats),
            datasets: [{
                data: Object.values(cats),
                backgroundColor: [
                    'rgba(99,102,241,0.8)',
                    'rgba(236,72,153,0.8)',
                    'rgba(16,185,129,0.8)',
                    'rgba(148,163,184,0.5)'
                ],
                borderWidth: 0,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '74%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#94a3b8',
                        font: { family: "'Inter', sans-serif", size: 11 },
                        padding: 16,
                        usePointStyle: true, pointStyle: 'circle'
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(5,6,15,0.95)',
                    padding: 12, cornerRadius: 10,
                    callbacks: {
                        label: ctx => ` ¥${ctx.parsed.toLocaleString()}`
                    }
                }
            },
            animation: { animateScale: true, animateRotate: true, duration: 1200, easing: 'easeOutQuart' }
        }
    });
}

function refreshChart() {
    if (!expenseChartInstance) return;
    const cats = calcCategoryTotals();
    expenseChartInstance.data.datasets[0].data = Object.values(cats);
    expenseChartInstance.update();
}

// ==========================================
// Boot
// ==========================================
document.addEventListener('DOMContentLoaded', () => {

    // --- Hide Splash Screen ---
    const splash = document.getElementById('splash-screen');
    if (splash) {
        // Wait at least 1.5s for the brand experience, then fade out
        setTimeout(() => {
            splash.classList.add('fade-out');
            // Remove from DOM after transition
            setTimeout(() => splash.remove(), 800);
        }, 1500);
    }

    // --- Tab Switching ---
    const navItems = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            const targetId = item.getAttribute('data-target');
            tabContents.forEach(tab => {
                tab.classList.toggle('active', tab.id === targetId);
            });
        });
    });

    // --- Sub Tab (Summary ↔ Calendar) ---
    const subTabs = document.querySelectorAll('.sub-tab');
    const subTabBg = document.querySelector('.sub-tab-bg');
    const dashViews = document.querySelectorAll('.dashboard-view');

    subTabs.forEach((tab, idx) => {
        tab.addEventListener('click', () => {
            subTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const targetId = tab.getAttribute('data-view');
            dashViews.forEach(v => v.classList.toggle('active', v.id === targetId));
            if (subTabBg) {
                subTabBg.style.transform = idx === 0 ? 'translateX(0)' : 'translateX(calc(100% + 8px))';
            }
        });
    });

    // --- Calendar Nav Buttons ---
    document.getElementById('cal-prev')?.addEventListener('click', () => {
        calMonth--;
        if (calMonth < 0) { calMonth = 11; calYear--; }
        calSelectedDate = null;
        renderCalendar();
        renderDayDetails(`${calYear}-${String(calMonth + 1).padStart(2, '0')}-01`);
    });

    document.getElementById('cal-next')?.addEventListener('click', () => {
        calMonth++;
        if (calMonth > 11) { calMonth = 0; calYear++; }
        calSelectedDate = null;
        renderCalendar();
    });

    // --- Camera button → open file picker (real camera on mobile) ---
    const btnCamera = document.getElementById('btn-camera');
    const fileInput = document.getElementById('receipt-file-input');

    btnCamera?.addEventListener('click', () => fileInput?.click());

    // File selected → full Gemini Vision pipeline
    fileInput?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        showPreviewWithScan(file);
        const result = await geminiVisionAnalyze(file);
        _pendingVisionResult = result;
        showResultCard(result);
    });

    // Retake button
    document.getElementById('btn-result-retake')?.addEventListener('click', resetCaptureUI);

    // Save to Calendar button
    document.getElementById('btn-result-save')?.addEventListener('click', async () => {
        if (!_pendingVisionResult) return;
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        await processPayment({
            storeName: _pendingVisionResult.storeName,
            amount: _pendingVisionResult.amount,
            dateStr,
            source: `camera_${_pendingVisionResult.payment.key}`,
        });
        // Persist payment icon on the saved entry
        const entries = getEntries();
        const dayEntries = entries[dateStr] || [];
        if (dayEntries.length > 0) {
            dayEntries[0].paymentKey = _pendingVisionResult.payment.key;
            dayEntries[0].paymentIcon = _pendingVisionResult.payment.icon;
            dayEntries[0].paymentLabel = _pendingVisionResult.payment.label;
            saveEntries(entries);
        }
        calSelectedDate = dateStr;
        resetCaptureUI();
        renderCalendar();
        renderDayDetails(dateStr);
        document.querySelector('.nav-item[data-target="tab-dashboard"]')?.click();
        document.querySelector('.sub-tab[data-view="view-calendar"]')?.click();
    });

    // --- Text Submit Button ---
    const btnSubmitText = document.getElementById('btn-submit-text');
    const captureText = document.getElementById('capture-text');

    if (btnSubmitText && captureText) {
        btnSubmitText.addEventListener('click', async () => {
            const text = captureText.value.trim();
            if (!text) return;

            const paymentDetected = detectPaymentMethod(text);
            const amountMatch = text.match(/[¥￥]?([\d,]+)/);
            const amount = amountMatch ? parseInt(amountMatch[1].replace(/,/g, ''), 10) : 500;
            const storeName = text.replace(/[¥￥][\d,]+/g, '')
                .replace(/paypay|楽天pay|au pay/gi, '')
                .trim() || 'メモ';
            const today = new Date();
            const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

            captureText.value = '';
            await processPayment({ storeName, amount, dateStr, source: 'text' });

            if (paymentDetected.key !== 'unknown') {
                const entries = getEntries();
                const dayEntries = entries[dateStr] || [];
                if (dayEntries.length > 0) {
                    dayEntries[0].paymentKey = paymentDetected.key;
                    dayEntries[0].paymentIcon = paymentDetected.icon;
                    dayEntries[0].paymentLabel = paymentDetected.label;
                    saveEntries(entries);
                }
            }

            renderCalendar();
            renderDayDetails(dateStr);
            document.querySelector('.nav-item[data-target="tab-dashboard"]')?.click();
            document.querySelector('.sub-tab[data-view="view-calendar"]')?.click();
        });
    }


    // --- Developer Webhook Simulation ---
    const devToggle = document.getElementById('dev-menu-toggle');
    const devPanel = document.getElementById('dev-menu');
    const devWebhook = document.getElementById('btn-simulate-webhook');

    devToggle?.addEventListener('click', () => {
        devPanel.style.display = devPanel.style.display === 'none' ? 'block' : 'none';
    });

    devWebhook?.addEventListener('click', async () => {
        devPanel.style.display = 'none';

        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-12`;

        // Run through the AI pipeline (will hit cache for Apple Store)
        const { entry, fromCache } = await processPayment({
            storeName: 'Apple Store',
            amount: 3500,
            dateStr,
            source: 'webhook_sim'
        });

        const mode = fromCache ? '⚡ キャッシュ参照（API呼出なし）' : '🧠 Gemini AI解析';
        alert(`【バックグラウンド同期シミュレーション】\n\n` +
            `PayPay Webhook経由で取り込み完了！\n` +
            `店名: ${entry.name}\n` +
            `金額: ¥${entry.amount.toLocaleString()}\n` +
            `カテゴリ: ${entry.category}\n` +
            `処理モード: ${mode}\n\n` +
            `💬 ${entry.emotion}`);
    });

    // --- External Data Sync Endpoint (Automatic Integration) ---
    // Usage: window.paveExternalSync({ storeName: "ストア", amount: 1200, date: "2026-03-12" })
    window.paveExternalSync = async (data) => {
        if (!data || !data.storeName || !data.amount) {
            console.error('[PAVE Sync] Invalid data format');
            return;
        }

        const today = new Date();
        const dateStr = data.date || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        console.log('[PAVE Sync] External data received:', data);

        const { entry, fromCache } = await processPayment({
            storeName: data.storeName,
            amount: parseInt(data.amount, 10),
            dateStr,
            source: 'external_sync'
        });

        // Trigger UI update if we are on the calendar
        if (calSelectedDate === dateStr) {
            renderDayDetails(dateStr);
        }
        renderCalendar();

        return { success: true, entry, fromCache };
    };

    // --- Ad Banner Logic ---
    document.getElementById('pave-ad-banner')?.addEventListener('click', () => {
        alert('PAVEのおすすめ案件へ移動します（※現在はシミュレーションです）');
    });

    // --- Initialize ---
    initStoreCache();
    initCalendar();
    updateSummaryUI();
    initChart();
    setSyncStatus('', '未同期 — データ受信を待機中');
});
