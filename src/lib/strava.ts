
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
// NOTE: CLIENT_SECRET should NOT be used on the frontend anymore.
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
    // Call our own secure backend endpoint instead of Strava directly
    const response = await fetch('/api/exchange-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
    });

    if (!response.ok) {
        let errorMessage = 'Failed to exchange token';
        try {
            const err = await response.json();
            errorMessage = err.error || errorMessage;
        } catch (e) {
            // ignore JSON parse error
        }
        throw new Error(errorMessage);
    }
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
