<template>Never rendered...</template>

<script setup lang="ts">
    // Using named middleware when we get a hit on this page:
    // https://nuxt.com/docs/examples/routing/middleware

    definePageMeta({
        middleware: 'logout',
    });
</script>
