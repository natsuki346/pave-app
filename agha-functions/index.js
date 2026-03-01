/**
 * PAVE - Pocket AI Value Engine
 * バックエンド Cloud Functions (Express + Gemini 1.5 Flash)
 *
 * エンドポイント一覧:
 *  POST /api/webhook/payment  - 外部決済データ受信・AI解析・DB保存
 *  GET  /api/status           - 最終同期時刻・キャッシュ統計
 *  GET  /api/entries          - 保存済みエントリ一覧取得（フロントエンド用）
 *  POST /api/entries          - 直接エントリ追加（Captureタブ用）
 */

require('dotenv').config();

const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');

// Gemini SDK (実際のデプロイ時は npm install @google/genai 後にコメントアウト解除)
// const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// =====================================================
// In-memory "DB" (本番ではFirestore/PlanetScale等に置き換え)
// =====================================================
/**
 * entries: {
 *   [dateStr: string]: Array<{
 *     id: number,
 *     emoji: string,
 *     name: string,      // 名寄せ後の店名
 *     rawName: string,   // 元の店名
 *     amount: number,
 *     category: string,
 *     emotion: string,
 *     source: string,
 *     cachedAnalysis: boolean
 *   }>
 * }
 */
const db = {
    entries: {},
    lastSyncAt: null,
    syncCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
};

// =====================================================
// Store-Level Analysis Cache
// キャッシュキー = 正規化された店名（toLowerCase + trim）
// オブジェクト: { emoji, category, emotion, normalizedName, usageCount, lastUsed }
// =====================================================
const storeCache = new Map();

// Pre-seed with common patterns (cold-start warm-up)
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

CACHE_SEED.forEach(({ keys, result }) => {
    keys.forEach(k => storeCache.set(k.toLowerCase(), { ...result, usageCount: 0, lastUsed: null }));
});

// =====================================================
// Helpers
// =====================================================

/**
 * 店名を正規化してキャッシュキーに変換
 */
function normalizeName(name) {
    return name.toLowerCase().trim()
        .replace(/\s+/g, ' ')
        .replace(/[.,！？!?。、]/g, '');
}

/**
 * キャッシュからヒットを探す（部分一致も許容）
 */
function lookupCache(rawName) {
    const key = normalizeName(rawName);

    // 完全一致
    if (storeCache.has(key)) {
        const hit = storeCache.get(key);
        hit.usageCount++;
        hit.lastUsed = new Date().toISOString();
        db.cacheHits++;
        return { ...hit, cachedAnalysis: true };
    }

    // 部分一致（キャッシュキーが店名を含む or 逆）
    for (const [cacheKey, val] of storeCache.entries()) {
        if (key.includes(cacheKey) || cacheKey.includes(key)) {
            val.usageCount++;
            val.lastUsed = new Date().toISOString();
            db.cacheHits++;
            return { ...val, cachedAnalysis: true };
        }
    }

    db.cacheMisses++;
    return null;
}

/**
 * Gemini 1.5 Flash による AI解析
 * 本番環境では @google/genai を使用。現在はモック。
 */
async function analyzeWithGemini(storeName, amount) {
    // ======== 本番コード (dotenv の GEMINI_API_KEY が必要) ========
    /*
    const { GoogleGenAI } = require('@google/genai');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const prompt = `
あなたはPAVE（家計簿AI）のアナリストです。
以下の決済を分析してJSON形式で返してください。
---
店名: ${storeName}
金額: ¥${amount}
---
レスポンス形式（JSON のみ）:
{
  "normalizedName": "代表的な店名（短く）",
  "category": "食費 | 自己投資 | 交通費 | 娯楽 | 医療 | その他 のいずれか",
  "emoji": "最適な絵文字1文字",
  "emotion": "この支出の価値を占星術の概念で20文字以内でポジティブに表現"
}
    `;

    const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: prompt,
        generationConfig: { responseMimeType: 'application/json' }
    });

    return JSON.parse(response.text);
    */
    // ======== モック (開発用) ========
    await new Promise(r => setTimeout(r, 100)); // ネットワーク遅延シミュレート

    const name = storeName.toLowerCase();
    if (name.includes('食') || name.includes('ランチ') || name.includes('レストラン') || name.includes('寿司') || name.includes('ラーメン')) {
        return { normalizedName: storeName, category: '食費', emoji: '🍜', emotion: '活力の源泉。身体という神殿への投資。' };
    }
    if (name.includes('投資') || name.includes('セミナー') || name.includes('本') || name.includes('勉強')) {
        return { normalizedName: storeName, category: '自己投資', emoji: '📈', emotion: '知識は最強の複利。未来への種まき。' };
    }
    return {
        normalizedName: storeName,
        category: 'その他',
        emoji: '✨',
        emotion: '日々の生活を豊かにする堅実な選択。'
    };
}

/**
 * 解析結果をキャッシュに保存
 */
function saveToCache(rawName, result) {
    const key = normalizeName(rawName);
    storeCache.set(key, { ...result, usageCount: 1, lastUsed: new Date().toISOString() });
}

/**
 * エントリをDBに保存
 */
