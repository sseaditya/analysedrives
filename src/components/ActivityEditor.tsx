import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Loader2, Globe, Lock, Gauge, MapPin, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface ActivityData {
    id: string;
    title: string;
    description: string | null;
    public: boolean;
    speed_cap: number | null;
    hide_radius: number | null;
    file_path?: string;
}

interface ActivityEditorProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    activity: ActivityData;
    onUpdate?: (updated: ActivityData) => void;
}

const ActivityEditor = ({ open, onOpenChange, activity, onUpdate }: ActivityEditorProps) => {
    const navigate = useNavigate();
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const [title, setTitle] = useState(activity.title || "");
    const [description, setDescription] = useState(activity.description || "");
    const [isPublic, setIsPublic] = useState(activity.public || false);
    const [speedCap, setSpeedCap] = useState(activity.speed_cap || 120);
    const [hideRadius, setHideRadius] = useState(activity.hide_radius || 5);

    // Reset state when dialog opens or activity changes
    useEffect(() => {
        if (open) {
            setTitle(activity.title || "");
            setDescription(activity.description || "");
            setIsPublic(activity.public || false);
            setSpeedCap(activity.speed_cap || 120);
            setHideRadius(activity.hide_radius || 5);
        }
    }, [open, activity]);

    const handleSave = async () => {
        if (!title.trim()) {
            toast.error("Title is required");
            return;
        }

        setSaving(true);
        try {
            const { error } = await supabase
                .from("activities")
                .update({
                    title: title.trim(),
                    description: description.trim() || null,
                    public: isPublic,
                    speed_cap: isPublic ? speedCap : null,
                    hide_radius: isPublic ? hideRadius : null,
                })
                .eq("id", activity.id);

            if (error) throw error;

            toast.success("Activity updated!");
            onOpenChange(false);

            if (onUpdate) {
                onUpdate({
                    ...activity,
                    title: title.trim(),
                    description: description.trim() || null,
                    public: isPublic,
                    speed_cap: isPublic ? speedCap : null,
                    hide_radius: isPublic ? hideRadius : null,
                });
            }
        } catch (err) {
            console.error("Error saving activity:", err);
            toast.error("Failed to save changes");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!window.confirm("Are you sure you want to delete this activity? This cannot be undone.")) return;

        setDeleting(true);
        try {
            // 1. Delete file from Storage (if path exists)
            if (activity.file_path) {
                const { error: storageError } = await supabase.storage
                    .from('gpx-files')
                    .remove([activity.file_path]);

                if (storageError) console.error("Storage delete error:", storageError);
            }

            // 2. Delete record from Table
            const { error: dbError } = await supabase
                .from('activities')
                .delete()
                .eq('id', activity.id);

            if (dbError) throw dbError;

            toast.success("Activity deleted");
            onOpenChange(false);
            navigate("/dashboard");

        } catch (err) {
            console.error("Error deleting activity:", err);
            toast.error("Failed to delete activity");
        } finally {
            setDeleting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md z-[2001]">
                <DialogHeader>
                    <DialogTitle>Edit Activity</DialogTitle>
                    <DialogDescription>
                        Update details and visibility settings.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    {/* Title */}
                    <div className="space-y-2">
                        <Label htmlFor="title">Title</Label>
                        <Input
                            id="title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Activity Title"
                        />
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                        <Label htmlFor="description">Description</Label>
                        <Textarea
                            id="description"
                            placeholder="Add a description..."
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={3}
                            className="resize-none"
                        />
                    </div>

                    {/* Public Toggle */}
                    <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border border-border">
                        <div className="flex items-center gap-3">
                            {isPublic ? (
                                <Globe className="w-5 h-5 text-green-500" />
                            ) : (
                                <Lock className="w-5 h-5 text-muted-foreground" />
                            )}
                            <div>
                                <p className="font-medium text-sm">
                                    {isPublic ? "Public" : "Private"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {isPublic
                                        ? "Anyone with the link can view"
                                        : "Only you can see this activity"}
                                </p>
                            </div>
                        </div>
                        <Switch
                            checked={isPublic}
                            onCheckedChange={setIsPublic}
                        />
                    </div>

                    {/* Hide Radius (only when public) */}
                    {isPublic && (
                        <div className="space-y-4 p-4 rounded-lg bg-red-500/10 border border-red-500/30 animate-in fade-in slide-in-from-top-2">
                            <div className="flex items-center gap-2">
                                <MapPin className="w-4 h-4 text-red-500" />
                                <Label className="text-red-500 font-medium">
                                    Hide Start/End Location
                                </Label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Hide the first and last {hideRadius}km of your route.
                            </p>
                            <div className="flex items-center gap-4">
                                <Slider
                                    value={[hideRadius]}
                                    onValueChange={([val]) => setHideRadius(val)}
                                    min={1}
                                    max={10}
                                    step={1}
                                    className="flex-1"
                                />
                                <span className="text-sm font-mono font-bold text-red-500 min-w-[60px]">
                                    {hideRadius} km
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Speed Cap (only when public) */}
                    {isPublic && (
                        <div className="space-y-4 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 animate-in fade-in slide-in-from-top-2">
                            <div className="flex items-center gap-2">
                                <Gauge className="w-4 h-4 text-amber-500" />
                                <Label className="text-amber-500 font-medium">
                                    Speed Cap for Public Viewers
                                </Label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Limit the maximum speed shown to public viewers.
                            </p>
                            <div className="flex items-center gap-4">
                                <Slider
                                    value={[speedCap]}
                                    onValueChange={([val]) => setSpeedCap(val)}
                                    min={40}
                                    max={200}
                                    step={10}
                                    className="flex-1"
                                />
                                <span className="text-sm font-mono font-bold text-amber-500 min-w-[60px]">
                                    {speedCap} km/h
                                </span>
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter className="flex sm:justify-between items-center gap-4">
                    <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleDelete}
                        disabled={saving || deleting}
                        className="mr-auto"
                    >
                        {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                        Delete
                    </Button>
                    <div className="flex gap-2">
                        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving || deleting}>
                            Cancel
                        </Button>
                        <Button onClick={handleSave} disabled={saving || deleting}>
                            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            Save
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default ActivityEditor;
