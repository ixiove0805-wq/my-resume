export const config = { runtime: 'edge' };

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
      return new Response(JSON.stringify({ error: 'API key not configured.' }), { status: 500, headers });
    }

    const prompt = `You are a senior business analyst. The user asks: "${question.trim()}" (Analysis mode: ${mode || 'Free-form'})

Wrap your JSON response between ===START=== and ===END=== markers like this:

===START===
{
  "summary": "One sentence summary of the problem.",
  "kpis": [
    { "label": "KPI name", "value": "value or % change", "trend": "up" },
    { "label": "KPI name", "value": "value or % change", "trend": "down" },
    { "label": "KPI name", "value": "value or % change", "trend": "neutral" }
  ],
  "insights": [
    { "type": "warn", "text": "Key finding with specific detail." },
    { "type": "info", "text": "Context or pattern." },
    { "type": "up", "text": "Opportunity or positive signal." }
  ],
  "recommendations": [
    { "priority": "High", "action": "Specific action", "impact": "Expected outcome" },
    { "priority": "High", "action": "Specific action", "impact": "Expected outcome" },
    { "priority": "Medium", "action": "Specific action", "impact": "Expected outcome" }
  ],
  "framework": "Name of analytical framework used"
}
===END===

trend must be up/down/neutral. type must be up/warn/info. priority must be High/Medium/Low.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

    let geminiRes, responseText;
    for (let attempt = 1; attempt <= 3; attempt++) {
      geminiRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }
        })
      });
      responseText = await geminiRes.text();
      if (geminiRes.status !== 503) break;
      if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
    }

    if (!geminiRes.ok) {
      return new Response(
        JSON.stringify({ error: `Gemini error ${geminiRes.status}: ${responseText.slice(0, 300)}` }),
        { status: 502, headers }
      );
    }

    const data = JSON.parse(responseText);

    // Collect ALL text from all parts (handles thinking models)
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const allText = parts.map(p => p.text || '').join('\n');

    // Extract between ===START=== and ===END=== markers
    const match = allText.match(/===START===([\s\S]*?)===END===/);
    if (!match) {
      // Fallback: try to find { } in the text
      const start = allText.indexOf('{');
      const end = allText.lastIndexOf('}');
      if (start === -1 || end === -1 || end <= start) {
        return new Response(
          JSON.stringify({ error: `Could not extract JSON. Raw: ${allText.slice(0, 200)}` }),
          { status: 502, headers }
        );
      }
      const analysis = JSON.parse(allText.slice(start, end + 1));
      return new Response(JSON.stringify({ ok: true, analysis }), { status: 200, headers });
    }

    const analysis = JSON.parse(match[1].trim());
    return new Response(JSON.stringify({ ok: true, analysis }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Server error: ${err.message}` }), { status: 500, headers });
  }
}
