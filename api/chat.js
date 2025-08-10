// api/chat.js
import fetch from "node-fetch";

/**
 * Helper: parse cookies from incoming header string
 */
function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").map(c => c.trim()).reduce((acc, pair) => {
    if (!pair) return acc;
    const [k, ...v] = pair.split("=");
    acc[k] = decodeURIComponent(v.join("="));
    return acc;
  }, {});
}

// Simple cache for common questions
const cachedReplies = {
  "hello": "Hello! I’m your English Assistant. I’ll ask a few friendly questions to understand your English level.",
  "hi": "Hi there! Ready to test your English skills? Let's get started.",
  "help": "I’m here to help you assess your English level. Just type your message and I'll guide you.",
  // Add more common phrases and their canned replies here
};

/**
 * The 4 test version blocks. Keep them short (each is a string).
 * We inject only the selectedVersionText into the system prompt so the model uses that set.
 */
const VERSIONS = {
  1: `Version 1
A1: Where do you live? / What is your favourite colour or food?
A2: What do you usually do on the weekend? / Can you describe your family or a friend?
B1: What was the last book or movie you enjoyed, and why? / Tell me about a typical day at work or school.
B2: What makes someone a good leader? / Describe a problem you faced and how you solved it.
C1: Do you agree or disagree: "Technology is making us less social"? Why? / How would you compare education in your country to education in Canada?
C2: What are the long-term effects of globalization? / Explain a controversial issue in your country and your opinion.`,
  2: `Version 2
A1: What city or town are you from? / What is your favourite season or holiday?
A2: What do you like to do after school or work? / Describe a family member or a friend.
B1: Tell me about a recent trip or vacation you enjoyed. / What is a typical day like for you?
B2: What qualities make a good teacher or mentor? / Talk about a challenge you have faced and how you dealt with it.
C1: Do you think social media helps or hurts communication? Why? / Compare the education system in your country with Canada’s.
C2: What are some effects of climate change worldwide? / Discuss a current event in your country and your thoughts about it.`,
  3: `Version 3
A1: Where is your home? / What food or color do you like best?
A2: What do you do on weekends? / Describe a friend or family member.
B1: What book or movie did you like recently? Why? / Describe your usual day.
B2: What makes a person a good leader? / Tell me about a problem you solved.
C1: Do you agree that technology makes people less social? Why or why not? / How is education different in your country versus Canada?
C2: What are the impacts of globalization? / Talk about a controversial topic in your country and your view.`,
  4: `Version 4
A1: What city do you live in? / What is your favourite color or food?
A2: What activities do you enjoy on weekends? / Can you describe a family member or friend?
B1: What was the last movie or book you liked? Why? / Describe a typical day at your work or school.
B2: What makes a good leader? / Describe a challenge you overcame.
C1: Do you agree or disagree that technology is making us less social? Why? / How would you compare your country’s education system with Canada’s?
C2: What are the effects of globalization in the long term? / Explain a controversial issue in your country and your opinion.`
};

/**
 * Build the compact system prompt that includes the selected version text below.
 * Keep scoring & fallback rules concise but explicit.
 */
function buildSystemPrompt(versionText) {
  return `
You are an English placement chatbot for LETSknow. Goal: assess the user's English level (CEFR A1–C2) via a friendly, tiered conversation.
Rules:
- Use ONLY the test questions from the chosen version for the whole session.
- Do NOT display CEFR labels while asking; ask conversationally.
- Include a short writing prompt (4–6 sentences) and an optional speaking prompt before finalizing the level.
- Be very generous and supportive: do not penalize minor or occasional mistakes, especially from fluent or native speakers.
- When uncertain between levels, always assign the higher level.
- If user asks unrelated questions (visas, immigration, IELTS, TOEFL, study abroad, general information), use the fallback (see below) and invite them to book a LETSknow advisor.

Fallback:
"I'm here to help you discover your English level using LETSknow's AI-powered CEFR assessment. If you have other questions like immigration, visas, standardized tests, or general information, I won’t be able to help with those. Please book a meeting with a LETSknow advisor for personalised support. We're happy to help!"

Selected test (only use these questions):
${versionText}

When estimating the level later, give one label (A1–C2) and a 1–2 sentence friendly rationale, then invite them to book a free consultation.
`.trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Parse cookie to see if we already assigned a version
    const cookies = parseCookies(req.headers.cookie || "");
    let version = cookies.cefr_version ? Number(cookies.cefr_version) : null;
    let setCookieHeader = null;

    if (!version || !VERSIONS[version]) {
      // pick a random version 1-4
      version = Math.floor(Math.random() * 4) + 1;
      // set cookie for 1 hour (3600s). Adjust max-age if you want longer.
      // SameSite=Lax allows top-level navigation requests; Secure requires HTTPS (Vercel provides it).
      setCookieHeader = `cefr_version=${version}; Path=/; Max-Age=3600; HttpOnly=false; SameSite=Lax; Secure`;
    }

    const versionText = VERSIONS[version];

    // Accept either a "history" array of messages or a single "message"
    // Recommended: frontend should send "history": [{role:'user'|'assistant', content: '...'}, ...]
    const { history, message } = req.body ?? {};
    
// Get the user's latest message text in lowercase for simple matching
const userMessage = (Array.isArray(history) && history.length > 0)
  ? history[history.length - 1].content.toLowerCase().trim()
  : (message || "").toLowerCase().trim();

if (cachedReplies[userMessage]) {
  if (setCookieHeader) res.setHeader("Set-Cookie", setCookieHeader);
  return res.status(200).json({ reply: cachedReplies[userMessage] });
}

    let messages = [{ role: "system", content: buildSystemPrompt(versionText) }];

    if (Array.isArray(history) && history.length > 0) {
      // trust the client-provided conversation history (useful for multi-turn)
      messages = messages.concat(history);
    } else if (message) {
      // fallback: single user message
      messages.push({ role: "user", content: message });
    } else {
      return res.status(400).json({ error: "No message or history provided" });
    }

    // Call OpenAI
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        max_tokens: 800,
        temperature: 0.6
      })
    });

    if (!openaiRes.ok) {
      const txt = await openaiRes.text();
      console.error("[api/chat] OpenAI error:", openaiRes.status, txt);
      if (setCookieHeader) res.setHeader("Set-Cookie", setCookieHeader);
      return res.status(502).json({ error: "AI service error", details: txt });
    }

    const data = await openaiRes.json();
    const reply = data.choices?.[0]?.message?.content ?? "I couldn't generate a response.";

    // Return reply and set cookie if newly created
    if (setCookieHeader) res.setHeader("Set-Cookie", setCookieHeader);
    return res.status(200).json({ reply });

  } catch (err) {
    console.error("[api/chat] exception:", err);
    return res.status(500).json({ error: "Server error" });
  }
}



