import { unsealCookie } from '../../utils/cookies';
import { getRedis, toRedisKey, docIdFromKey } from '../../utils/redis';

export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const collectionPath = query.collectionPath as string;
    if (!collectionPath) return [];

    const cookieInfo = await unsealCookie(event);
    if (!cookieInfo?.user) return [];

    const redis = getRedis();
    if (!redis) return [];

    const prefix = toRedisKey(collectionPath);
    const docIds: string[] = [];

    let cursor = 0;
    do {
        const [nextCursor, keys] = await redis.scan(cursor, { match: `${prefix}:*`, count: 100 });
        cursor = typeof nextCursor === 'string' ? parseInt(nextCursor) : nextCursor;
        for (const key of keys) {
            const id = docIdFromKey(key as string, prefix);
            if (id && !docIds.includes(id)) docIds.push(id);
        }
    } while (cursor !== 0);

    return docIds;
});
