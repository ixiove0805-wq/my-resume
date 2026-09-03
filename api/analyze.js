export const config = { runtime: 'edge' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const modeFrameworks = {
  'Sales Performance': 'sales performance diagnosis using revenue bridge, segment comparison, KPI decomposition and impact-effort prioritisation',
  'User Behaviour': 'user behaviour analysis using funnel thinking, cohort/segment comparison, sentiment signals and retention drivers',
  'Competitive Intel': 'competitive intelligence analysis using positioning comparison, feature gap mapping, user pain-point clustering and differentiation strategy',
  'Free-form': 'general business analysis using issue-tree framing, KPI mapping, root-cause hypotheses and prioritised next actions'
};

const responseSchema = {
  type: 'OBJECT',
  properties: {
    framework: { type: 'STRING' },
    summary: { type: 'STRING' },
    kpis: {
      type: 'ARRAY',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING' },
          value: { type: 'STRING' },
          trend: { type: 'STRING', enum: ['up', 'down', 'flat'] }
        },
        required: ['label', 'value', 'trend']
      }
    },
    insights: {
      type: 'ARRAY',
      minItems: 3,
      maxItems: 4,
      items: {
        type: 'OBJECT',
        properties: {
          type: { type: 'STRING', enum: ['up', 'warn', 'info'] },
          text: { type: 'STRING' }
        },
        required: ['type', 'text']
      }
    },
    recommendations: {
      type: 'ARRAY',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'OBJECT',
        properties: {
          priority: { type: 'STRING', enum: ['High', 'Medium', 'Low'] },
          action: { type: 'STRING' },
          impact: { type: 'STRING' },
          effort: { type: 'STRING', enum: ['Low', 'Medium', 'High'] },
          owner: { type: 'STRING' }
        },
        required: ['priority', 'action', 'impact', 'effort', 'owner']
      }
    },
    nextQuestions: {
      type: 'ARRAY',
      minItems: 2,
      maxItems: 4,
      items: { type: 'STRING' }
    }
  },
  required: ['framework', 'summary', 'kpis', 'insights', 'recommendations', 'nextQuestions']
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: corsHeaders });
}

function buildPrompt(question, mode) {
  const framework = modeFrameworks[mode] || modeFrameworks['Free-form'];
  return [
    'You are an AI Business Analyst Agent for a portfolio demo.',
    `Analysis mode: ${mode || 'Free-form'}. Use this framework: ${framework}.`,
    '',
    'Task:',
    'Turn the user question into a structured, specific and actionable business analysis.',
    'Do not invent exact source data that the user did not provide. If numbers are missing, mark assumptions clearly in the wording.',
    'Recommendations must be practical enough for a product/data/business team to act on.',
    '',
    `User question: ${question}`
  ].join('\n');
}

async function fetchWithRetry(url, body) {
  let lastText = '';
  let lastStatus = 500;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      lastStatus = res.status;
      lastText = await res.text();
      if (res.ok || ![429, 500, 502, 503, 504].includes(res.status)) {
        return { res, text: lastText };
      }
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, 700 * attempt));
    }
  }

  return {
    res: { ok: false, status: lastStatus },
    text: lastText
  };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const body = await req.json();
    const question = String(body.question || '').trim();
    const mode = String(body.mode || 'Free-form').trim();

    if (question.length < 8) {
      return json({ ok: false, error: 'Please provide a more detailed business question.' }, 400);
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return json({ ok: false, error: 'GEMINI_API_KEY is not configured.' }, 500);
    }

    const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: buildPrompt(question, mode) }] }],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema
      }
    };

    const { res, text } = await fetchWithRetry(url, requestBody);
    if (!res.ok) {
      return json({ ok: false, error: `Gemini error ${res.status}: ${text.slice(0, 240)}` }, 502);
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return json({ ok: false, error: `Gemini response parse failed: ${text.slice(0, 200)}` }, 502);
    }

    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const generatedText = parts.map(part => part.text || '').join('\n').trim();

    if (!generatedText) {
      return json({ ok: false, error: 'Empty response from Gemini.' }, 502);
    }

    try {
      const analysis = JSON.parse(generatedText);
      return json({ ok: true, mode: 'structured', analysis });
    } catch {
      return json({ ok: true, mode: 'text', rawText: generatedText });
    }
  } catch (err) {
    return json({ ok: false, error: `Server error: ${err.message}` }, 500);
  }
}

