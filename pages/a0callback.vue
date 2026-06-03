<template>Never rendered...</template>

<script setup>
    // Using named middleware when we get a hit on this page:
    // https://nuxt.com/docs/examples/routing/middleware

    definePageMeta({
        middleware: 'auth-callback',
    });
</script>
