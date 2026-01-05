
interface StravaActivity {
    id: number;
    name: string;
    distance: number;
    moving_time: number;
    total_elevation_gain: number;
    type: string;
    start_date: string;
    map: {
        summary_polyline: string;
    };
}

const CLIENT_ID = import.meta.env.VITE_STRAVA_CLIENT_ID;
const CLIENT_SECRET = import.meta.env.VITE_STRAVA_CLIENT_SECRET;
// Dynamic redirect URI based on current environment
const REDIRECT_URI = `${typeof window !== 'undefined' ? window.location.origin : ''}/strava-callback`;

export const initiateStravaAuth = () => {
    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'activity:read_all',
    });
    window.location.href = `https://www.strava.com/oauth/authorize?${params.toString()}`;
};

export const exchangeToken = async (code: string) => {
    const response = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code,
            grant_type: 'authorization_code',
        }),
    });

    if (!response.ok) throw new Error('Failed to exchange token');
    return response.json();
};

export const getActivities = async (accessToken: string) => {
    const response = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=30', {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error('Failed to fetch activities');
    return response.json() as Promise<StravaActivity[]>;
};

export const getActivityStreams = async (accessToken: string, activityId: number) => {
    // Requesting latlng, time, altitude (elevation)
    const response = await fetch(
        `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=latlng,time,altitude&key_by_type=true`,
        {
            headers: { Authorization: `Bearer ${accessToken}` },
        }
    );
    if (!response.ok) throw new Error('Failed to fetch activity streams');
    return response.json();
};
