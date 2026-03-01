/**
 * PAVE: PayPay Email Sync Script (GAS)
 * 
 * Gmail内のPayPay決済完了メールを監視し、
 * PAVEのAPIエンドポイント（外部同期エンドポイント）へデータを送信します。
 */

// --- 設定エリア ---
const PAVE_ENDPOINT = "https://your-pave-app.vercel.app"; // PAVEのデプロイURLに変更してください
const SYNC_INTERVAL_MINUTES = 10; // チェック間隔（分）

function syncPayPayEmails() {
  const query = "from:no-reply@paypay.ne.jp subject:「PayPay」でのお支払い完了のお知らせ after:" + getSearchDateOffset();
  const threads = GmailApp.search(query);
  
  if (threads.length === 0) {
    Logger.log("新着のPayPayメールはありません。");
    return;
  }

  threads.forEach(thread => {
    const messages = thread.getMessages();
    messages.forEach(msg => {
      if (msg.isUnread()) {
        const body = msg.getPlainBody();
        const data = parsePayPayEmail(body);
        
        if (data) {
          sendToPave(data);
          msg.markRead(); // 処理済みとして既読にする
        }
      }
    });
  });
}

function parsePayPayEmail(body) {
  // 正規表現で金額と店名を抽出
  const amountMatch = body.match(/支払い金額[：:\s]*([\d,]+)円/);
  const storeMatch = body.match(/支払い先[：:\s]*(.+)/);
  const dateMatch = body.match(/支払い日時[：:\s]*(\d{4}\/\d{2}\/\d{2})/);

  if (amountMatch && storeMatch) {
    const amount = parseInt(amountMatch[1].replace(/,/g, ""), 10);
    const storeName = storeMatch[1].trim();
    const date = dateMatch ? dateMatch[1].replace(/\//g, "-") : null;

    return {
      storeName: storeName,
      amount: amount,
      date: date,
      source: "gas_paypay"
    };
  }
  return null;
}

function sendToPave(data) {
  // 注意: PAVEは現状フロントエンドの window.paveExternalSync で受け取る仕組みですが、
  // GASからのサーバー間通信を受け取るには Vercel の /api/webhook/payment 側への送信が必要です。
  const url = PAVE_ENDPOINT + "/api/webhook/payment";
  
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(data),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    Logger.log("PAVEへ送信完了: " + data.storeName + " (Status: " + response.getResponseCode() + ")");
  } catch (e) {
    Logger.log("エラー: " + e.message);
  }
}

function getSearchDateOffset() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - (SYNC_INTERVAL_MINUTES + 5)); // 少し余裕を持って過去分を検索
  return Math.floor(d.getTime() / 1000);
}
