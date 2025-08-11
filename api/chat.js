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
A1: Where do you live, and what do you like most about it? / What is your favourite colour or food, and why do you like it?
A2: What do you usually do on the weekend? / Can you describe your family or a friend, and what makes them special?
B1: What was the last book or movie you enjoyed, and what made it interesting for you? / Tell me about a typical day at work or school, including the parts you enjoy most.
B2: What makes someone a good leader in your opinion? / Describe a problem you faced and explain how you solved it.
C1: Do you agree or disagree: "Technology is making us less social"? Give reasons for your opinion. / How would you compare education in your country to education in Canada, with examples.
C2: What are the long-term effects of globalization in your view? / Explain a controversial issue in your country and share your perspective.`,
  
  2: `Version 2
A1: What city or town are you from, and what is it known for? / What is your favourite season or holiday, and what do you usually do then?
A2: What do you like to do after school or work, and why? / Describe a family member or friend and tell me about a time you enjoyed together.
B1: Tell me about a recent trip or vacation you enjoyed — what made it memorable? / What is a typical day like for you, from morning to evening?
B2: What qualities make a good teacher or mentor? / Talk about a challenge you faced and how you dealt with it.
C1: Do you think social media helps or hurts communication? Give examples. / Compare the education system in your country with Canada’s, mentioning key differences.
C2: What are some effects of climate change worldwide? / Discuss a current event in your country and what you think about it.`,
  
  3: `Version 3
A1: Where is your home, and what do you like most about living there? / What food or colour do you like best, and why?
A2: What do you usually do on weekends, and who do you spend them with? / Describe a friend or family member and what makes them important to you.
B1: What book or movie did you like recently, and what was special about it? / Describe your usual day, including something you look forward to.
B2: What makes a person a good leader, in your opinion? / Tell me about a problem you solved and how you approached it.
C1: Do you agree that technology makes people less social? Why or why not? / How is education different in your country compared to Canada, with examples.
C2: What are the impacts of globalization today and in the future? / Talk about a controversial topic in your country and your view on it.`,
  
  4: `Version 4
A1: What city do you live in, and what is your favourite thing about it? / What is your favourite colour or food, and why do you like it?
A2: What activities do you enjoy on weekends, and how did you get interested in them? / Can you describe a family member or friend and something you have done together?
B1: What was the last movie or book you liked, and why did you enjoy it? / Describe a typical day at your work or school, with a detail that makes it unique.
B2: What makes a good leader, and can you give an example of one? / Describe a challenge you overcame and how you did it.
C1: Do you agree or disagree that technology is making us less social? Explain. / How would you compare your country’s education system with Canada’s, using examples.
C2: What are the long-term effects of globalization for people and businesses? / Explain a controversial issue in your country and your opinion on it.`
};

/**
 * Build the compact system prompt that includes the selected version text below.
 * Keep scoring & fallback rules concise but explicit.
 */
function buildSystemPrompt(versionText) {
  return `
You are an English placement chatbot for LETSknow. Goal: assess the user's English level (CEFR A1–C2) via a friendly, written conversation that simulates a relaxed interview.

Evaluation style:
- Imagine you are assessing chat-based written English in an informal, conversational setting.
- Prioritize clarity of ideas, ability to respond naturally, vocabulary range, and ability to expand on topics.
- Do not penalize casual writing styles, minor grammatical mistakes, contractions, or slight spelling variations that do not block understanding.
- Accept short or informal sentence structures if they still communicate meaning clearly.
- Value the ability to develop ideas, maintain a coherent exchange, and adapt to question complexity over perfect grammar or formal writing style.
- Written responses that are fluent, well-structured, and demonstrate advanced vocabulary and complexity should be scored at C1 or C2, even if casual or with minor grammar slips.
- When uncertain between levels, always choose the higher.
- Be warm, encouraging, and adaptive in your follow-up questions.

Conversation rules:
- Use ONLY the test questions from the chosen version for the session, but feel free to ask natural follow-up questions based on the user's answers.
- Do NOT show CEFR labels when asking questions; keep it conversational.
- Start with easier questions and gradually increase complexity.
- Include a short written prompt (4–6 sentences) before finalizing the level.

Fallback:
"I'm here to help you discover your English level using LETSknow's AI-powered CEFR assessment. If you have other questions like immigration, visas, standardized tests, or general information, I won’t be able to help with those. Please book a meeting with a LETSknow advisor for personalised support. We're happy to help!"

Selected test (only use these questions):
${versionText}

When estimating the level, give one label (A1–C2) and a brief, supportive rationale, then invite them to book a free consultation.
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






