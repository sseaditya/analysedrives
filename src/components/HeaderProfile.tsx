import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import ProfileEditor from "@/components/ProfileEditor";
import { useAuth } from "@/contexts/AuthContext";

interface Profile {
    display_name: string | null;
    full_name: string | null;
    avatar_url: string | null;
}

const HeaderProfile = () => {
    const { user } = useAuth();
    // Initialize with user_metadata to prevent stutter
    const [profile, setProfile] = useState<Profile | null>(() => {
        if (!user) return null;
        return {
            display_name: user.user_metadata?.full_name || user.user_metadata?.display_name || null,
            full_name: user.user_metadata?.full_name || null,
            avatar_url: user.user_metadata?.avatar_url || null
        };
    });
    const [isLoadingProfile, setIsLoadingProfile] = useState(false);

    useEffect(() => {
        if (!user) return;

        const fetchProfile = async () => {
            // Only show loading if we don't have partial data
            if (!profile) setIsLoadingProfile(true);

            try {
                const { data, error } = await supabase
                    .from('profiles')
                    .select('display_name, full_name, avatar_url')
                    .eq('id', user.id)
                    .single();

                if (error) {
                    // If error, we still have user_metadata fallback
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

    if (!user) return null;

    return (
        <div className="flex items-center gap-4 flex-shrink-0">
            <ProfileEditor onProfileUpdate={(updatedProfile: any) => setProfile(updatedProfile)}>
                <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">
                    {isLoadingProfile && !profile ? (
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
        </div>
    );
};

export default HeaderProfile;
