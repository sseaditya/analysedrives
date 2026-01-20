import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, RefreshCw } from "lucide-react";
import { initiateStravaAuth, getActivities, getActivityStreams } from "@/lib/strava";
import { GPXPoint, calculateStats, generatePreviewPolyline, generateProcessedTrack } from "@/utils/gpxParser";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

interface StravaImportProps {
    onImportComplete: () => void;
}

const createGPXContent = (points: GPXPoint[], activityName: string, startTime: string) => {
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="DrivenStat">
  <metadata>
    <name>${activityName}</name>
    <time>${startTime}</time>
  </metadata>
  <trk>
    <name>${activityName}</name>
    <trkseg>
      ${points.map(p => `
      <trkpt lat="${p.lat}" lon="${p.lon}">
        ${p.ele !== undefined ? `<ele>${p.ele}</ele>` : ''}
        <time>${p.time.toISOString()}</time>
      </trkpt>`).join('')}
    </trkseg>
  </trk>
</gpx>`;
};

export default function StravaImport({ onImportComplete }: StravaImportProps) {
    const { user } = useAuth();
    const { toast } = useToast();
    const [accessToken, setAccessToken] = useState<string | null>(localStorage.getItem("strava_access_token"));
    const [activities, setActivities] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [isImporting, setIsImporting] = useState(false);

    useEffect(() => {
        // If we have a token, fetch activities automatically
        if (accessToken) {
            fetchActivities();
        }
    }, [accessToken]);

    const fetchActivities = async () => {
        if (!accessToken) return;
        setIsLoading(true);
        try {
            const data = await getActivities(accessToken);
            // Filter only for Rides
            const rides = data.filter(activity => activity.type === 'Ride');
            setActivities(rides);
        } catch (error) {
            console.error(error);
            toast({ title: "Failed to fetch activities", description: "Your session may have expired.", variant: "destructive" });
            // Clear invalid token
            localStorage.removeItem("strava_access_token");
            setAccessToken(null);
        } finally {
            setIsLoading(false);
        }
    };

    const handleConnect = () => {
        initiateStravaAuth();
    };

    const handleImport = async () => {
        if (selectedIds.length === 0 || !user) return;
        setIsImporting(true);
        let successCount = 0;

        try {
            for (const id of selectedIds) {
                const activity = activities.find(a => a.id === id);
                if (!activity) continue;

                const streams = await getActivityStreams(accessToken!, id);

                // Convert Streams to GPXPoint[]
                const points: GPXPoint[] = [];
                const latlngs = streams.latlng?.data;
                const times = streams.time?.data;
                const alts = streams.altitude?.data;

                if (latlngs && times) {
                    const startDate = new Date(activity.start_date);
                    const startTime = startDate.getTime() / 1000; // seconds

                    for (let i = 0; i < latlngs.length; i++) {
                        // Strava time stream is usually seconds from start
                        const pointTime = new Date(activity.start_date);
                        pointTime.setSeconds(startDate.getSeconds() + times[i]);

                        points.push({
                            lat: latlngs[i][0],
                            lon: latlngs[i][1],
                            ele: alts ? alts[i] : undefined,
                            time: pointTime
                        });
                    }
                }

                if (points.length < 2) continue;

                // Generate Stats & Processed Track
                const processedTrack = generateProcessedTrack(points);
                const fileName = `${user.id}/strava_${id}_${Date.now()}.gpx`;

                // 1. Create and Upload GPX File
                try {
                    const gpxContent = createGPXContent(points, activity.name, activity.start_date);
                    const { error: uploadError } = await supabase.storage
                        .from('gpx-files')
                        .upload(fileName, new Blob([gpxContent], { type: 'text/xml' }));

                    if (uploadError) {
                        console.error(`Failed to upload GPX for ${activity.name}`, uploadError);
                        continue; // Skip DB insert if storage fails
                    }

                    // 1.5 Upload Processed JSON (Silence errors)
                    const processedFileName = fileName.replace(/\.gpx$/i, '') + '.processed.json';
                    await supabase.storage
                        .from('gpx-files')
                        .upload(processedFileName, new Blob([JSON.stringify(processedTrack)], { type: 'application/json' }));

                } catch (err) {
                    console.error("Error creating/uploading GPX", err);
                    continue;
                }

                // 2. Insert into DB
                const { error } = await supabase.from('activities').insert({
                    user_id: user.id,
                    title: activity.name,
                    file_path: fileName,
                    slug: null, // Let DB sequence handle it (or omit if default works)
                    stats: {
                        ...processedTrack.stats,
                        previewCoordinates: processedTrack.previewCoordinates
                    }
                });

                if (error) {
                    console.error("DB Insert Error", error);
                } else {
                    successCount++;
                }
            }

            toast({ title: "Import Complete", description: `Successfully imported ${successCount} activities.` });
            setSelectedIds([]);
            onImportComplete();

        } catch (error) {
            console.error("Import Error", error);
            toast({ title: "Import Failed", description: "An error occurred while importing.", variant: "destructive" });
        } finally {
            setIsImporting(false);
        }
    };

    if (!accessToken) {
        return (
            <div className="flex flex-col items-center justify-center p-8 space-y-4">
                <div className="bg-[#FC4C02] text-white p-3 rounded-full">
                    {/* Strava Icon placeholder */}
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="currentColor"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" /></svg>
                </div>
                <h3 className="text-lg font-bold">Connect with Strava</h3>
                <p className="text-sm text-muted-foreground text-center">Import your activities directly from Strava.</p>
                <Button onClick={handleConnect} className="bg-[#FC4C02] hover:bg-[#E34402] text-white">
                    Connect Strava
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="font-semibold">Recent Activities (Rides Only)</h3>
                <Button variant="ghost" size="sm" onClick={fetchActivities} disabled={isLoading}>
                    <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                </Button>
            </div>

            <ScrollArea className="h-[300px] border rounded-md p-4">
                <div className="space-y-2">
                    {activities.length === 0 && !isLoading ? (
                        <div className="text-center text-muted-foreground p-4">No recent cycling activities found.</div>
                    ) : (
                        activities.map(activity => (
                            <div key={activity.id} className="flex items-center space-x-3 p-2 hover:bg-muted/50 rounded-lg">
                                <Checkbox
                                    id={`ac-${activity.id}`}
                                    checked={selectedIds.includes(activity.id)}
                                    onCheckedChange={(checked) => {
                                        if (checked) setSelectedIds([...selectedIds, activity.id]);
                                        else setSelectedIds(selectedIds.filter(id => id !== activity.id));
                                    }}
                                />
                                <div className="flex-1">
                                    <label htmlFor={`ac-${activity.id}`} className="text-sm font-medium cursor-pointer block">
                                        {activity.name}
                                    </label>
                                    <div className="text-xs text-muted-foreground flex gap-2">
                                        <span>{new Date(activity.start_date).toLocaleDateString()}</span>
                                        <span>•</span>
                                        <span>{(activity.distance / 1000).toFixed(2)} km</span>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </ScrollArea>

            <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => { localStorage.removeItem("strava_access_token"); setAccessToken(null); }}>
                    Disconnect
                </Button>
                <Button onClick={handleImport} disabled={selectedIds.length === 0 || isImporting}>
                    {isImporting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Import Selected ({selectedIds.length})
                </Button>
            </div>
        </div>
    );
}
