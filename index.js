const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pino = require('pino');
const express = require('express');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
require('dotenv').config();

const MASTER_PASSWORD = process.env.MASTER_PASSWORD || 'master123';
const DEFAULT_GEMINI_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 3000;
const qrcodeWeb = require('qrcode');

// ── Client Registry (RAM mein sab bots) ──
const clientBots = {};
const masterSessions = new Set();
const clientSessions = {};

// ── Load all clients from /clients folder ──
function loadClients() {
    const dir = './clients';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    return fs.readdirSync(dir).filter(id => {
        return fs.existsSync(path.join(dir, id, 'config.json'));
    }).map(id => {
        return JSON.parse(fs.readFileSync(path.join(dir, id, 'config.json'), 'utf8'));
    });
}

// ── System Prompt (Fully Trained Salesman: Abdullah) ──
function getSystemPrompt(clientId, userId) {
    const config = JSON.parse(fs.readFileSync(`./clients/${clientId}/config.json`, 'utf8'));
    const productsFile = `./clients/${clientId}/products.json`;
    const products = fs.existsSync(productsFile) ? JSON.parse(fs.readFileSync(productsFile, 'utf8')) : { products: [] };
    const crmFile = `./clients/${clientId}/crm.json`;
    const crm = fs.existsSync(crmFile) ? JSON.parse(fs.readFileSync(crmFile, 'utf8')) : {};

    const catalog = products.products.length > 0
        ? products.products.map(p => `- [ID: ${p.id}] ${p.name}: Demand Rs.${p.demand_price?.toLocaleString()} | Floor Rs.${p.floor_price?.toLocaleString()} | ${p.specs || ''} | ${p.in_stock ? 'Available' : 'Out of Stock'}`).join('\n')
        : '(Products abhi add nahi hue)';

    const profile = crm[userId];
    const crmNote = (profile?.name || profile?.past_purchases)
        ? `\n\nYaad raho — yeh customer pehle aa chuka hai:\nNaam: ${profile.name || '?'} | City: ${profile.location || '?'}\nInhe naam se greet karo!`
        : '';

    const customRules = config.customInstructions
        ? `\n\nShop Ki Khas Hidayat (Follow this strictly):\n${config.customInstructions}`
        : '';

    return `Tu ek experienced, intelligent aur street-smart Pakistani electronics salesman hai. Tera naam "Abdullah" hai aur tu "${config.shopName}" shop ka manager hai.
Address: ${config.address || 'N/A'}. Timings: ${config.timings || 'Mon-Sat 10AM-9PM, Sunday off'}.

COMMUNICATION STYLE & TONE:
- Tera andaz bilkul real, meetha, aur mukammal professional hai (Karachi/Saddar market style).
- Hamesha Roman Urdu mein chotay aur to-the-point messages bhejo (max 2-3 lines).
- Customer ko "Bhai jan", "Baji" (for females, if clear), "Sir", ya "Madam" keh kar adab se baat karo.
- KABHI BHI "meri jaan", "jaan", "dost-dili", ya "priya/mitr" jaise words use mat karna.
- ⚠️ STRICT RULE: KABHI BHI Indian/Hindi ke words use mat karna!
  - "dhanyawaad" -> "Shukriya"
  - "kripya" -> "Meharbani" / "Please"
  - "samasya" -> "masla"
  - "sahayata" -> "madad" / "help"
  - "swagat" -> "Khushamdeed"
  - "chinta" -> "fikr"
  - "namaste" / "pranam" KABHI NAHI BOLNA. Greetings hamesha "Walaikum Assalam" (agar customer Salam kare) ya "Assalam-o-Alaikum" ya "Ji bhai jan" se start karo.

PRODUCT & INDUSTRY KNOWLEDGE (Sell Value & Technical Authority!):
1. Air Conditioners (ACs):
   - Capacity Recommendation: 1 Ton (Up to 120 sq ft, chota room), 1.5 Ton (120 to 190 sq ft, standard master bedroom), 2 Ton (200 sq ft se upar, big lounge).
   - Compressors: T3 Rotary Compressor (Landa, Highly, GMCC inside Gree/Haier) are designed for extreme temperatures up to 52°C without tripping. T1 ordinary compressors trip at 43°C.
   - Condenser Material: 100% Pure Copper (durable, leak-proof, easily repairable) vs Aluminum (sasta condenser - leak hone par complete set change karna parta hai, Saddar market and Hall Road main bad-naam hai).
   - Gas Types: R32 (new eco-friendly gas, faster cooling, higher efficiency) vs R410a (standard, high pressure) vs R22 (outdated gas, banned in newer inverter ACs).
   - Inverter Tech: Twin Rotary Compressors (Gree G10, Haier Triple Inverter) dynamically lower RPM once room cools down. Single Rotary vibrates at low speeds. Saves up to 65% on bills.
2. Refrigerators & Freezers (Fridges):
   - Stabilizer-Free Operation: Inverter fridges run on low-voltage startup (starting from 135V to 260V). Customer ko bolo extra Rs. 4,000 stabilizer ke bach jayenge.
   - Side Heating: If customer complains "Fridg side se garam hai", explain: "Bhai jan body garam hona normal hai, iska built-in condenser walls ke andar hota hai jo heat reject karta hai taake rust na lage. Stabilizer-free model hai, fikar na karein."
   - Cooling Tech: Direct Cool (tezz cooling, baraf jamegi) vs No Frost (automatic defrost, baraf bilkul nahi jamegi, cake/fruits dry nahi hote).
3. LEDs / Smart TVs:
   - Panel Tech: IPS Panel (wide viewing angle, touch proof - bache agar screen chhuen toh panel damage nahi hota, best for lounge) vs VA Panel (high contrast, deep blacks, best for dark rooms).
   - Operating System: Licensed Google TV/Android TV (Play Store + Chromecast built-in) vs Chinese Custom Android (sasta, but Netflix aur YouTube update hone par block ho jate hain).
4. Local Market & Pricing Dynamics:
   - Smuggled / Non-Warranty Maal: Customer ko educate karo ke smuggled products saste zaroor hote hain but local cards replaced hote hain aur warranty company claim nahi karti. "Hamare pas 100% official brand card aur company ki sealed official warranty card hogi jo company customer center claim karega."
   - Rate Lock: "Bhai jan dollar fluctuations aur customs duties ki waja se rates roz change ho rahe hain. Yeh rate jo maine diya hai, sirf aaj shaam tak valid hai."

NEGOTIATION & BARGAINING PSYCHOLOGY (Dhande ke usool):
- Pehli baar price poochne par direct lowest price nahi deni. Hamesha list price (Demand Price) batani hai.
- Agar customer bargain kare:
  - STEP 1 (Pehli baar discount maange): Sirf Rs.500 kam karo, aur bolo "Bhai jan, margin bilkul na hone ke barabar hai, lekin aap ke liye Rs.500 chore deta hoon."
  - STEP 2 (Mazeed zidd kare): Rs.500 aur kam karo (Total 1000 kam). Samjhao ke "Bhai is se neechay bilkul nuqsan ho jayega."
  - STEP 3 (Akhri limit reaches Floor Price): Agar product ki Floor Price defined hai, toh kisi haal mein Floor Price se 1 rupya bhi neechay nahi jana! Agar floor price nahi hai, toh max Rs.1,500 tak hi discount dena hai.
  - STEP 4 (Floor Limit Reached): "Bhai yahan pe toh bilkul namumkin hai. Aap aik kaam karein, Saddar dukan pe tashreef layen, chai peete hain aur baith kar deal nikal lenge. Mayoos nahi karunga aap ko! ☕"

SHOP POLICIES:
- Qiston (EMI) ka kaam nahi hai. Sirf Cash ya Bank Transfer.
- Warranty: 100% official brand warranty hai (e.g. Dawlance, Haier, Orient).
- Delivery: Karachi/Same city Rs. 1,000-1,500. Out of station: courier charges alag se honge + Rs.5,000 advance.

TAGS (Strict format in replies):
- CRM Update: [CRM:name=<naam>,location=<city>,purchase=<product>] (Jab customer apna naam/city/product details bataye).
- Handover to Owner: [HANDOVER] (Jab deal final ho jaye aur customer delivery/payment details de).
- Product Image Request: [IMAGE:<product-id>] (Jab customer product ki picture maange).
${crmNote}${customRules}`;
}

