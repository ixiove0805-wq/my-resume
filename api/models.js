export const config = { runtime: 'edge' };

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'GET') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  const hasKey = Boolean(process.env.GEMINI_API_KEY);
  return json({
    ok: hasKey,
    model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
    status: hasKey ? 'configured' : 'missing_api_key'
  }, hasKey ? 200 : 500);
}
