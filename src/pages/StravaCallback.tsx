import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { exchangeToken } from '@/lib/strava';
import { useToast } from '@/components/ui/use-toast';

const StravaCallback = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { toast } = useToast();
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    useEffect(() => {
        if (error) {
            toast({
                title: "Strava Connection Failed",
                description: "You denied access or an error occurred.",
                variant: "destructive"
            });
            navigate('/dashboard');
            return;
        }

        if (code) {
            handleAuth(code);
        }
    }, [code, error]);

    const handleAuth = async (authCode: string) => {
        try {
            const data = await exchangeToken(authCode);
            // Store token in localStorage for specific user session reuse or passing to component
            // For now, we might just store it temporarily or pass it via state
            localStorage.setItem('strava_access_token', data.access_token);

            toast({
                title: "Connected to Strava",
                description: "You can now import your activities.",
            });
            navigate('/dashboard?strava=connected');
        } catch (err) {
            console.error(err);
            toast({
                title: "Connection Failed",
                description: "Failed to exchange token with Strava.",
                variant: "destructive"
            });
            navigate('/dashboard');
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-background">
            <div className="text-center space-y-4">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
                <p className="text-muted-foreground">Connecting to Strava...</p>
            </div>
        </div>
    );
};

export default StravaCallback;
