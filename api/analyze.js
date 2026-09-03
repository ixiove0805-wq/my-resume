export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `You are a senior business analyst. Return ONLY a JSON object with this exact structure:
{
  "summary": "One sentence summarising the business problem.",
  "kpis": [
    { "label": "KPI name", "value": "value or % change", "trend": "up" },
    { "label": "KPI name", "value": "value or % change", "trend": "down" },
    { "label": "KPI name", "value": "value or % change", "trend": "neutral" }
  ],
  "insights": [
    { "type": "warn", "text": "Key finding." },
    { "type": "info", "text": "Context or pattern." },
    { "type": "up",   "text": "Opportunity or positive signal." }
  ],
  "recommendations": [
    { "priority": "High",   "action": "Specific action", "impact": "Expected outcome" },
    { "priority": "High",   "action": "Specific action", "impact": "Expected outcome" },
    { "priority": "Medium", "action": "Specific action", "impact": "Expected outcome" }
  ],
  "framework": "Name of analytical framework used"
}
trend: up/down/neutral. type: up/warn/info. priority: High/Medium/Low.`;

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }});
  }

  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const body = await req.json();
    const { question, mode } = body;

    if (!question || question.trim().length < 5) {
      return new Response(JSON.stringify({ error: 'Please provide a more detailed question.' }), { status: 400, headers });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured on server.' }), { status: 500, headers });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{
          role: 'user',
          parts: [{ text: `Analysis mode: ${mode || 'Free-form'}\n\nQuestion: ${question.trim()}` }]
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json'
        }
      })
    });

    const responseText = await geminiRes.text();

    if (!geminiRes.ok) {
      return new Response(
        JSON.stringify({ error: `Gemini API error ${geminiRes.status}: ${responseText.slice(0, 300)}` }),
        { status: 502, headers }
      );
    }

    const data = JSON.parse(responseText);
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    if (!rawText) {
      return new Response(JSON.stringify({ error: 'Empty response from Gemini.' }), { status: 502, headers });
    }

    const analysis = JSON.parse(rawText);
    return new Response(JSON.stringify({ ok: true, analysis }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Server error: ${err.message}` }), { status: 500, headers });
  }
}
