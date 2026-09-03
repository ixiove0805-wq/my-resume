export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `You are a senior business analyst. Respond with ONLY a valid JSON object, no other text before or after.

Return exactly this structure:
{
  "summary": "One sentence summarising the business problem and approach.",
  "kpis": [
    { "label": "Short KPI name", "value": "value or % change", "trend": "up" },
    { "label": "Short KPI name", "value": "value or % change", "trend": "down" },
    { "label": "Short KPI name", "value": "value or % change", "trend": "neutral" }
  ],
  "insights": [
    { "type": "warn", "text": "Key finding with specific detail." },
    { "type": "info", "text": "Context or pattern that explains the finding." },
    { "type": "up",   "text": "Opportunity or positive signal." }
  ],
  "recommendations": [
    { "priority": "High",   "action": "Specific action", "impact": "Expected outcome" },
    { "priority": "High",   "action": "Specific action", "impact": "Expected outcome" },
    { "priority": "Medium", "action": "Specific action", "impact": "Expected outcome" }
  ],
  "framework": "Name of analytical framework used"
}

Rules: trend must be up/down/neutral. type must be up/warn/info. priority must be High/Medium/Low. Output ONLY the raw JSON object.`;

// Try models in order until one works
const MODELS = [
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-1.5-pro',
];

async function callGemini(apiKey, model, question, mode) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: SYSTEM_PROMPT },
          { text: `Analysis mode: ${mode}\n\nBusiness question:\n${question}` }
        ]
      }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 }
    })
  });
  return res;
}

function extractJSON(text) {
  // Strip markdown code fences
  let cleaned = text.replace(/```json|```/g, '').trim();
  // Find first { and last } to extract JSON object
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }
  return JSON.parse(cleaned);
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    const body = await req.json();
    const { question, mode } = body;

    if (!question || question.trim().length < 5) {
      return new Response(JSON.stringify({ error: 'Please provide a more detailed question.' }), { status: 400, headers });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured.' }), { status: 500, headers });
    }

    let lastError = '';
    for (const model of MODELS) {
      try {
        const geminiRes = await callGemini(apiKey, model, question.trim(), mode || 'Free-form');

        if (!geminiRes.ok) {
          const errText = await geminiRes.text();
          lastError = `${model} ${geminiRes.status}: ${errText.slice(0, 100)}`;
          continue; // try next model
        }

        const data = await geminiRes.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

        if (!rawText) {
          lastError = `${model}: empty response`;
          continue;
        }

        const analysis = extractJSON(rawText);
        return new Response(JSON.stringify({ ok: true, analysis }), { status: 200, headers });

      } catch (e) {
        lastError = `${model}: ${e.message}`;
        continue; // try next model
      }
    }

    // All models failed
    return new Response(JSON.stringify({ error: `All models failed. Last error: ${lastError}` }), { status: 502, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Server error: ${err.message}` }), { status: 500, headers });
  }
}
