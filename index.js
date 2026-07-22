const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pino = require('pino');
const express = require('express');
const fs = require('fs');

// =====================================================
//  CONFIG
// =====================================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY_HERE";
const MODEL_NAME = "gemini-3.5-flash-lite"; // 500 free req/day
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// =====================================================
//  PRODUCT DATABASE
// =====================================================
let productDB = { products: [] };
try {
    productDB = JSON.parse(fs.readFileSync('./products.json', 'utf8'));
} catch(e) { console.error("products.json not found"); }

function buildProductCatalog() {
    return productDB.products.map(p =>
        `- ${p.name}: Listed Price Rs.${p.listedPrice.toLocaleString()} | Minimum Price Rs.${p.floorPrice.toLocaleString()} | ${p.description}`
    ).join('\n');
}

// =====================================================
//  CRM - Customer Database
// =====================================================
const crmFile = './customer_crm.json';
let customerCRM = {};
if (fs.existsSync(crmFile)) {
    try { customerCRM = JSON.parse(fs.readFileSync(crmFile, 'utf8')); }
    catch (e) { console.error("CRM read error:", e.message); }
}
function saveCRM() {
    fs.writeFileSync(crmFile, JSON.stringify(customerCRM, null, 2));
}

function parseCRMTag(text, userId) {
    const match = text.match(/\[CRM:([^\]]*)\]/);
    if (!match) return text;

    const data = match[1];
    if (!customerCRM[userId]) customerCRM[userId] = {};

    const name     = data.match(/name=([^,\]]+)/);
    const loc      = data.match(/location=([^,\]]+)/);
    const purchase = data.match(/purchase=([^,\]]+)/);

    if (name)     customerCRM[userId].name = name[1].trim();
    if (loc)      customerCRM[userId].location = loc[1].trim();
    if (purchase) {
        let ex = customerCRM[userId].past_purchases;
        customerCRM[userId].past_purchases = ex ? ex + ", " + purchase[1].trim() : purchase[1].trim();
    }

    if (name || loc || purchase) {
        saveCRM();
        console.log(`\n💾 [CRM] Updated for ${userId}:`, customerCRM[userId]);
    }
    return text.replace(/\[CRM:[^\]]*\]/g, '').trim();
}

// =====================================================
//  RESPONSE CLEANER
// =====================================================
function cleanResponse(text) {
    const lines = text.split('\n');
    const replyLines = lines.filter(line => {
        const t = line.trim();
        if (!t) return false;
        if (t.startsWith('*') || t.startsWith('•') || t.startsWith('·')) return false;
        if (/^(context:|role:|style:|note:|task:|goal:|user said|user wants|the user|i should|i need|i will|i already|thinking:|step \d)/i.test(t)) return false;
        return true;
    });
    return replyLines.join('\n').trim() || "Assalam o Alaikum! Aapki kya madad kar sakta hoon? 😊";
}

