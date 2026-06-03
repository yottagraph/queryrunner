<template>
    <v-card min-width="560" max-width="720">
        <v-card-title class="d-flex align-center">
            <span>{{ isEdit ? 'Edit query' : 'New query' }}</span>
            <v-spacer />
            <v-btn icon variant="text" @click="$emit('close')">
                <v-icon>mdi-close</v-icon>
            </v-btn>
        </v-card-title>

        <v-divider />

        <v-card-text>
            <v-text-field
                v-model="form.name"
                label="Name"
                placeholder="e.g. Microsoft top match"
                density="comfortable"
                hide-details="auto"
                class="mb-3"
            />
            <v-text-field
                v-model="form.description"
                label="Description (optional)"
                density="comfortable"
                hide-details="auto"
                class="mb-3"
            />

            <v-select
                v-model="form.type"
                :items="typeOptions"
                item-title="label"
                item-value="value"
                label="Query type"
                density="comfortable"
                hide-details
                class="mb-3"
            />

            <template v-if="form.type === 'search'">
                <v-text-field
                    v-model="form.search.query"
                    label="Search string"
                    placeholder="Microsoft"
                    density="comfortable"
                    hide-details="auto"
                    class="mb-3"
                />
                <v-select
                    v-model="form.search.validatorMode"
                    :items="searchValidatorOptions"
                    item-title="label"
                    item-value="value"
                    label="Validation"
                    density="comfortable"
                    hide-details
                    class="mb-3"
                />
                <v-text-field
                    v-if="form.search.validatorMode !== 'has_match'"
                    v-model="form.search.expected"
                    label="Expected value"
                    :placeholder="searchExpectedPlaceholder"
                    density="comfortable"
                    hide-details="auto"
                />
            </template>

            <template v-else-if="form.type === 'property'">
                <v-text-field
                    v-model="form.property.entity"
                    label="Entity name"
                    placeholder="Microsoft"
                    density="comfortable"
                    hide-details="auto"
                    class="mb-3"
                />
                <v-text-field
                    v-model="form.property.property"
                    label="Property name"
                    placeholder="name, country, industry, ..."
                    density="comfortable"
                    hide-details="auto"
                    class="mb-3"
                />
                <v-select
                    v-model="form.property.validatorMode"
                    :items="propertyValidatorOptions"
                    item-title="label"
                    item-value="value"
                    label="Validation"
                    density="comfortable"
                    hide-details
                    class="mb-3"
                />
                <v-text-field
                    v-if="form.property.validatorMode !== 'not_null'"
                    v-model="form.property.expected"
                    label="Expected value"
                    density="comfortable"
                    hide-details="auto"
                />
            </template>

            <template v-else-if="form.type === 'linked_count'">
                <v-text-field
                    v-model="form.linked.entity"
                    label="Entity name"
                    placeholder="Microsoft"
                    density="comfortable"
                    hide-details="auto"
                    class="mb-3"
                />
                <v-select
                    v-model="form.linked.direction"
                    :items="[
                        { label: 'Incoming (linked → entity)', value: 'incoming' },
                        { label: 'Outgoing (entity → linked)', value: 'outgoing' },
                    ]"
                    item-title="label"
                    item-value="value"
                    label="Direction"
                    density="comfortable"
                    hide-details
                    class="mb-3"
                />
                <v-select
                    v-model="form.linked.validatorMode"
                    :items="linkedValidatorOptions"
                    item-title="label"
                    item-value="value"
                    label="Validation"
                    density="comfortable"
                    hide-details
                    class="mb-3"
                />
                <v-text-field
                    v-model.number="form.linked.expected"
                    type="number"
                    label="Expected count"
                    density="comfortable"
                    hide-details="auto"
                />
            </template>
        </v-card-text>

        <v-divider />

        <v-card-actions>
            <v-spacer />
            <v-btn variant="text" @click="$emit('close')">Cancel</v-btn>
            <v-btn color="primary" :disabled="!canSave" @click="onSave">
                {{ isEdit ? 'Save' : 'Add query' }}
            </v-btn>
        </v-card-actions>
    </v-card>
</template>