// ── Start a single client's bot ──
async function startClientBot(clientId) {
    const clientDir = `./clients/${clientId}`;
    const authDir = `${clientDir}/auth`;
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

    const configFile = `${clientDir}/config.json`;
    if (!fs.existsSync(configFile)) return;
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    if (!config.active) return;

    const apiKey = config.geminiApiKey || DEFAULT_GEMINI_KEY;
    const genAI = new GoogleGenerativeAI(apiKey);

    const historyFile = `${clientDir}/history.json`;
    let savedHistories = {};
    if (fs.existsSync(historyFile)) {
        try { savedHistories = JSON.parse(fs.readFileSync(historyFile, 'utf8')); } catch (e) {}
    }
    const userHistory = {};

    clientBots[clientId] = { status: 'connecting', qr: null, config, sock: null };

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ['Windows', 'Chrome', '10.0']
    });

    clientBots[clientId].sock = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            qrcode.generate(qr, { small: true });
            clientBots[clientId].qr = qr;
            clientBots[clientId].status = 'qr_pending';
            console.log(`\n[${clientId}] 📱 Scan QR to connect WhatsApp`);
        }
        if (connection === 'close') {
            clientBots[clientId].status = 'disconnected';
            const code = lastDisconnect?.error?.output?.statusCode;
            const reconnect = code !== DisconnectReason.loggedOut;
            console.log(`[${clientId}] ❌ Disconnected (code: ${code}). Reconnect: ${reconnect}`);
            if (reconnect) setTimeout(() => startClientBot(clientId), 5000);
        } else if (connection === 'open') {
            clientBots[clientId].status = 'open';
            clientBots[clientId].qr = null;
            console.log(`\n✅ [${clientId}] Bot connected to WhatsApp!`);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;
            if (msg.key.remoteJid === 'status@broadcast') return;
            if (msg.key.remoteJid.endsWith('@g.us')) return;

            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            if (!text.trim()) return;

            const sender = msg.key.remoteJid;

            // Check handover
            const crmFile = `${clientDir}/crm.json`;
            const crm = fs.existsSync(crmFile) ? JSON.parse(fs.readFileSync(crmFile, 'utf8')) : {};
            if (crm[sender]?.handed_over) return;

            console.log(`[${clientId}] 📩 ${sender}: ${text}`);

            // Build history
            if (!userHistory[sender]) {
                const raw = savedHistories[sender] || [];
                userHistory[sender] = raw.filter(e => e.parts?.length > 0 && e.parts.every(p => p.text?.trim()));
            }

            // Gemini AI
            const model = genAI.getGenerativeModel({
                model: 'gemini-3.1-flash-lite',
                systemInstruction: getSystemPrompt(clientId, sender)
            });

            const chat = model.startChat({ history: userHistory[sender] });
            const result = await chat.sendMessage(text);
            let rawText = result.response.text()?.trim() || 'Thodi dikkat aa gayi bhai jan, dobara message karein. 🙏';

            // Save to history
            userHistory[sender].push({ role: 'user', parts: [{ text }] });
            userHistory[sender].push({ role: 'model', parts: [{ text: rawText }] });
            if (userHistory[sender].length > 40) userHistory[sender] = userHistory[sender].slice(-40);
            savedHistories[sender] = userHistory[sender];
            fs.writeFileSync(historyFile, JSON.stringify(savedHistories, null, 2));

            // Parse CRM tag
            const crmMatch = rawText.match(/\[CRM:([^\]]+)\]/);
            if (crmMatch) {
                const pairs = crmMatch[1].split(',').reduce((acc, pair) => {
                    const [k, v] = pair.split('=');
                    if (k && v) acc[k.trim()] = v.trim();
                    return acc;
                }, {});
                const updatedCRM = fs.existsSync(crmFile) ? JSON.parse(fs.readFileSync(crmFile, 'utf8')) : {};
                updatedCRM[sender] = { ...updatedCRM[sender], ...pairs };
                fs.writeFileSync(crmFile, JSON.stringify(updatedCRM, null, 2));
            }
            rawText = rawText.replace(/\[CRM:[^\]]+\]/g, '').trim();

            // Parse HANDOVER tag
            if (rawText.includes('[HANDOVER]')) {
                rawText = rawText.replace(/\[HANDOVER\]/g, '').trim();
                const updatedCRM = fs.existsSync(crmFile) ? JSON.parse(fs.readFileSync(crmFile, 'utf8')) : {};
                if (!updatedCRM[sender]) updatedCRM[sender] = {};
                updatedCRM[sender].handed_over = true;
                fs.writeFileSync(crmFile, JSON.stringify(updatedCRM, null, 2));
                const ownerJid = `${config.ownerNumber}@s.whatsapp.net`;
                const custData = updatedCRM[sender];
                await sock.sendMessage(ownerJid, {
                    text: `🚨 *NEW HANDOVER - ${config.shopName}*\n\nCustomer: +${sender.split('@')[0]}\nNaam: ${custData.name || 'N/A'}\nCity: ${custData.location || 'N/A'}\n\nChat check karein aur deal final karein!`
                }).catch(e => console.error(`[${clientId}] Handover alert failed:`, e.message));
            }

            // Parse IMAGE tag
            const imageMatch = rawText.match(/\[IMAGE:([^\]]+)\]/);
            if (imageMatch) {
                const productId = imageMatch[1].trim();
                rawText = rawText.replace(/\[IMAGE:[^\]]+\]/g, '').trim();
                const productsFile = `${clientDir}/products.json`;
                const products = fs.existsSync(productsFile) ? JSON.parse(fs.readFileSync(productsFile, 'utf8')) : { products: [] };
                const product = products.products.find(p => p.id === productId);
                if (product?.image_path && fs.existsSync(product.image_path)) {
                    await sock.sendMessage(sender, { image: { url: product.image_path }, caption: rawText });
                    return;
                }
            }

            await sock.sendMessage(sender, { text: rawText });
            console.log(`[${clientId}] 🤖 Reply sent.`);

        } catch (err) {
            console.error(`[${clientId}] Error:`, err.message?.split('\n')[0]);
        }
    });

    // Daily CRM Report
    cron.schedule('55 23 * * *', async () => {
        try {
            const crmFile = `${clientDir}/crm.json`;
            const crm = fs.existsSync(crmFile) ? JSON.parse(fs.readFileSync(crmFile, 'utf8')) : {};
            let csv = 'Number,Name,City,Product,Handed Over\n';
            Object.entries(crm).forEach(([num, d]) => {
                csv += `+${num.split('@')[0]},${d.name||''},${d.location||''},${d.purchase||''},${d.handed_over?'Yes':'No'}\n`;
            });
            const csvPath = `${clientDir}/report_${new Date().toISOString().split('T')[0]}.csv`;
            fs.writeFileSync(csvPath, csv);
            const ownerJid = `${config.ownerNumber}@s.whatsapp.net`;
            await sock.sendMessage(ownerJid, {
                document: fs.readFileSync(csvPath),
                mimetype: 'text/csv',
                fileName: `Report_${config.shopName}_${new Date().toISOString().split('T')[0]}.csv`,
                caption: `📊 Aaj ki Customer Report - ${config.shopName}`
            });
        } catch (e) { console.error(`[${clientId}] Report error:`, e.message); }
    });
}

