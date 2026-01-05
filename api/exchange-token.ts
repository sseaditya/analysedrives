import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Allow CORS from your frontend domain
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*'); // Secure this for prod if possible
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { code } = req.body;
    if (!code) {
        return res.status(400).json({ error: 'Missing authorization code' });
    }

    const clientId = process.env.VITE_STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        return res.status(500).json({ error: 'Server misconfiguration: Missing Strava Credentials' });
    }

    try {
        const response = await fetch('https://www.strava.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: clientId,
                client_secret: clientSecret,
                code,
                grant_type: 'authorization_code',
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            return res.status(response.status).json(data);
        }
        return res.status(200).json(data);
    } catch (error) {
        console.error('Strava Token Exchange Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
