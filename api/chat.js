// api/chat.js
import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body ?? {};
    if (!message) {
      return res.status(400).json({ error: "No message provided" });
    }

    // Build the system + user messages. Keep system prompt concise to avoid token issues.
    const systemPrompt = `
You are an English placement chatbot for LETSknow. Your job is to assess a user's English proficiency via friendly, tiered questions.
Rules:
- Randomly pick one of four test versions at the start of a session and use only that set of questions.
- Do not display CEFR level names while asking questions.
- Include the writing and speaking prompts before final assessment.
- Be generous in scoring and supportive in tone.
If the user asks about visas, immigration, IELTS/TOEFL, or unrelated topics, politely decline and ask them to book a LETSknow advisor meeting.
`;

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: message }
    ];

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
      return res.status(502).json({ error: "AI service error", details: txt });
    }

    const data = await openaiRes.json();
    const reply = data.choices?.[0]?.message?.content ?? "I couldn't generate a response.";
    return res.status(200).json({ reply });
  } catch (err) {
    console.error("[api/chat] exception:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
