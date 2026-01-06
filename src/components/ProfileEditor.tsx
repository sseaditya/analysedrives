import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Camera, Loader2, User } from "lucide-react";
import { toast } from "sonner";

interface Profile {
    id: string;
    display_name: string | null;
    car: string | null;
    avatar_url: string | null;
}

interface ProfileEditorProps {
    children: React.ReactNode;
    onProfileUpdate?: (profile: Profile) => void;
}

const ProfileEditor = ({ children, onProfileUpdate }: ProfileEditorProps) => {
    const { user } = useAuth();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const [displayName, setDisplayName] = useState("");
    const [car, setCar] = useState("");
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    // Fetch profile when dialog opens
    useEffect(() => {
        if (open && user) {
            fetchProfile();
        }
    }, [open, user]);

    const fetchProfile = async () => {
        if (!user) return;
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from("profiles")
                .select("id, display_name, car, avatar_url")
                .eq("id", user.id)
                .single();

            if (error && error.code !== "PGRST116") {
                // PGRST116 = no rows returned (profile doesn't exist yet)
                throw error;
            }

            if (data) {
                setDisplayName(data.display_name || "");
                setCar(data.car || "");
                setAvatarUrl(data.avatar_url);
            }
        } catch (err) {
            console.error("Error fetching profile:", err);
            toast.error("Failed to load profile");
        } finally {
            setLoading(false);
        }
    };

    const handleAvatarClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        if (!file.type.startsWith("image/")) {
            toast.error("Please select an image file");
            return;
        }

        // Validate file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            toast.error("Image must be less than 5MB");
            return;
        }

        setAvatarFile(file);

        // Create preview
        const reader = new FileReader();
        reader.onload = (e) => {
            setAvatarPreview(e.target?.result as string);
        };
        reader.readAsDataURL(file);
    };

    const handleSave = async () => {
        if (!user) return;
        setSaving(true);

        try {
            let finalAvatarUrl = avatarUrl;

            // Upload new avatar if selected
            if (avatarFile) {
                const fileExt = avatarFile.name.split(".").pop();
                const fileName = `${user.id}/avatar.${fileExt}`;

                // Upload to storage
                const { error: uploadError } = await supabase.storage
                    .from("avatars")
                    .upload(fileName, avatarFile, { upsert: true });

                if (uploadError) throw uploadError;

                // Get public URL
                const { data: urlData } = supabase.storage
                    .from("avatars")
                    .getPublicUrl(fileName);

                finalAvatarUrl = `${urlData.publicUrl}?t=${Date.now()}`; // Cache bust
            }

            // Upsert profile
            const { data, error } = await supabase
                .from("profiles")
                .upsert({
                    id: user.id,
                    display_name: displayName.trim() || null,
                    car: car.trim() || null,
                    avatar_url: finalAvatarUrl,
                    updated_at: new Date().toISOString(),
                })
                .select()
                .single();

            if (error) throw error;

            toast.success("Profile updated!");
            setAvatarUrl(finalAvatarUrl);
            setAvatarFile(null);
            setAvatarPreview(null);
            setOpen(false);

            if (onProfileUpdate && data) {
                onProfileUpdate(data);
            }
        } catch (err) {
            console.error("Error saving profile:", err);
            toast.error("Failed to save profile");
        } finally {
            setSaving(false);
        }
    };

    const currentAvatar = avatarPreview || avatarUrl || user?.user_metadata?.avatar_url;
    const initials = (displayName || user?.user_metadata?.full_name || user?.email || "U")
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Edit Profile</DialogTitle>
                    <DialogDescription>
                        Customize your display name, car, and profile picture.
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <div className="space-y-6 py-4">
                        {/* Avatar Upload */}
                        <div className="flex flex-col items-center gap-3">
                            <div
                                className="relative group cursor-pointer"
                                onClick={handleAvatarClick}
                            >
                                <Avatar className="w-24 h-24 border-2 border-border">
                                    <AvatarImage src={currentAvatar} />
                                    <AvatarFallback className="text-lg bg-primary/10">
                                        {initials}
                                    </AvatarFallback>
                                </Avatar>
                                <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <Camera className="w-6 h-6 text-white" />
                                </div>
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleFileChange}
                            />
                            <p className="text-xs text-muted-foreground">
                                Click to upload a new photo
                            </p>
                        </div>

                        {/* Display Name */}
                        <div className="space-y-2">
                            <Label htmlFor="displayName">Display Name</Label>
                            <Input
                                id="displayName"
                                placeholder="Your name"
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                            />
                        </div>

                        {/* Car */}
                        <div className="space-y-2">
                            <Label htmlFor="car">Car</Label>
                            <Input
                                id="car"
                                placeholder="e.g. BMW M3, Tesla Model 3"
                                value={car}
                                onChange={(e) => setCar(e.target.value)}
                            />
                        </div>
                    </div>
                )}

                <DialogFooter>
                    <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={loading || saving}>
                        {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Save Changes
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default ProfileEditor;
