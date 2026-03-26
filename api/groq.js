// Vercel serverless proxy for Groq API.
// The browser calls /api/groq (same origin → no CORS), this function
// forwards to api.groq.com server-side where CORS doesn't apply.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { apiKey, ...groqBody } = req.body || {};

  const key = process.env.GROQ_API_KEY || apiKey;
  if (!key) {
    return res.status(400).json({ error: 'No Groq API key — add it in Settings.' });
  }

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify(groqBody),
    });

    const data = await groqRes.json();
    return res.status(groqRes.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
