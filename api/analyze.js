export const config = { runtime: 'edge' };

// ── System prompt ────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a senior business analyst with expertise in data analysis, KPI design, and strategic recommendations. 

When given a business question, you MUST respond with ONLY valid JSON — no markdown, no code fences, no explanation outside the JSON.

Return exactly this structure:
{
  "summary": "One clear sentence summarising the core business problem and your analytical approach.",
  "kpis": [
    { "label": "KPI name (short)", "value": "numeric value or % change", "trend": "up" },
    { "label": "KPI name (short)", "value": "numeric value or % change", "trend": "down" },
    { "label": "KPI name (short)", "value": "numeric value or % change", "trend": "neutral" }
  ],
  "insights": [
    { "type": "warn",  "text": "Key finding with specific data point." },
    { "type": "info",  "text": "Context or pattern that explains the finding." },
    { "type": "up",    "text": "Opportunity or positive signal identified." }
  ],
  "recommendations": [
    { "priority": "High",   "action": "Specific action to take", "impact": "Expected measurable outcome" },
    { "priority": "High",   "action": "Specific action to take", "impact": "Expected measurable outcome" },
    { "priority": "Medium", "action": "Specific action to take", "impact": "Expected measurable outcome" }
  ],
  "framework": "Name of the analytical framework applied (e.g. Root Cause Analysis, MECE, 5-Why, Pareto, etc.)"
}

Rules:
- kpis: exactly 3 items. trend must be one of: "up", "down", "neutral"
- insights: 3 to 4 items. type must be one of: "up", "warn", "info"
- recommendations: 2 to 4 items. priority must be: "High", "Medium", or "Low"
- Use real business reasoning. Be specific, not generic.
- If the question lacks data, make reasonable assumptions and flag them in insights.
- Output ONLY the raw JSON object. No other text.`;

// ── Handler ──────────────────────────────────────────────────
export default async function handler(req) {

  // Only allow POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // CORS headers — allow your Vercel domain
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  try {
    const body = await req.json();
    const { question, mode } = body;

    if (!question || question.trim().length < 5) {
      return new Response(
        JSON.stringify({ error: 'Please provide a more detailed question.' }),
        { status: 400, headers }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'API key not configured.' }),
        { status: 500, headers }
      );
    }

    // ── Call Gemini ──────────────────────────────────────────
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: SYSTEM_PROMPT },
              { text: `Analysis mode: ${mode || 'Free-form'}\n\nBusiness question:\n${question}` }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 1024,
        }
      })
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini error:', errText);
      return new Response(
        JSON.stringify({ error: 'AI service error. Please try again.' }),
        { status: 502, headers }
      );
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    // ── Parse the JSON from Gemini's response ────────────────
    // Strip any accidental code fences just in case
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    let analysis;
    try {
      analysis = JSON.parse(cleaned);
    } catch {
      console.error('JSON parse failed. Raw text:', rawText);
      return new Response(
        JSON.stringify({ error: 'Failed to parse AI response. Please try again.' }),
        { status: 500, headers }
      );
    }

    return new Response(JSON.stringify({ ok: true, analysis }), { status: 200, headers });

  } catch (err) {
    console.error('Handler error:', err);
    return new Response(
      JSON.stringify({ error: 'Unexpected error. Please try again.' }),
      { status: 500, headers }
    );
  }
}
