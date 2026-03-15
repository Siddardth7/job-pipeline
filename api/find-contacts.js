export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'SERPER_API_KEY not configured' });
  }

  const { company, role, count = 5 } = req.body || {};
  if (!company) {
    return res.status(400).json({ error: 'company is required' });
  }

  const query = `site:linkedin.com/in "${company}" (recruiter OR "talent acquisition" OR "hiring manager" OR "${role || ''}")`;

  try {
    const serperRes = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ q: query, num: Math.min(10, Math.max(3, count)) })
    });

    if (!serperRes.ok) {
      const errText = await serperRes.text();
      return res.status(serperRes.status).json({ error: `Serper error: ${errText}` });
    }

    const serperData = await serperRes.json();
    const results = serperData.organic || [];

    const contacts = results.map((r, i) => {
      // Parse LinkedIn title format: "FirstName LastName - Title - Company | LinkedIn"
      const titleParts = (r.title || '').split(' - ');
      const name = titleParts[0]?.replace(' | LinkedIn', '').trim() || `Contact ${i+1}`;
      const title = titleParts[1]?.trim() || '';
      const titleLower = title.toLowerCase();

      let type = 'HR';
      if (titleLower.includes('recruiter') || titleLower.includes('talent acquisition') || titleLower.includes('recruiting')) {
        type = 'Recruiter';
      } else if (titleLower.includes('vp') || titleLower.includes('vice president') || titleLower.includes('director') || titleLower.includes('president') || titleLower.includes('ceo') || titleLower.includes('cto') || titleLower.includes('coo')) {
        type = 'Executive';
      } else if (titleLower.includes('engineer') || titleLower.includes('manager') || titleLower.includes('lead') || titleLower.includes('analyst') || titleLower.includes('scientist')) {
        type = 'Peer';
      }

      return {
        id: `c${Date.now()}-${i}`,
        name,
        title,
        type,
        company,
        linkedin_url: r.link || '',
        email: '',
        why: (r.snippet || '').slice(0, 100)
      };
    });

    return res.status(200).json(contacts);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
