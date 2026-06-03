/**
 * Schema discovery composable for the Elemental API.
 *
 * Fetches and caches the knowledge graph schema (entity types / flavors
 * and property definitions / PIDs). Handles the dual response shapes
 * returned by different schema endpoints and the fid/findex naming
 * inconsistency.
 *
 * Usage:
 *   const { flavors, properties, flavorByName, pidByName, refresh } = useElementalSchema();
 *   await refresh();                       // fetch once (cached after first call)
 *   const articleFid = flavorByName('article');
 *   const namePid = pidByName('name');     // typically 8
 */

import { useElementalClient } from '@yottagraph-app/elemental-api/client';

export interface SchemaFlavor {
    name: string;
    fid: number;
    [key: string]: any;
}

export interface SchemaProperty {
    name: string;
    pid: number;
    type?: string;
    [key: string]: any;
}

const _flavors = ref<SchemaFlavor[]>([]);
const _properties = ref<SchemaProperty[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
let fetchPromise: Promise<void> | null = null;

function normalizeSchema(res: any): { flavors: SchemaFlavor[]; properties: SchemaProperty[] } {
    const rawFlavors: any[] = res?.schema?.flavors ?? (res as any)?.flavors ?? [];
    const rawProps: any[] = res?.schema?.properties ?? (res as any)?.properties ?? [];

    const flavors = rawFlavors.map((f: any) => ({
        ...f,
        fid: f.fid ?? f.findex,
    }));

    const properties = rawProps.map((p: any) => ({
        ...p,
        pid: p.pid ?? p.pindex,
    }));

    return { flavors, properties };
}

export function useElementalSchema() {
    const client = useElementalClient();

    async function refresh(force = false): Promise<void> {
        if (_flavors.value.length && !force) return;
        if (fetchPromise && !force) return fetchPromise;

        loading.value = true;
        error.value = null;

        fetchPromise = (async () => {
            try {
                const res = await client.getSchema();
                const { flavors, properties } = normalizeSchema(res);
                _flavors.value = flavors;
                _properties.value = properties;
            } catch (e: any) {
                error.value = e.message || 'Failed to fetch schema';
                console.warn('[useElementalSchema] fetch failed:', error.value);
            } finally {
                loading.value = false;
                fetchPromise = null;
            }
        })();

        return fetchPromise;
    }

    function flavorByName(name: string): number | null {
        const f = _flavors.value.find((fl) => fl.name === name);
        return f?.fid ?? null;
    }

    function pidByName(name: string): number | null {
        const p = _properties.value.find((pr) => pr.name === name);
        return p?.pid ?? null;
    }

    function flavorName(fid: number): string | null {
        const f = _flavors.value.find((fl) => fl.fid === fid);
        return f?.name ?? null;
    }

    function propertyName(pid: number): string | null {
        const p = _properties.value.find((pr) => pr.pid === pid);
        return p?.name ?? null;
    }

    function propertiesForType(typeName: string): SchemaProperty[] {
        return _properties.value.filter((p) => {
            const domains: any[] = p.domains ?? p.domain ?? [];
            const fid = flavorByName(typeName);
            return !domains.length || (fid !== null && domains.includes(fid));
        });
    }

    return {
        flavors: readonly(_flavors),
        properties: readonly(_properties),
        loading: readonly(loading),
        error: readonly(error),
        refresh,
        flavorByName,
        pidByName,
        flavorName,
        propertyName,
        propertiesForType,
    };
}
