import { unsealCookie } from '../../utils/cookies';
import { getRedis, toRedisKey } from '../../utils/redis';

export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const docPath = query.docPath as string;
    if (!docPath) return undefined;

    const cookieInfo = await unsealCookie(event);
    if (!cookieInfo?.user) return undefined;

    const redis = getRedis();
    if (!redis) return undefined;

    const key = toRedisKey(docPath);
    const fieldName = query.fieldName as string | undefined;

    if (fieldName) {
        const val = await redis.hget(key, fieldName);
        return val ?? undefined;
    }

    const doc = await redis.hgetall(key);
    if (!doc || Object.keys(doc).length === 0) return undefined;
    return doc;
});
