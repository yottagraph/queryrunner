import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export default defineEventHandler(async (event) => {
    const url = decodeURIComponent(getRouterParam(event, 'url') || '');

    if (!url || !url.startsWith('https://')) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Invalid avatar URL',
        });
    }

    // Create a cache directory
    const cacheDir = join(process.cwd(), '.cache', 'avatars');
    if (!existsSync(cacheDir)) {
        mkdirSync(cacheDir, { recursive: true });
    }

    // Generate cache filename from URL hash
    const urlHash = createHash('md5').update(url).digest('hex');
    const cacheFile = join(cacheDir, `${urlHash}.jpg`);

    // Check if cached
    if (existsSync(cacheFile)) {
        const cachedImage = readFileSync(cacheFile);
        setHeader(event, 'Content-Type', 'image/jpeg');
        setHeader(event, 'Cache-Control', 'public, max-age=86400'); // Cache for 1 day
        return cachedImage;
    }

    try {
        // Fetch the image from Google
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; NewsUI/1.0)',
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch avatar: ${response.status}`);
        }

        const contentType = response.headers.get('content-type') || 'image/jpeg';
        const imageBuffer = Buffer.from(await response.arrayBuffer());

        // Cache the image
        writeFileSync(cacheFile, imageBuffer);

        // Return the image
        setHeader(event, 'Content-Type', contentType);
        setHeader(event, 'Cache-Control', 'public, max-age=86400');
        return imageBuffer;
    } catch (error) {
        console.error('Failed to fetch avatar:', error);
        throw createError({
            statusCode: 500,
            statusMessage: 'Failed to fetch avatar',
        });
    }
});
