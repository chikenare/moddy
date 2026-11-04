<script setup lang="ts">
import OverviewPanel from '@/components/OverviewPanel.vue'
</script>

<template>
  <section class="space-y-6">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight">Overview</h1>
      <p class="text-sm text-muted-foreground">What happened across all your groups.</p>
    </div>
    <OverviewPanel />
  </section>
</template>
