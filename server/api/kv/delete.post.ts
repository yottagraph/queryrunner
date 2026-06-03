import { unsealCookie } from '../../utils/cookies';
import { getRedis, toRedisKey } from '../../utils/redis';

export default defineEventHandler(async (event) => {
    const body = await readBody(event);

    const cookieInfo = await unsealCookie(event);
    if (!cookieInfo?.user) return;

    const redis = getRedis();
    if (!redis) return;

    const key = toRedisKey(body.path);
    await redis.del(key);
});
