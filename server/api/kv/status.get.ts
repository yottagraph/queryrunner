import { isKVConfigured } from '../../utils/redis';

export default defineEventHandler(() => {
    return { available: isKVConfigured() };
});