// ════════════════════════════════════════════
//  EXPRESS SERVER
// ════════════════════════════════════════════
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── MASTER ADMIN ──
app.get('/', (req, res) => res.send('✅ SaaS Server is Live!'));

app.get('/admin/login', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><title>Master Admin Login</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;background:linear-gradient(135deg,#0f2027,#203a43,#2c5364);min-height:100vh;display:flex;align-items:center;justify-content:center}
    .card{background:rgba(255,255,255,0.06);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:44px;width:370px;text-align:center}
    h2{color:#fff;font-size:22px;margin-bottom:6px}p{color:rgba(255,255,255,0.5);font-size:13px;margin-bottom:28px}
    input{width:100%;padding:13px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.08);color:#fff;font-size:14px;margin-bottom:14px;outline:none}
    input::placeholder{color:rgba(255,255,255,0.35)}
    button{width:100%;padding:13px;border-radius:10px;border:none;background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;font-size:15px;font-weight:600;cursor:pointer}
    .err{color:#ff6b6b;font-size:13px;margin-top:10px}</style></head>
    <body><div class="card"><h2>🔐 Master Admin</h2><p>WhatsApp Bot SaaS — Control Panel</p>
    <form method="POST" action="/admin/login">
    <input type="password" name="password" placeholder="Master password..." required>
    <button>Login →</button>
    ${req.query.err ? '<p class="err">❌ Galat password!</p>' : ''}
    </form></div></body></html>`);
});

app.post('/admin/login', (req, res) => {
    if (req.body.password === MASTER_PASSWORD) {
        const token = 'm_' + Math.random().toString(36).slice(2) + Date.now();
        masterSessions.add(token);
        res.redirect('/admin?token=' + token);
    } else {
        res.redirect('/admin/login?err=1');
    }
});

function masterAuth(req, res, next) {
    const token = req.query.token || req.headers['x-auth-token'];
    if (!masterSessions.has(token)) return res.redirect('/admin/login');
    req.token = token;
    next();
}

app.get('/admin', masterAuth, (req, res) => {
    const token = req.token;
    const clients = loadClients();
    const totalRevenue = clients.reduce((s, c) => s + (c.monthlyFee || 0), 0);
    const connected = clients.filter(c => clientBots[c.id]?.status === 'open').length;

    const rows = clients.map(c => {
        const bot = clientBots[c.id] || {};
        const s = bot.status || 'not_started';
        const sc = s === 'open' ? '#25d366' : s === 'qr_pending' ? '#ffa502' : '#ff4757';
        const st = s === 'open' ? '🟢 Connected' : s === 'qr_pending' ? '🟡 QR Pending' : '🔴 Offline';
        const crm = fs.existsSync(`./clients/${c.id}/crm.json`) ? JSON.parse(fs.readFileSync(`./clients/${c.id}/crm.json`,'utf8')) : {};
        const hist = fs.existsSync(`./clients/${c.id}/history.json`) ? JSON.parse(fs.readFileSync(`./clients/${c.id}/history.json`,'utf8')) : {};
        const qrBtn = s === 'qr_pending' ? `<a href="/admin/qr/${c.id}?token=${token}" style="color:#ffa502;font-size:12px;margin-left:8px">📱 QR</a>` : '';
        return `<tr>
            <td><strong style="color:#fff">${c.shopName}</strong><br><span style="color:#555;font-size:12px">${c.address||''}</span></td>
            <td style="color:#8b949e">+${c.ownerNumber}</td>
            <td><span style="color:${sc};font-weight:600">${st}</span>${qrBtn}</td>
            <td style="color:#fff">${Object.keys(crm).length}</td>
            <td style="color:#fff">${Object.keys(hist).length}</td>
            <td style="color:#25d366;font-weight:600">Rs.${(c.monthlyFee||0).toLocaleString()}</td>
            <td><a href="/client/${c.id}/login" target="_blank" style="color:#58a6ff;font-size:12px">Client Portal ↗</a></td>
        </tr>`;
    }).join('');

    res.send(`<!DOCTYPE html><html><head><title>Master Admin</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <meta http-equiv="refresh" content="20">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;background:#0d1117;color:#e6edf3}
    .hdr{background:#161b22;border-bottom:1px solid #30363d;padding:16px 28px;display:flex;justify-content:space-between;align-items:center}
    .logo{font-size:18px;font-weight:700}.logo span{color:#25d366}
    .main{padding:24px 28px;max-width:1300px;margin:0 auto}
    .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:22px}
    .stat{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:18px}
    .stat .n{font-size:30px;font-weight:700;color:#fff;margin:6px 0 4px}.stat .l{font-size:12px;color:#8b949e}
    .sec{background:#161b22;border:1px solid #30363d;border-radius:12px;overflow:hidden;margin-bottom:18px}
    .sh{padding:14px 18px;border-bottom:1px solid #30363d;font-weight:600;font-size:14px;display:flex;justify-content:space-between;align-items:center}
    table{width:100%;border-collapse:collapse}th{padding:11px 16px;text-align:left;font-size:11px;color:#8b949e;text-transform:uppercase;border-bottom:1px solid #30363d}
    td{padding:12px 16px;font-size:13px;border-bottom:1px solid #21262d}tr:last-child td{border-bottom:none}tr:hover td{background:#1c2128}
    .btn{padding:8px 16px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:600;background:linear-gradient(135deg,#25d366,#128c7e);color:#fff}
    .form-wrap{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:22px;margin-bottom:18px;display:none}
    .form-wrap.open{display:block}
    .fgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}
    .fg label{display:block;font-size:12px;color:#8b949e;margin-bottom:5px}
    .fg input{width:100%;padding:10px 12px;border-radius:8px;border:1px solid #30363d;background:#0d1117;color:#fff;font-size:13px;outline:none}
    a{text-decoration:none}</style></head>
    <body>
    <div class="hdr">
        <div class="logo">🤖 Bot <span>SaaS</span></div>
        <div style="display:flex;gap:14px;align-items:center">
            <span style="color:#555;font-size:12px">Auto-refresh: 20s</span>
            <a href="/admin/login" style="color:#8b949e;font-size:13px">Logout</a>
        </div>
    </div>
    <div class="main">
    <div class="stats">
        <div class="stat"><div class="l">👥 Total Clients</div><div class="n">${clients.length}</div></div>
        <div class="stat"><div class="l">🟢 Active Bots</div><div class="n" style="color:#25d366">${connected}</div></div>
        <div class="stat"><div class="l">💰 Monthly Revenue</div><div class="n" style="color:#25d366">Rs.${totalRevenue.toLocaleString()}</div></div>
        <div class="stat"><div class="l">🔴 Offline</div><div class="n" style="color:#ff4757">${clients.length - connected}</div></div>
    </div>
    <div class="form-wrap" id="addForm">
        <h3 style="margin-bottom:18px;font-size:15px">🆕 Naya Client Add Karo</h3>
        <form method="POST" action="/admin/add-client?token=${token}">
        <div class="fgrid">
            <div class="fg"><label>Client ID (sirf letters/underscore)</label><input name="id" placeholder="ahmed_traders" required></div>
            <div class="fg"><label>Shop Name</label><input name="shopName" placeholder="Ahmed Traders" required></div>
            <div class="fg"><label>Owner Name</label><input name="ownerName" placeholder="Ahmed" required></div>
            <div class="fg"><label>Owner WhatsApp (923XXXXXXXXX)</label><input name="ownerNumber" placeholder="923001234567" required></div>
            <div class="fg"><label>Address</label><input name="address" placeholder="Anarkali Bazar, Lahore" required></div>
            <div class="fg"><label>Monthly Fee (PKR)</label><input name="monthlyFee" type="number" placeholder="5000" value="5000"></div>
            <div class="fg"><label>Client Dashboard Password</label><input name="password" placeholder="client123" required></div>
            <div class="fg"><label>Shop Timings</label><input name="timings" placeholder="Mon-Sat 10AM-9PM, Sunday off"></div>
        </div>
        <button type="submit" class="btn" style="padding:11px 24px">✅ Client Banao →</button>
        </form>
    </div>
    <div class="sec">
        <div class="sh">
            <span>👥 All Clients</span>
            <button class="btn" onclick="document.getElementById('addForm').classList.toggle('open')">+ Naya Client</button>
        </div>
        <table><thead><tr><th>Shop</th><th>Owner</th><th>Bot Status</th><th>Customers</th><th>Chats</th><th>Monthly Fee</th><th>Actions</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;padding:30px;color:#555">Koi client nahi. Upar se add karo!</td></tr>'}</tbody>
        </table>
    </div>
    </div></body></html>`);
});

app.post('/admin/add-client', masterAuth, (req, res) => {
    const token = req.token;
    const { id, shopName, ownerName, ownerNumber, address, monthlyFee, password, timings } = req.body;
    if (!id || !shopName || !ownerNumber) return res.redirect('/admin?token=' + token);

    const clientDir = `./clients/${id}`;
    if (fs.existsSync(clientDir)) return res.redirect('/admin?token=' + token + '&err=exists');

    fs.mkdirSync(`${clientDir}/auth`, { recursive: true });
    const config = { id, shopName, ownerName: ownerName || 'Owner', ownerNumber, address: address || '', timings: timings || 'Mon-Sat 10AM-9PM, Sunday off', password: password || 'client123', active: true, monthlyFee: parseInt(monthlyFee) || 5000 };
    fs.writeFileSync(`${clientDir}/config.json`, JSON.stringify(config, null, 2));
    fs.writeFileSync(`${clientDir}/products.json`, JSON.stringify({ products: [] }, null, 2));
    fs.writeFileSync(`${clientDir}/crm.json`, '{}');
    fs.writeFileSync(`${clientDir}/history.json`, '{}');

    startClientBot(id).catch(console.error);
    res.redirect('/admin?token=' + token);
});

app.get('/admin/qr/:clientId', masterAuth, async (req, res) => {
    const token = req.token;
    const { clientId } = req.params;
    const bot = clientBots[clientId];
    if (bot?.qr) {
        const qrImg = await qrcodeWeb.toDataURL(bot.qr).catch(() => '');
        res.send(`<!DOCTYPE html><html><head><title>QR - ${clientId}</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
        <meta http-equiv="refresh" content="15">
        <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;background:#0d1117;display:flex;align-items:center;justify-content:center;min-height:100vh}
        .card{background:#161b22;border:1px solid #30363d;border-radius:20px;padding:40px;text-align:center;max-width:380px}
        h2{color:#fff;margin-bottom:8px;font-size:20px}p{color:#8b949e;margin-bottom:22px;font-size:13px}
        .back{display:inline-block;margin-top:18px;color:#58a6ff;font-size:13px}</style></head>
        <body><div class="card">
        <h2>📱 ${bot.config?.shopName || clientId}</h2>
        <p>Client ke phone par WhatsApp khol kar yeh QR scan karwayein.<br>Sirf <strong>ek dafa</strong> scan karna hai!</p>
        <img src="${qrImg}" style="width:260px;height:260px;border-radius:10px;border:2px solid #30363d">
        <p style="margin-top:14px;font-size:12px;color:#555">⟳ Har 15 second mein auto-refresh</p>
        <a href="/admin?token=${token}" class="back">← Wapis Admin</a>
        </div></body></html>`);
    } else if (bot?.status === 'open') {
        res.send(`<script>alert('✅ Bot already connected!');window.location='/admin?token=${token}'</script>`);
    } else {
        res.send(`<script>alert('Bot abhi start nahi hua. Thodi der mein try karein.');window.history.back()</script>`);
    }
});

// ── CLIENT PORTAL ──
app.get('/client/:id/login', (req, res) => {
    const { id } = req.params;
    if (!fs.existsSync(`./clients/${id}/config.json`)) return res.status(404).send('Client nahi mila');
    const config = JSON.parse(fs.readFileSync(`./clients/${id}/config.json`, 'utf8'));
    res.send(`<!DOCTYPE html><html><head><title>${config.shopName} - Login</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;background:linear-gradient(135deg,#064e3b,#065f46,#047857);min-height:100vh;display:flex;align-items:center;justify-content:center}
    .card{background:rgba(255,255,255,0.07);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:44px;width:370px;text-align:center}
    h2{color:#fff;font-size:20px;margin-bottom:6px}p{color:rgba(255,255,255,0.5);font-size:13px;margin-bottom:28px}
    input{width:100%;padding:13px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.08);color:#fff;font-size:14px;margin-bottom:14px;outline:none}
    input::placeholder{color:rgba(255,255,255,0.35)}
    button{width:100%;padding:13px;border-radius:10px;border:none;background:#25d366;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
    .err{color:#fca5a5;font-size:13px;margin-top:10px}</style></head>
    <body><div class="card">
    <h2>🤖 ${config.shopName}</h2><p>Apna dashboard dekhne ke liye login karein</p>
    <form method="POST" action="/client/${id}/login">
    <input type="password" name="password" placeholder="Password..." required>
    <button>Login →</button>
    ${req.query.err ? '<p class="err">❌ Galat password!</p>' : ''}
    </form></div></body></html>`);
});

app.post('/client/:id/login', (req, res) => {
    const { id } = req.params;
    if (!fs.existsSync(`./clients/${id}/config.json`)) return res.status(404).send('Not found');
    const config = JSON.parse(fs.readFileSync(`./clients/${id}/config.json`, 'utf8'));
    if (req.body.password === config.password) {
        const token = 'c_' + Math.random().toString(36).slice(2) + Date.now();
        if (!clientSessions[id]) clientSessions[id] = new Set();
        clientSessions[id].add(token);
        res.redirect(`/client/${id}?token=${token}`);
    } else {
        res.redirect(`/client/${id}/login?err=1`);
    }
});

function clientAuth(req, res, next) {
    const { id } = req.params;
    const token = req.query.token;
    if (!clientSessions[id]?.has(token)) return res.redirect(`/client/${id}/login`);
    req.token = token;
    next();
}

app.get('/client/:id', clientAuth, (req, res) => {
    const { id } = req.params;
    const token = req.token;
    const config = JSON.parse(fs.readFileSync(`./clients/${id}/config.json`, 'utf8'));
    const crm = fs.existsSync(`./clients/${id}/crm.json`) ? JSON.parse(fs.readFileSync(`./clients/${id}/crm.json`,'utf8')) : {};
    
    let history = {};
    if (fs.existsSync(`./clients/${id}/history.json`)) {
        try {
            const raw = fs.readFileSync(`./clients/${id}/history.json`, 'utf8');
            history = JSON.parse(raw);
            if (typeof history === 'string') history = JSON.parse(history);
        } catch(e) {}
    }

    const bot = clientBots[id] || {};
    const sc = bot.status === 'open' ? '#25d366' : bot.status === 'qr_pending' ? '#ffa502' : '#ff4757';
    const st = bot.status === 'open' ? '🟢 Connected' : bot.status === 'qr_pending' ? '🟡 Setup Pending' : '🔴 Offline';

    const custRows = Object.entries(crm).map(([num, d]) => `<tr>
        <td>+${num.split('@')[0]}</td>
        <td>${d.name||'—'}</td><td>${d.location||'—'}</td><td>${d.purchase||'—'}</td>
        <td style="color:${d.handed_over?'#25d366':'#58a6ff'}">${d.handed_over?'Handover ✅':'Active 💬'}</td>
    </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;padding:20px;color:#555">Koi customer nahi abhi</td></tr>';

    const chatRows = Object.entries(history).slice(-8).reverse().map(([num, msgs]) => {
        const last = Array.isArray(msgs) ? msgs[msgs.length-1] : null;
        const lastText = last?.parts?.[0]?.text || '—';
        return `<tr><td>+${num.split('@')[0]}</td><td>${Array.isArray(msgs) ? Math.floor(msgs.length/2) : 0}</td>
        <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${lastText.slice(0,55)}...</td></tr>`;
    }).join('') || '<tr><td colspan="3" style="text-align:center;padding:20px;color:#555">Koi conversation nahi</td></tr>';

    res.send(`<!DOCTYPE html><html><head><title>${config.shopName} Dashboard</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;background:#0d1117;color:#e6edf3}
    .hdr{background:#161b22;border-bottom:1px solid #30363d;padding:16px 24px;display:flex;justify-content:space-between;align-items:center}
    .logo{font-size:17px;font-weight:700;color:#fff}
    .main{padding:22px 24px;max-width:1100px;margin:0 auto}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px}
    .stat{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:18px;text-align:center}
    .stat .n{font-size:28px;font-weight:700;margin:6px 0 4px}.stat .l{font-size:12px;color:#8b949e}
    .sec{background:#161b22;border:1px solid #30363d;border-radius:12px;margin-bottom:16px;overflow:hidden}
    .sh{padding:13px 17px;border-bottom:1px solid #30363d;font-weight:600;font-size:14px;display:flex;justify-content:space-between;align-items:center}
    table{width:100%;border-collapse:collapse}th{padding:10px 15px;text-align:left;font-size:11px;color:#8b949e;text-transform:uppercase;border-bottom:1px solid #30363d}
    td{padding:11px 15px;font-size:13px;border-bottom:1px solid #21262d}tr:last-child td{border-bottom:none}tr:hover td{background:#1c2128}
    .pill{padding:4px 10px;border-radius:12px;font-size:11px;font-weight:600;display:inline-block;border:1px solid}
    textarea{width:100%;background:#0d1117;color:#fff;border:1px solid #30363d;border-radius:8px;padding:12px;font-family:inherit;font-size:13px;resize:vertical;min-height:120px;outline:none}
    textarea:focus{border-color:#25d366}
    .btn{padding:8px 16px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:600;background:#25d366;color:#fff}
    a{text-decoration:none}</style></head>
    <body>
    <div class="hdr">
        <div class="logo">🤖 ${config.shopName} Portal</div>
        <div style="display:flex;align-items:center;gap:12px">
            <span class="pill" style="color:${sc};border-color:${sc};background:${sc}22">${st}</span>
            <a href="/client/${id}/login" style="color:#8b949e;font-size:13px">Logout</a>
        </div>
    </div>
    <div class="main">
    <div class="stats">
        <div class="stat"><div class="l">👥 Customers</div><div class="n">${Object.keys(crm).length}</div></div>
        <div class="stat"><div class="l">💬 Total Chats</div><div class="n">${Object.keys(history).length}</div></div>
        <div class="stat"><div class="l">🤝 Handovers</div><div class="n" style="color:#25d366">${Object.values(crm).filter(d=>d.handed_over).length}</div></div>
    </div>
    
    <div class="sec">
        <div class="sh">🧠 Bot Training & Shop Rules</div>
        <div style="padding:16px">
            <p style="font-size:13px;color:#8b949e;margin-bottom:12px">Apne bot ko train karein! Yahan likhein ke aapki shop par kya bikta hai (AC, Fridge, Mobile etc.), aur bot kis tarah se customers ko handle kare.</p>
            <form method="POST" action="/client/${id}/train?token=${token}">
                <textarea name="instructions" placeholder="Example:\n- Hamare pas Dawlance aur Haier ke Fridge hote hain.\n- Price me 2000 se zyada discount nahi dena.\n- Delivery Saddar me free hai, baqi Karachi me Rs.1000 hai.\n- Agar stock me na ho to bolna 2 din me aa jayega.">${config.customInstructions || ''}</textarea>
                <div style="margin-top:12px;text-align:right">
                    <button class="btn">💾 Save & Train Bot</button>
                </div>
            </form>
        </div>
    </div>

    <div class="sec"><div class="sh">👥 Customers (CRM)</div>
    <table><thead><tr><th>Number</th><th>Naam</th><th>City</th><th>Product</th><th>Status</th></tr></thead>
    <tbody>${custRows}</tbody></table></div>
    
    <div class="sec"><div class="sh">💬 Recent Conversations</div>
    <table><thead><tr><th>Number</th><th>Messages</th><th>Aakhri Message</th></tr></thead>
    <tbody>${chatRows}</tbody></table></div>
    </div></body></html>`);
});

app.post('/client/:id/train', clientAuth, (req, res) => {
    const { id } = req.params;
    const token = req.token;
    const configFile = `./clients/${id}/config.json`;
    if (!fs.existsSync(configFile)) return res.status(404).send('Not found');
    
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    config.customInstructions = req.body.instructions || '';
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
    
    // Dynamically update the in-memory config for clientBots
    if (clientBots[id]) {
        clientBots[id].config = config;
    }
    
    res.redirect(`/client/${id}?token=${token}&saved=1`);
});

app.get('/qr', (req, res) => res.redirect('/admin/login'));
app.listen(PORT, () => console.log(`\n🚀 SaaS Server live on port ${PORT}`));

// ── Start all active bots ──
async function main() {
    const clients = loadClients();
    console.log(`\n📦 Starting ${clients.length} client bot(s)...\n`);
    for (const client of clients.filter(c => c.active)) {
        await startClientBot(client.id).catch(e => console.error(`[${client.id}] Start failed:`, e.message));
    }
}
main();
