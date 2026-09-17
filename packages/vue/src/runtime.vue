<script setup>
const { x, a, s } = defineProps(['x', 'a', 's'])
</script>

<template>
    <template v-for="(fragment, i) in x">
        <template v-if="typeof fragment === 'string'">
            {{fragment}}
        </template>
        <template v-else-if="typeof fragment === 'number'">
            <template v-if="i >= s">
                {{a[fragment]}}
            </template>
        </template>
        <slot v-else :name="fragment[0]" :_w_ctx_="fragment"/>
    </template>
</template>
