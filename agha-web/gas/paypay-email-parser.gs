/**
 * PAVE - PayPayメール自動解析スクリプト
 * Google Apps Script (GAS) 用
 *
 * 【セットアップ手順】
 * 1. Google Apps Script (https://script.google.com) を開く
 * 2. 新規プロジェクトを作成し、このコードを全て貼り付け
 * 3. PAVE_WEBHOOK_URL に、VercelにデプロイしたPAVEのURLを入力
 *    (例: 'https://pave-app.vercel.app/api/webhook/payment')
 * 4. 「トリガー」から checkPayPayEmails を「時間主導型 > 10分おき」で設定
 * 5. 初回実行時のみ、Gmailアクセス許可を承認する
 */

// ============================================
// 設定: ここだけ書き換えてください
// ============================================
const PAVE_WEBHOOK_URL = 'https://your-pave-app.vercel.app/api/webhook/payment';
const PAYPAY_SENDER = 'no-reply@paypay.ne.jp'; // PayPayの送信元アドレス

// ============================================
// メイン関数: GASのトリガーで定期実行される
// ============================================
function checkPayPayEmails() {
  // 未読のPayPayメールを検索
  const query = `from:${PAYPAY_SENDER} is:unread subject:支払い`;
  const threads = GmailApp.search(query, 0, 20);

  if (threads.length === 0) {
    console.log('[PAVE] 新しいPayPay決済メールはありません。');
    return;
  }

  console.log(`[PAVE] ${threads.length}件のPayPayメールを検出しました。`);

  threads.forEach(thread => {
    const message = thread.getMessages()[0];
    const body = message.getPlainBody();
    const subject = message.getSubject();

    // メール本文から金額と店名をパース
    const parsed = parsePayPayEmail(body, subject);

    if (parsed) {
      console.log('[PAVE] 解析成功:', JSON.stringify(parsed));
      sendToWebhook(parsed);
      message.markRead(); // 処理済みとして既読にする
    } else {
      console.warn('[PAVE] 解析失敗 - 対象外のメール形式:', subject);
    }
  });
}

// ============================================
// PayPayメール本文の解析ロジック
// ============================================
function parsePayPayEmail(body, subject) {
  try {
    // 金額を抽出 (例: "¥1,200" or "1,200円")
    const amountMatch = body.match(/[¥￥]([0-9,]+)|([0-9,]+)\s*円/);
    const amount = amountMatch
      ? parseInt((amountMatch[1] || amountMatch[2]).replace(/,/g, ''), 10)
      : null;

    // 店名を抽出 (例: "〇〇カフェ" の前後のパターン)
    const storeMatch = body.match(/加盟店名?\s*[：:]\s*(.+)/);
    const storeName = storeMatch ? storeMatch[1].trim() : '不明な店舗';

    // 日付を抽出
    const dateMatch = body.match(/(\d{4})[年\/\-](\d{1,2})[月\/\-](\d{1,2})/);
    const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}` : new Date().toISOString().split('T')[0];

    if (!amount) return null;

    return {
      source: 'paypay_email',
      amount,
      storeName,
      date,
      rawSubject: subject
    };
  } catch (e) {
    console.error('[PAVE] パースエラー:', e);
    return null;
  }
}

// ============================================
// PAVEバックエンド（Vercel）へデータを送信
// ============================================
function sendToWebhook(payload) {
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(PAVE_WEBHOOK_URL, options);
    const code = response.getResponseCode();

    if (code === 200) {
      console.log('[PAVE] Webhook送信成功:', payload.storeName, `¥${payload.amount}`);
    } else {
      console.error('[PAVE] Webhook送信失敗 - Status:', code, response.getContentText());
    }
  } catch (e) {
    console.error('[PAVE] Webhook送信エラー:', e);
  }
}
