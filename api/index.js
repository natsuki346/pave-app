// PAVE Backend API
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/genai');

const app = express();
app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

app.post('/api/webhook/payment', async (req, res) => {
    try {
        const { storeName, amount } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `あなたは支出を解析するAI「PAVE」です。
以下の決済情報を解析し、JSON形式（{ emoji, category, emotion, normalizedName }）で返してください。
- 店名: ${storeName}
- 金額: ${amount}
emotionは、その支出の価値をポジティブに肯定する一言（20文字以内）にしてください。`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const jsonStr = text.match(/\{.*\}/s)?.[0] || '{}';
        res.json(JSON.parse(jsonStr));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = app;