// =====================================================
//  SYSTEM PROMPT - Shopkeeper with Negotiation Rules
// =====================================================
function getSystemPrompt(userId) {
    const profile = customerCRM[userId];
    let crmNote = '';
    if (profile && (profile.name || profile.past_purchases)) {
        crmNote = `\n\nYaad raho — yeh customer pehle aa chuka hai:
Naam: ${profile.name || '?'} | City: ${profile.location || '?'} | Pichle orders: ${profile.past_purchases || 'kuch nahi'}
Inhe naam se greet karo aur pichle order ka haal zaroor pocho!`;
    }

    const catalog = buildProductCatalog();

    return `Soch ke tu "Naveed bhai" hai — ek experienced Pakistani electronics shop owner jo WhatsApp pe customers se baat karta hai. Tu 15 saal se yeh kaam kar raha hai. Tera andaz dosti wala aur warm hai, lekin tu apna business bhi samajhta hai.

Teri dukan ke products:
${catalog}

Tu kaise baat karta hai:
- Bilkul natural Roman Urdu mein, jaise WhatsApp pe dost se baat hoti hai
- Kabhi bhi dry ya robotic nahi lagta
- Customer ki zaroorat pehle samajhta hai — seedha price nahi batata
- Agar AC chahiye: room ka size poochta hai, phir suitable suggest karta hai
- Agar TV chahiye: size, budget poochta hai, phir best value option batata hai
- Chhota message — max 3-4 lines, bilkul WhatsApp style

Qeemat ke baare mein:
- Hamesha listed price se shuru kar, lekin warmly: "Yaar yeh abhi Rs.X mein hai, market mein sabse badhiya deal hai"
- Agar discount maange: Thoda shift karo — "Dekh yaar tu regular customer lagta hai, Rs.Y kar deta hoon tere liye" 
- Maximum 2-3 baar negotiate karo, phir friendly firm bano: "Bhai sach mein ab aur nahi ho sakta, yeh meri cost pe aa gayi hai"
- Floor price se KABHI NEECHE MAT JAO — chahe customer kaisa bhi kare
- Agar floor se neeche maange: "Yaar mujhe khud yahi mila hai, itne mein dena possible nahi. Tu aur jagah check kar le, same quality sasti nahi milegi" — aur phir kisi doosre product ka option do

Close kaise karo:
- Urgency: "Yaar yeh model kaafi chal rahi hai, kal tak guarantee nahi"
- Value: "Bhai delivery aur installation bhi hum karenge"
- Final push: "Bhai pakka karo, address do, kal subah pahuncha denge"

CRM RULE — customer ko nahi dikhta:
Jab customer naam, address bataye ya order confirm kare — reply ke BILKUL AAKHIR mein likho:
[CRM:name=<naam>,location=<city>,purchase=<product name>]
${crmNote}`;
}

// =====================================================
//  CHAT HISTORY
// =====================================================
const historyFile = './chat_history.json';
let savedHistories = {};
if (fs.existsSync(historyFile)) {
    try { savedHistories = JSON.parse(fs.readFileSync(historyFile, 'utf8')); }
    catch (e) { console.error("History read error:", e.message); }
}
const userHistory = {};

async function getAIResponse(userId, userMessage) {
    if (!userHistory[userId]) {
        userHistory[userId] = savedHistories[userId] || [];
    }

    try {
        const model = genAI.getGenerativeModel({
            model: MODEL_NAME,
            systemInstruction: getSystemPrompt(userId)
        });

        const chat = model.startChat({ history: userHistory[userId] });
        const result = await chat.sendMessage(userMessage);
        const rawText = result.response.text();

        userHistory[userId].push({ role: "user",  parts: [{ text: userMessage }] });
        userHistory[userId].push({ role: "model", parts: [{ text: rawText }] });

        savedHistories[userId] = userHistory[userId];
        fs.writeFileSync(historyFile, JSON.stringify(savedHistories, null, 2));

        const afterCRM = parseCRMTag(rawText, userId);
        const finalReply = cleanResponse(afterCRM);
        console.log(`\n🤖 Reply: ${finalReply}`);
        return finalReply;

    } catch (err) {
        console.error("Gemini Error:", err.message ? err.message.split('\n')[0] : err);
        return "Thodi dikkat aa gayi, dobara message karein. 🙏";
    }
}

// =====================================================
//  EXPRESS - Keep Alive for Render
// =====================================================
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('✅ Bot is live!'));
app.listen(PORT, () => console.log(`Keep-Alive server on port ${PORT}`));

// =====================================================
//  WHATSAPP BOT
// =====================================================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Windows', 'Chrome', '10.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) qrcode.generate(qr, { small: true });
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('\n✅ Bot connected to WhatsApp!');
            console.log(`📦 Products loaded: ${productDB.products.length}`);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;
            if (msg.key.remoteJid === 'status@broadcast') return;
            if (msg.key.remoteJid.endsWith('@g.us')) return;

            const text = msg.message.conversation
                      || msg.message.extendedTextMessage?.text
                      || "";
            if (!text) return;

            const sender = msg.key.remoteJid;
            console.log(`\n💬 (${sender}): ${text}`);

            const reply = await getAIResponse(sender, text);
            await sock.sendMessage(sender, { text: reply });

        } catch (err) {
            console.error('❌ Handler error:', err.message ? err.message.split('\n')[0] : err);
        }
    });
}

startBot();
