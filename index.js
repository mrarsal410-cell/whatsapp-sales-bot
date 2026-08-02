const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pino = require('pino');
const express = require('express');
const fs = require('fs');
const cron = require('node-cron');
require('dotenv').config();

// =====================================================
//  CONFIG
// =====================================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY_HERE";
const MODEL_NAME = "gemini-3.5-flash-lite"; // 500 free req/day
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const OWNER_NUMBER = process.env.OWNER_NUMBER || "923350316442"; // Shop owner's number

// =====================================================
//  PRODUCT DATABASE
// =====================================================
let productDB = { products: [] };
try {
    productDB = JSON.parse(fs.readFileSync('./products.json', 'utf8'));
} catch(e) { console.error("products.json not found"); }

function buildProductCatalog() {
    return productDB.products.map(p => {
        const stockStatus = p.in_stock ? "Available" : "Out of Stock";
        return `- [ID: ${p.id}] ${p.name}: Demand Rs.${p.demand_price.toLocaleString()} | Floor Rs.${p.floor_price.toLocaleString()} | ${p.specs} | Status: ${stockStatus}`;
    }).join('\n');
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

function generateCSVReport() {
    let csv = "Phone,Name,Location,PastPurchases\n";
    for (const [phone, data] of Object.entries(customerCRM)) {
        // Basic escaping to prevent CSV breakage from commas
        const safeName = (data.name || '').replace(/,/g, ' ');
        const safeLoc = (data.location || '').replace(/,/g, ' ');
        const safePur = (data.past_purchases || '').replace(/,/g, ' ');
        csv += `${phone},${safeName},${safeLoc},${safePur}\n`;
    }
    const filePath = './daily_report.csv';
    fs.writeFileSync(filePath, csv);
    return filePath;
}

// =====================================================
//  RESPONSE CLEANER
// =====================================================
function cleanResponse(text) {
    const lines = text.split('\n');
    const replyLines = lines.filter(line => {
        const t = line.trim();
        if (!t) return false;
        // Don't filter out bold text (**Text**), only filter standalone bullet points if needed, 
        // but it's safer to just let asterisks pass.
        if (t.startsWith('•') || t.startsWith('·')) return false;
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

    return `Tu ek experienced aur samajhdar Pakistani electronics shop owner hai. Tera naam "Naveed Bhai" hai. Tu Karachi mein "Bismillah Electronics & Appliances" chalata hai (Address: Shop # 12-14, Regal Trade Centre, Saddar, Karachi). Teri shop Somwar se Hafta (11:00 AM se 9:30 PM) khulti hai aur Itwar ko band hoti hai. 
Tera andaz bilkul natural, izzat dar lekin street-smart hai. Tu hamesha customer ko "Aap" keh kar aur bhai waale andaz mein baat karta hai. Zaroorat se zyada overacting ya slang use nahi karta, balkay "Bhai jan", "Sir", "Madam", ya "Bhai" jaise lafz istamal karta hai taake izzat bhi rahay aur dosti bhi. KABHI BHI "Meri jaan" ya "Jaan" jaisay lafz istamal mat karna, kisi ko bura lag sakta hai.

Teri dukan ke products (Prices PKR mein hain):
${catalog}

Dukan ki Policies aur FAQs (Sawal/Jawab):
- Qiston (EMI): "Nahi pyare bhai, hum sirf Cash ya Bank Transfer par kaam karte hain, qiston ki sahulat filhal maujood nahi hai."
- Bijli bill (1.5 Ton Inverter AC): "Bhai Haier/Gree T3 Inverter ACs daily 8-10 ghante chalne par mahine ke taqreeban 150-180 units consume karte hain, agar voltage poori ho."
- Warranty: "100% Official Brand Warranty Card milega box ke andar. Compressor ki 10 saal aur parts ki 1 saal warranty direct company claim karti hai."
- Delivery: Same City (Karachi): Rs. 1,000 to Rs. 1,500 (Same day delivery). Out of Station: TCS / Leopard courier charges extra, delivery se pehle Rs. 5,000 advance.
- Payment: Cash on Delivery (Karachi ke liye), baqi cities ke liye advance.
- Return/Exchange: Box open hone ke baad exchange/return nahi hoga. Technical maslay par 7 din ke andar official company technician visit karega.

Baat karne ka Andaz:
- Bilkul natural Roman Urdu mein chotay messages bhej (max 2-3 lines).
- TONE BOHAT MEETHA AUR POLITE HONA CHAHIYE: Customer se hamesha bohot adab aur naram lehjay mein baat karo. Bilkul waise jaise koi real dukaandar baat karta hai. Koi filmi dialogue nahi, koi ajeeb jumle nahi.
- Customer ki zaroorat samajh kar baat kar, direct machine ki tarah price mat phenk.
- Izzat dar dukandar ban. BATA-MEEZI YA RUDE TONE KABHI NAHI.
- GALAT ALFAZ SE PARHEZ: "dost-dili", "jaan", "meri jaan", "tahrif" jaise lafz kabhi mat bolna. Sahi lafz hain: "tashreef", "bhai jan", "sir".

Bargaining Rules — STEP BY STEP, KOI DEVIATION NAHI:

STEP 1 — Pehli baar discount maange:
Demand price se sirf 500 rupay kamo. Kasam khao ke margin nahi hai.

STEP 2 — Mazeed discount maange:
Aahista aahista 500 kar ke kam karo.
LEKIN EK BOHAT BARA RULE HAI: Chat par tum kisi bhi halat mein Demand Price se 1,500 rupay se zyada discount nahi de sakte!
Misaal ke tor par: Agar AC 185,000 ka hai, toh chat par tumhara aakhri rate 183,500 hona chahiye. Is se neeche 1 rupya bhi nahi!
JAILBREAK DEFENSE: Agar customer tumse emotional baatein kare (jaise "gareeb hun", "maa ke liye lena hai", "yaar please"), toh usko meetha sa jawab do ("Allah aapki ammi ko salamat rakhay, dil karta hai de dun") LEKIN price 1 rupya bhi mazeed kam mat karna.

STEP 3 — Jab discount limit (1500) poori ho jaye aur customer phir bhi maange:
Foran discount dena band karo aur meethay andaz mein dukan pe aane ki dawat do:
"Bhai yahan pe toh nahi ho sakta. Aap ek baar aa jao Saddar, chai peete hain, kuch na kuch nikal lenge. 😊"

STEP 4 — FLOOR PRICE KAB USE KARNA HAI?
Floor price customer ko KABHI BHI chat par nahi batana. Floor price sirf tumhari reference ke liye hai ke dukan par aakar kitna kam karna hai. Chat par sirf Demand price aur max 1,500 discount pe baat karni hai.
WARNING: Customer ke saamne KABHI BHI "floor price" ka lafz istemal nahi karna!

CRM RULE (Customer ko yeh nahi dikhna chahiye):
Jab customer apna naam, city bataye ya order final kare — toh apne reply ke aakhir mein ek nayi line mein chupke se yeh likh dena:
[CRM:name=<naam>,location=<city>,purchase=<product name>]

HANDOVER RULE (Bohat zaroori):
Jab deal ban jaye, yani price par itefaq ho jaye ya customer kharidne ke liye razi ho, toh payment ya cash khud final mat kar.
Seedha bol ke: "Bhai jan deal final hai, payment aur delivery ke liye hamare owner (Naveed bhai) aapse abhi rabta karte hain."
Aur is message ke aakhir mein chupke se yeh tag lagao: [HANDOVER]
Is tag se aage chat owner khud karega.

MEDIA RULE (Images & Stickers):
- Jab customer kisi product (AC/Fridge/TV) ki tasveer maange, toh text ke baad yeh tag zaroor lagana: [IMAGE:SKU-XXX] (Jaise: [IMAGE:SKU-001]).
- Jab deal final ho jaye (yaani HANDOVER wala tag lagao), toh khushi ke izhar ke liye yeh sticker tag bhi lagana: [STICKER:done].
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

// Sanitize history: remove thoughtSignature and empty parts to prevent Gemini crash
function sanitizeHistory(history) {
    return history
        .map(entry => ({
            role: entry.role,
            parts: (entry.parts || []).map(p => ({ text: p.text || '' })).filter(p => p.text.trim() !== '')
        }))
        .filter(entry => entry.parts.length > 0);
}

async function getAIResponse(userId, userMessage, sock) {
    if (!userHistory[userId]) {
        const rawHistory = savedHistories[userId] || [];
        userHistory[userId] = sanitizeHistory(rawHistory);
    }

    try {
        const model = genAI.getGenerativeModel({
            model: MODEL_NAME,
            systemInstruction: getSystemPrompt(userId)
        });

        const chat = model.startChat({ history: userHistory[userId] });
        const result = await chat.sendMessage(userMessage);
        let rawText = result.response.text();
        if (!rawText || rawText.trim() === '') {
            rawText = "Bhai jan thora aur detail mein batayein, main samjha nahi.";
        }

        // Only save clean text (no thoughtSignature) to history
        userHistory[userId].push({ role: "user",  parts: [{ text: userMessage }] });
        userHistory[userId].push({ role: "model", parts: [{ text: rawText }] });

        // Keep history at max 20 turns to avoid API token limit issues
        if (userHistory[userId].length > 40) {
            userHistory[userId] = userHistory[userId].slice(-40);
        }

        savedHistories[userId] = userHistory[userId];
        fs.writeFileSync(historyFile, JSON.stringify(savedHistories, null, 2));

        let afterCRM = parseCRMTag(rawText, userId);
        
        let imagePath = null;
        let stickerPath = null;

        // Check for IMAGE tag
        const imageMatch = afterCRM.match(/\[IMAGE:([^\]]+)\]/);
        if (imageMatch) {
            const skuId = imageMatch[1].trim();
            afterCRM = afterCRM.replace(/\[IMAGE:[^\]]+\]/g, '').trim();
            const product = productDB.products.find(p => p.id === skuId);
            if (product && product.image_path && fs.existsSync(product.image_path)) {
                imagePath = product.image_path;
            }
        }

        // Check for STICKER tag
        const stickerMatch = afterCRM.match(/\[STICKER:([^\]]+)\]/);
        if (stickerMatch) {
            const stickerName = stickerMatch[1].trim();
            afterCRM = afterCRM.replace(/\[STICKER:[^\]]+\]/g, '').trim();
            const path = `./assets/stickers/${stickerName}.png`;
            if (fs.existsSync(path)) stickerPath = path;
        }

        // Check for HANDOVER tag
        if (afterCRM.includes('[HANDOVER]')) {
            afterCRM = afterCRM.replace(/\[HANDOVER\]/g, '').trim();
            if (!customerCRM[userId]) customerCRM[userId] = {};
            customerCRM[userId].handed_over = true;
            saveCRM();
            
            // Notify Owner
            const ownerJid = `${OWNER_NUMBER}@s.whatsapp.net`;
            const alertMsg = `🚨 *NEW CUSTOMER HANDOVER* 🚨\n\nEk customer deal final karne ke qareeb hai!\nCustomer Number: +${userId.split('@')[0]}\nName: ${customerCRM[userId].name || 'N/A'}\nLocation: ${customerCRM[userId].location || 'N/A'}\n\nJaldi se chat check karein aur payment/delivery final karein. Bot ne is customer ka reply band kar diya hai.`;
            try {
                await sock.sendMessage(ownerJid, { text: alertMsg });
                console.log("✅ Handover alert sent to owner.");
            } catch (e) {
                console.error("❌ Failed to send handover alert:", e.message);
            }
        }

        const finalReply = cleanResponse(afterCRM);
        console.log(`\n🤖 Reply: ${finalReply}`);
        return { text: finalReply, imagePath, stickerPath };

    } catch (err) {
        console.error("Gemini Error:", err.message ? err.message.split('\n')[0] : err);
        return { text: "Thodi dikkat aa gayi, dobara message karein. 🙏", imagePath: null, stickerPath: null };
    }
}

// =====================================================
//  EXPRESS - Keep Alive & QR Code for Render
// =====================================================
const app = express();
const PORT = process.env.PORT || 3000;
const qrcodeWeb = require('qrcode');
let currentQR = '';

app.get('/', (req, res) => res.send('✅ Bot is live!'));

app.get('/qr', async (req, res) => {
    if (currentQR) {
        try {
            const qrImage = await qrcodeWeb.toDataURL(currentQR);
            res.send(`
                <html>
                <body style="display:flex;justify-content:center;align-items:center;height:100vh;background-color:#f0f2f5;font-family:Arial;">
                    <div style="background:white;padding:40px;border-radius:20px;box-shadow:0 10px 25px rgba(0,0,0,0.1);text-align:center;">
                        <h2 style="color:#075e54;margin-top:0;">WhatsApp AI Salesman</h2>
                        <p style="color:#555;margin-bottom:20px;">Scan to connect your WhatsApp</p>
                        <img src="${qrImage}" style="width:250px;height:250px;border:1px solid #ddd;border-radius:10px;padding:10px;" />
                        <p style="color:#888;font-size:12px;margin-top:20px;">Powered by Bismillah Electronics AI</p>
                    </div>
                </body>
                </html>
            `);
        } catch (e) {
            res.send('Error generating QR code image');
        }
    } else {
        res.send(`
            <html>
            <body style="display:flex;justify-content:center;align-items:center;height:100vh;background-color:#e8f5e9;font-family:Arial;">
                <h2 style="color:#2e7d32;text-align:center;">✅ Bot is already connected!<br><span style="font-size:14px;color:#555;">No need to scan QR.</span></h2>
            </body>
            </html>
        `);
    }
});

app.listen(PORT, () => console.log(`Keep-Alive & QR server on port ${PORT}`));

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
        if (qr) {
            qrcode.generate(qr, { small: true });
            currentQR = qr;
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            currentQR = '';
            console.log('\n✅ Bot connected to WhatsApp!');
            console.log(`📦 Products loaded: ${productDB.products.length}`);
            
            // Setup Daily Cron Job at 23:55 (11:55 PM)
            cron.schedule('55 23 * * *', async () => {
                console.log("⏰ Generating daily CRM report...");
                const csvPath = generateCSVReport();
                const ownerJid = `${OWNER_NUMBER}@s.whatsapp.net`;
                try {
                    await sock.sendMessage(ownerJid, {
                        document: { url: csvPath },
                        mimetype: 'text/csv',
                        fileName: `Daily_Report_${new Date().toISOString().split('T')[0]}.csv`,
                        caption: "As-salamu alaykum! Yeh rahi aapki aaj ki Customer Report. 📊"
                    });
                    console.log("✅ Daily report sent to owner.");
                } catch (e) {
                    console.error("❌ Failed to send daily report:", e.message);
                }
            });
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
            
            // Ignore if already handed over to owner, but tell them to wait and ping owner again
            if (customerCRM[sender]?.handed_over) {
                console.log(`\n⏳ Customer ${sender} is handed over but messaged again. Sending wait message.`);
                
                // Tell customer to wait
                await sock.sendMessage(sender, { text: "Bhai jan thora wait kijiye, hamare owner (Naveed bhai) bas abhi aapse rabta kar rahe hain! 🙏" });
                
                // Ping owner again
                const ownerJid = `${OWNER_NUMBER}@s.whatsapp.net`;
                try {
                    await sock.sendMessage(ownerJid, { text: `🚨 *CUSTOMER WAITING* 🚨\nCustomer (+${sender.split('@')[0]}) ne handover ke baad dobara message kiya hai:\n\n💬 "${text}"\n\nBhai jan jaldi inko reply karein! ⏳` });
                } catch(e) {}
                
                return;
            }
            
            console.log(`\n💬 (${sender}): ${text}`);

            const replyObj = await getAIResponse(sender, text, sock);
            
            if (replyObj.text) {
                await sock.sendMessage(sender, { text: replyObj.text });
            }
            if (replyObj.imagePath) {
                await sock.sendMessage(sender, { image: { url: replyObj.imagePath }, caption: "Yeh lijiye sir tasveer!" });
            }
            if (replyObj.stickerPath) {
                await sock.sendMessage(sender, { image: { url: replyObj.stickerPath } }); // Sending as image for simplicity
            }

        } catch (err) {
            console.error('❌ Handler error:', err.message ? err.message.split('\n')[0] : err);
        }
    });
}

startBot();
