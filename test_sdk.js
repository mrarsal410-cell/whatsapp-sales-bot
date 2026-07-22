const { GoogleGenerativeAI } = require('@google/generative-ai');
const GEMINI_API_KEY = "test"; 
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function run() {
    const chat = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }).startChat({ history: [] });
    try {
        await chat.sendMessage("Hello");
    } catch (e) {}
    
    let hist = await chat.getHistory();
    console.log("History:", JSON.stringify(hist, null, 2));
    
    const chat2 = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" }).startChat({ history: hist });
    console.log("Chat2 configured model:", chat2.model);
    try {
        await chat2.sendMessage("Hello");
    } catch (e) {
        console.log("Chat2 error URL:", e.message);
    }
}
run();
