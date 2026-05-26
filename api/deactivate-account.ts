import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

type ActivityRow = {
    file_path: string | null;
};

type StorageWarning = {
    bucket: string;
    path?: string;
    message: string;
};

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const getBearerToken = (authorizationHeader?: string | string[]) => {
    if (Array.isArray(authorizationHeader)) return null;
    if (!authorizationHeader?.startsWith('Bearer ')) return null;
    return authorizationHeader.slice('Bearer '.length).trim() || null;
};

const uniquePaths = (paths: Array<string | null | undefined>) => {
    return Array.from(new Set(paths.filter((path): path is string => Boolean(path))));
};

const listStoragePaths = async (
    supabaseAdmin: ReturnType<typeof createClient>,
    bucket: string,
    folder: string,
) => {
    const allPaths: string[] = [];
    const stack = [folder];

    while (stack.length > 0) {
        const currentFolder = stack.pop()!;
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            const { data, error } = await supabaseAdmin.storage
                .from(bucket)
                .list(currentFolder, { limit: 1000, offset });

            if (error) throw error;

            const items = data || [];
            for (const item of items) {
                const path = currentFolder ? `${currentFolder}/${item.name}` : item.name;
                if (item.id === null) {
                    stack.push(path);
                } else {
                    allPaths.push(path);
                }
            }

            hasMore = items.length === 1000;
            offset += 1000;
        }
    }

    return allPaths;
};

const removeStoragePaths = async (
    supabaseAdmin: ReturnType<typeof createClient>,
    bucket: string,
    paths: string[],
) => {
    const warnings: StorageWarning[] = [];

    for (let i = 0; i < paths.length; i += 100) {
        const batch = paths.slice(i, i + 100);
        if (batch.length === 0) continue;

        const { error } = await supabaseAdmin.storage.from(bucket).remove(batch);
        if (error) {
            warnings.push({
                bucket,
                message: error.message,
            });
        }
    }

    return warnings;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'Authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const token = getBearerToken(req.headers.authorization);
    if (!token) {
        return res.status(401).json({ error: 'Missing authorization token' });
    }

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
        return res.status(500).json({ error: 'Server misconfiguration' });
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });

    const { data: userData, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !userData.user) {
        return res.status(401).json({ error: 'Invalid authorization token' });
    }

    const userId = userData.user.id;
    const warnings: StorageWarning[] = [];

    try {
        const { data: activities, error: activitiesError } = await supabaseAdmin
            .from('activities')
            .select('file_path')
            .eq('user_id', userId);

        if (activitiesError) throw activitiesError;

        const activityRows = (activities || []) as ActivityRow[];
        const activityFilePaths = uniquePaths(
            activityRows.flatMap((activity) => {
                if (!activity.file_path) return [];
                return [
                    activity.file_path,
                    activity.file_path.replace(/\.gpx$/i, '.processed.json'),
                ];
            }),
        );

        let gpxFolderPaths: string[] = [];
        let avatarFolderPaths: string[] = [];

        try {
            gpxFolderPaths = await listStoragePaths(supabaseAdmin, 'gpx-files', userId);
        } catch (error) {
            warnings.push({
                bucket: 'gpx-files',
                path: userId,
                message: error instanceof Error ? error.message : 'Failed to list user GPX files',
            });
        }

        try {
            avatarFolderPaths = await listStoragePaths(supabaseAdmin, 'avatars', userId);
        } catch (error) {
            warnings.push({
                bucket: 'avatars',
                path: userId,
                message: error instanceof Error ? error.message : 'Failed to list user avatars',
            });
        }

        warnings.push(
            ...(await removeStoragePaths(
                supabaseAdmin,
                'gpx-files',
                uniquePaths([...activityFilePaths, ...gpxFolderPaths]),
            )),
            ...(await removeStoragePaths(supabaseAdmin, 'avatars', uniquePaths(avatarFolderPaths))),
        );

        const { error: activitiesDeleteError } = await supabaseAdmin
            .from('activities')
            .delete()
            .eq('user_id', userId);
        if (activitiesDeleteError) throw activitiesDeleteError;

        const { error: profileDeleteError } = await supabaseAdmin
            .from('profiles')
            .delete()
            .eq('id', userId);
        if (profileDeleteError) throw profileDeleteError;

        const { error: userDeleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
        if (userDeleteError) throw userDeleteError;

        return res.status(200).json({ ok: true, warnings });
    } catch (error) {
        console.error('Account deactivation failed:', error);
        return res.status(500).json({
            error: 'Failed to deactivate account',
            warnings,
        });
    }
}
