import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import ProfileEditor from "@/components/ProfileEditor";
import { useAuth } from "@/contexts/AuthContext";

interface Profile {
    display_name: string | null;
    full_name: string | null;
    avatar_url: string | null;
}

const HeaderProfile = () => {
    const navigate = useNavigate();
    const { user, signOut } = useAuth();
    const [profile, setProfile] = useState<Profile | null>(null);
    const [isLoadingProfile, setIsLoadingProfile] = useState(false);

    useEffect(() => {
        if (!user) return;

        const fetchProfile = async () => {
            setIsLoadingProfile(true);
            try {
                const { data, error } = await supabase
                    .from('profiles')
                    .select('display_name, full_name, avatar_url')
                    .eq('id', user.id)
                    .single();

                if (error) {
                    console.error('Error fetching profile:', error);
                    return;
                }

                if (data) {
                    setProfile(data);
                }
            } catch (err) {
                console.error('Error:', err);
            } finally {
                setIsLoadingProfile(false);
            }
        };

        fetchProfile();
    }, [user]);

    const handleSignOut = async () => {
        try {
            await signOut();
            navigate("/");
        } catch (error) {
            console.error("Error signing out:", error);
        }
    };

    if (!user) return null;

    return (
        <div className="flex items-center gap-4 flex-shrink-0">
            <ProfileEditor onProfileUpdate={(updatedProfile: any) => setProfile(updatedProfile)}>
                <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">
                    {isLoadingProfile ? (
                        <>
                            <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
                            <div className="h-4 w-24 bg-muted animate-pulse rounded hidden md:block" />
                        </>
                    ) : (
                        <>
                            <img
                                src={profile?.avatar_url || user?.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.display_name || user?.user_metadata?.full_name || user?.email || "U")}&background=random`}
                                alt={profile?.display_name || user?.user_metadata?.full_name || user?.email || "User"}
                                className="w-8 h-8 rounded-full border border-border object-cover"
                                crossOrigin="anonymous"
                            />
                            <span className="text-sm font-medium hidden md:block">
                                {profile?.display_name || profile?.full_name || user?.user_metadata?.full_name || user?.email}
                            </span>
                        </>
                    )}
                </div>
            </ProfileEditor>
            <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-muted-foreground hover:text-destructive">
                <LogOut className="w-4 h-4 md:mr-2" />
                <span className="hidden md:inline">Sign Out</span>
            </Button>
        </div>
    );
};

export default HeaderProfile;