function saveEntry(dateStr, entry) {
    if (!db.entries[dateStr]) db.entries[dateStr] = [];
    db.entries[dateStr].unshift(entry);
    db.lastSyncAt = new Date().toISOString();
    db.syncCount++;
}

// =====================================================
// POST /api/webhook/payment
// 外部決済データ受信・AI解析・キャッシュ参照・DB保存
// =====================================================
app.post('/api/webhook/payment', async (req, res) => {
    const startTime = Date.now();

    try {
        const { amount, storeName, date, source = 'webhook' } = req.body;

        if (!amount || !storeName) {
            return res.status(400).json({
                error: 'Missing required fields: amount, storeName'
            });
        }

        const amountNum = parseInt(String(amount).replace(/[,¥￥]/g, ''), 10);
        if (isNaN(amountNum) || amountNum <= 0) {
            return res.status(400).json({ error: 'Invalid amount value.' });
        }

        const dateStr = date || new Date().toISOString().split('T')[0];

        console.log(`[PAVE Webhook] Received: ${storeName} ¥${amountNum} from ${source}`);

        // =====================================================
        // 1. キャッシュ参照（同じ店の過去分析を再利用）
        // =====================================================
        let analysis = lookupCache(storeName);
        let processingMode = 'cache';

        if (!analysis) {
            // =====================================================
            // 2. キャッシュミス → Gemini API で新規解析
            // =====================================================
            console.log(`[PAVE Gemini] Cache miss. Calling AI for: ${storeName}`);
            const geminiResult = await analyzeWithGemini(storeName, amountNum);
            analysis = { ...geminiResult, cachedAnalysis: false };
            processingMode = 'gemini';

            // 結果をキャッシュに保存して次回はAI不要に
            saveToCache(storeName, geminiResult);
            console.log(`[PAVE Cache] Saved new pattern: ${storeName} → ${geminiResult.category}`);
        } else {
            console.log(`[PAVE Cache] HIT for: ${storeName} (saved API call)`);
        }

        // =====================================================
        // 3. DB保存
        // =====================================================
        const entry = {
            id: Date.now(),
            emoji: analysis.emoji,
            name: analysis.normalizedName || storeName,
            rawName: storeName,
            amount: amountNum,
            category: analysis.category,
            emotion: analysis.emotion,
            source,
            cachedAnalysis: analysis.cachedAnalysis,
            createdAt: new Date().toISOString(),
        };

        saveEntry(dateStr, entry);

        const elapsed = Date.now() - startTime;
        console.log(`[PAVE] Done in ${elapsed}ms (mode: ${processingMode})`);

        // =====================================================
        // 4. レスポンス
        // =====================================================
        return res.status(200).json({
            success: true,
            processingMode,
            elapsed: `${elapsed}ms`,
            data: entry,
            syncStats: {
                totalSynced: db.syncCount,
                cacheHits: db.cacheHits,
                cacheMisses: db.cacheMisses,
                cacheHitRate: db.syncCount > 0
                    ? `${Math.round((db.cacheHits / db.syncCount) * 100)}%`
                    : '0%',
            }
        });

    } catch (error) {
        console.error('[PAVE Webhook Error]', error);
        return res.status(500).json({ error: 'Internal Server Error', detail: error.message });
    }
});

// =====================================================
// GET /api/status
// ダッシュボードのステータスバー用
// =====================================================
app.get('/api/status', (req, res) => {
    res.json({
        status: 'ok',
        lastSyncAt: db.lastSyncAt,
        syncCount: db.syncCount,
        cacheSize: storeCache.size,
        cacheHits: db.cacheHits,
        cacheMisses: db.cacheMisses,
        cacheHitRate: db.syncCount > 0
            ? `${Math.round((db.cacheHits / db.syncCount) * 100)}%`
            : 'N/A',
    });
});

// =====================================================
// GET /api/entries
// フロントエンドが全エントリを取得するエンドポイント
// =====================================================
app.get('/api/entries', (req, res) => {
    const { month } = req.query; // format: YYYY-MM
    let result = db.entries;
    if (month) {
        result = Object.fromEntries(
            Object.entries(db.entries).filter(([k]) => k.startsWith(month))
        );
    }
    res.json({ success: true, entries: result, lastSyncAt: db.lastSyncAt });
});

// =====================================================
// POST /api/entries
// Captureタブからの直接登録（画像解析経由）
// =====================================================
app.post('/api/entries', async (req, res) => {
    const { amount, storeName, date, source = 'capture' } = req.body;
    if (!amount || !storeName) {
        return res.status(400).json({ error: 'Missing amount or storeName' });
    }

    // Webhookと同じパイプラインを通す
    req.body.source = source;
    return app._router.handle(
        { ...req, url: '/api/webhook/payment', method: 'POST' },
        res,
        () => { }
    );
});

// =====================================================
// Cloud Functions Export
// =====================================================
exports.api = functions.https.onRequest(app);

// ローカル開発用: node index.js で直接起動
if (require.main === module) {
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
        console.log(`[PAVE Backend] Running on http://localhost:${PORT}`);
        console.log(`  POST http://localhost:${PORT}/api/webhook/payment`);
        console.log(`  GET  http://localhost:${PORT}/api/status`);
        console.log(`  GET  http://localhost:${PORT}/api/entries`);
    });
}