<script setup lang="ts">
    import { computed, reactive, watch } from 'vue';
    import type { QueryBody, QueryDef } from '~/types/queryrunner';

    const props = defineProps<{
        existing?: QueryDef | null;
    }>();

    const emit = defineEmits<{
        close: [];
        save: [payload: { name: string; description: string; body: QueryBody }];
    }>();

    const isEdit = computed(() => !!props.existing);

    const typeOptions = [
        { label: 'Entity search', value: 'search' },
        { label: 'Property value', value: 'property' },
        { label: 'Linked entity count', value: 'linked_count' },
    ] as const;

    const searchValidatorOptions = [
        { label: 'Top match name equals', value: 'top_name_equals' },
        { label: 'Top match NEID equals', value: 'top_neid_equals' },
        { label: 'Top match flavor equals', value: 'top_flavor_equals' },
        { label: 'Has at least one match', value: 'has_match' },
    ] as const;

    const propertyValidatorOptions = [
        { label: 'Equals', value: 'equals' },
        { label: 'Contains (case-insensitive)', value: 'contains' },
        { label: 'Is non-empty', value: 'not_null' },
    ] as const;

    const linkedValidatorOptions = [
        { label: 'Count ≥ expected', value: 'gte' },
        { label: 'Count = expected', value: 'equals' },
    ] as const;

    const searchExpectedPlaceholder = computed(() => {
        switch (form.search.validatorMode) {
            case 'top_name_equals':
                return 'Microsoft Corporation';
            case 'top_neid_equals':
                return '05867431084638762877';
            case 'top_flavor_equals':
                return 'organization';
            default:
                return '';
        }
    });

    interface Form {
        name: string;
        description: string;
        type: 'search' | 'property' | 'linked_count';
        search: {
            query: string;
            validatorMode:
                | 'top_name_equals'
                | 'top_neid_equals'
                | 'top_flavor_equals'
                | 'has_match';
            expected: string;
        };
        property: {
            entity: string;
            property: string;
            validatorMode: 'equals' | 'contains' | 'not_null';
            expected: string;
        };
        linked: {
            entity: string;
            direction: 'incoming' | 'outgoing';
            validatorMode: 'gte' | 'equals';
            expected: number;
        };
    }

    function blankForm(): Form {
        return {
            name: '',
            description: '',
            type: 'search',
            search: { query: '', validatorMode: 'top_name_equals', expected: '' },
            property: { entity: '', property: 'name', validatorMode: 'contains', expected: '' },
            linked: { entity: '', direction: 'incoming', validatorMode: 'gte', expected: 1 },
        };
    }

    const form = reactive<Form>(blankForm());

    watch(
        () => props.existing,
        (q) => {
            Object.assign(form, blankForm());
            if (!q) return;
            form.name = q.name;
            form.description = q.description ?? '';
            form.type = q.body.type;
            if (q.body.type === 'search') {
                form.search.query = q.body.query;
                form.search.validatorMode = q.body.validator.mode;
                form.search.expected =
                    'expected' in q.body.validator ? q.body.validator.expected : '';
            } else if (q.body.type === 'property') {
                form.property.entity = q.body.entity;
                form.property.property = q.body.property;
                form.property.validatorMode = q.body.validator.mode;
                form.property.expected =
                    'expected' in q.body.validator ? q.body.validator.expected : '';
            } else if (q.body.type === 'linked_count') {
                form.linked.entity = q.body.entity;
                form.linked.direction = q.body.direction;
                form.linked.validatorMode = q.body.validator.mode;
                form.linked.expected = q.body.validator.expected;
            }
        },
        { immediate: true }
    );

    const canSave = computed(() => {
        if (!form.name.trim()) return false;
        if (form.type === 'search') {
            if (!form.search.query.trim()) return false;
            if (form.search.validatorMode !== 'has_match' && !form.search.expected.trim())
                return false;
        }
        if (form.type === 'property') {
            if (!form.property.entity.trim()) return false;
            if (!form.property.property.trim()) return false;
            if (form.property.validatorMode !== 'not_null' && !form.property.expected.trim())
                return false;
        }
        if (form.type === 'linked_count') {
            if (!form.linked.entity.trim()) return false;
            if (typeof form.linked.expected !== 'number' || Number.isNaN(form.linked.expected))
                return false;
        }
        return true;
    });

    function buildBody(): QueryBody {
        if (form.type === 'search') {
            const validator =
                form.search.validatorMode === 'has_match'
                    ? { mode: 'has_match' as const }
                    : {
                          mode: form.search.validatorMode,
                          expected: form.search.expected.trim(),
                      };
            return { type: 'search', query: form.search.query.trim(), validator };
        }
        if (form.type === 'property') {
            const validator =
                form.property.validatorMode === 'not_null'
                    ? { mode: 'not_null' as const }
                    : {
                          mode: form.property.validatorMode,
                          expected: form.property.expected.trim(),
                      };
            return {
                type: 'property',
                entity: form.property.entity.trim(),
                property: form.property.property.trim(),
                validator,
            };
        }
        return {
            type: 'linked_count',
            entity: form.linked.entity.trim(),
            direction: form.linked.direction,
            validator: { mode: form.linked.validatorMode, expected: form.linked.expected },
        };
    }

    function onSave() {
        if (!canSave.value) return;
        emit('save', {
            name: form.name.trim(),
            description: form.description.trim(),
            body: buildBody(),
        });
    }
</script>
