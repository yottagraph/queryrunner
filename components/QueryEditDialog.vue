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
            <v-textarea
                v-model="form.question"
                label="Question (plaintext)"
                placeholder="e.g. What is the official name of Apple?"
                rows="2"
                auto-grow
                density="comfortable"
                hide-details="auto"
                class="mb-3"
            />
            <v-text-field
                v-model="form.name"
                label="Label (optional)"
                placeholder="Short name for tables — defaults to the question"
                density="comfortable"
                hide-details="auto"
                class="mb-3"
            />
            <v-text-field
                v-model="form.description"
                label="Notes (optional)"
                density="comfortable"
                hide-details="auto"
                class="mb-4"
            />

            <div class="section-label">Expected answer (for pass/fail judging)</div>
            <v-select
                v-model="form.kind"
                :items="kindOptions"
                item-title="label"
                item-value="value"
                label="Answer type"
                density="comfortable"
                hide-details
                class="mb-3"
            />

            <template v-if="form.kind === 'string'">
                <v-select
                    v-model="form.stringMatch"
                    :items="stringMatchOptions"
                    item-title="label"
                    item-value="value"
                    label="Match"
                    density="comfortable"
                    hide-details
                    class="mb-3"
                />
                <v-text-field
                    v-model="form.stringValue"
                    label="Expected text"
                    placeholder="Apple Inc."
                    density="comfortable"
                    hide-details="auto"
                />
            </template>

            <template v-else-if="form.kind === 'number'">
                <v-text-field
                    v-model.number="form.numberValue"
                    type="number"
                    label="Expected number"
                    density="comfortable"
                    hide-details="auto"
                    class="mb-3"
                />
                <v-text-field
                    v-model.number="form.numberTolerance"
                    type="number"
                    label="Tolerance (± allowed difference, optional)"
                    density="comfortable"
                    hide-details="auto"
                />
            </template>

            <template v-else-if="form.kind === 'number_range'">
                <v-text-field
                    v-model.number="form.rangeMin"
                    type="number"
                    label="Minimum (optional)"
                    density="comfortable"
                    hide-details="auto"
                    class="mb-3"
                />
                <v-text-field
                    v-model.number="form.rangeMax"
                    type="number"
                    label="Maximum (optional)"
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
    import type { AnswerExpectation, QueryDef } from '~/types/queryrunner';

    const props = defineProps<{
        existing?: QueryDef | null;
    }>();

    const emit = defineEmits<{
        close: [];
        save: [
            payload: {
                name: string;
                description: string;
                question: string;
                expected: AnswerExpectation;
            },
        ];
    }>();

    const isEdit = computed(() => !!props.existing);

    const kindOptions = [
        { label: 'Text', value: 'string' },
        { label: 'Number', value: 'number' },
        { label: 'Number range', value: 'number_range' },
    ] as const;

    const stringMatchOptions = [
        { label: 'Contains (case-insensitive)', value: 'icontains' },
        { label: 'Equals (case-insensitive)', value: 'iexact' },
        { label: 'Equals (exact)', value: 'exact' },
    ] as const;

    interface Form {
        name: string;
        description: string;
        question: string;
        kind: 'string' | 'number' | 'number_range';
        stringValue: string;
        stringMatch: 'icontains' | 'iexact' | 'exact';
        numberValue: number | null;
        numberTolerance: number | null;
        rangeMin: number | null;
        rangeMax: number | null;
    }

    function blankForm(): Form {
        return {
            name: '',
            description: '',
            question: '',
            kind: 'string',
            stringValue: '',
            stringMatch: 'icontains',
            numberValue: null,
            numberTolerance: null,
            rangeMin: null,
            rangeMax: null,
        };
    }

    const form = reactive<Form>(blankForm());

    watch(
        () => props.existing,
        (q) => {
            Object.assign(form, blankForm());
            if (!q) return;
            form.name = q.name ?? '';
            form.description = q.description ?? '';
            form.question = q.question;
            const exp = q.expected;
            form.kind = exp.kind;
            if (exp.kind === 'string') {
                form.stringValue = exp.value;
                form.stringMatch = exp.match;
            } else if (exp.kind === 'number') {
                form.numberValue = exp.value;
                form.numberTolerance = exp.tolerance ?? null;
            } else if (exp.kind === 'number_range') {
                form.rangeMin = exp.min ?? null;
                form.rangeMax = exp.max ?? null;
            }
        },
        { immediate: true }
    );

    const canSave = computed(() => {
        if (!form.question.trim()) return false;
        if (form.kind === 'string' && !form.stringValue.trim()) return false;
        if (form.kind === 'number' && typeof form.numberValue !== 'number') return false;
        if (
            form.kind === 'number_range' &&
            typeof form.rangeMin !== 'number' &&
            typeof form.rangeMax !== 'number'
        )
            return false;
        return true;
    });

    function buildExpected(): AnswerExpectation {
        if (form.kind === 'string') {
            return { kind: 'string', value: form.stringValue.trim(), match: form.stringMatch };
        }
        if (form.kind === 'number') {
            const exp: AnswerExpectation = { kind: 'number', value: form.numberValue as number };
            if (typeof form.numberTolerance === 'number' && !Number.isNaN(form.numberTolerance)) {
                exp.tolerance = form.numberTolerance;
            }
            return exp;
        }
        const exp: AnswerExpectation = { kind: 'number_range' };
        if (typeof form.rangeMin === 'number' && !Number.isNaN(form.rangeMin))
            exp.min = form.rangeMin;
        if (typeof form.rangeMax === 'number' && !Number.isNaN(form.rangeMax))
            exp.max = form.rangeMax;
        return exp;
    }

    function onSave() {
        if (!canSave.value) return;
        emit('save', {
            name: form.name.trim(),
            description: form.description.trim(),
            question: form.question.trim(),
            expected: buildExpected(),
        });
    }
</script>

<style scoped>
    .section-label {
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--lv-silver, #94a3b8);
        margin-bottom: 10px;
    }
</style>
