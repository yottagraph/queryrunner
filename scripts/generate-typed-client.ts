#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// This script shows how we could generate a fully typed client
// from the OpenAPI spec to avoid trial-and-error

const specPath = join(__dirname, '../query/api/specs/elemental-api-spec.json');
const spec = JSON.parse(readFileSync(specPath, 'utf-8'));

console.log('Analyzing API endpoints...\n');

// Extract endpoint information
const endpoints: any[] = [];

Object.entries(spec.paths).forEach(([path, methods]: [string, any]) => {
    Object.entries(methods).forEach(([method, details]: [string, any]) => {
        if (details.operationId) {
            // Find response schema
            const successResponse = details.responses['200'];
            let responseType = 'unknown';

            if (successResponse?.content?.['application/json']?.schema?.$ref) {
                const ref = successResponse.content['application/json'].schema.$ref;
                responseType = ref.split('/').pop();
            }

            endpoints.push({
                path,
                method: method.toUpperCase(),
                operationId: details.operationId,
                summary: details.summary,
                responseType,
                tags: details.tags || [],
            });
        }
    });
});

// Group by tags
const byTag: Record<string, any[]> = {};
endpoints.forEach((ep) => {
    ep.tags.forEach((tag: string) => {
        if (!byTag[tag]) byTag[tag] = [];
        byTag[tag].push(ep);
    });
});

// Output analysis
console.log('API Endpoints by Category:\n');

Object.entries(byTag).forEach(([tag, endpoints]) => {
    console.log(`## ${tag}`);
    endpoints.forEach((ep) => {
        console.log(`- ${ep.method} ${ep.path}`);
        console.log(`  Operation: ${ep.operationId}`);
        console.log(`  Returns: ${ep.responseType}`);
        console.log(`  ${ep.summary}\n`);
    });
});

console.log('\nTo make the API client more robust:');
console.log('1. Always use the typed response schemas from components/schemas');
console.log('2. The operationId tells you the intended use of each endpoint');
console.log("3. Check the tags to understand which API surface you're using");
console.log('4. Use TypeScript strict mode to catch type mismatches at compile time');
