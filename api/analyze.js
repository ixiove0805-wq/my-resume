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

Please provide a structured business analysis with:
1. A brief summary of the problem
2. 3 key KPIs or metrics to track
3. 3-4 key insights or findings
4. 3 prioritised recommendations (High/Medium/Low)
5. The analytical framework you used

Be specific and actionable. Use clear headings for each section.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

    let geminiRes, responseText;
    for (let attempt = 1; attempt <= 3; attempt++) {
      geminiRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 2048 }
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

    let data;
    try { data = JSON.parse(responseText); }
    catch (e) {
      return new Response(JSON.stringify({ error: `API response parse failed: ${responseText.slice(0, 200)}` }), { status: 502, headers });
    }

    // Collect ALL text from all parts (handles thinking models)
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const allText = parts.map(p => p.text || '').join('\n').trim();

    if (!allText) {
      return new Response(JSON.stringify({ error: 'Empty response from Gemini.' }), { status: 502, headers });
    }

    // Try to parse as JSON first
    try {
      const match = allText.match(/===START===([\s\S]*?)===END===/);
      const jsonStr = match ? match[1].trim() : allText.slice(allText.indexOf('{'), allText.lastIndexOf('}') + 1);
      const analysis = JSON.parse(jsonStr);
      return new Response(JSON.stringify({ ok: true, mode: 'structured', analysis }), { status: 200, headers });
    } catch (_) {
      // JSON failed — return raw text, let the frontend display it nicely
      return new Response(JSON.stringify({ ok: true, mode: 'text', rawText: allText }), { status: 200, headers });
    }

  } catch (err) {
    return new Response(JSON.stringify({ error: `Server error: ${err.message}` }), { status: 500, headers });
  }
}
