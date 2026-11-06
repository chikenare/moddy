<script setup lang="ts">
import OverviewPanel from '@/components/OverviewPanel.vue'
</script>

<template>
  <section class="space-y-6">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight">{{ $t('overview.title') }}</h1>
      <p class="text-sm text-muted-foreground">{{ $t('overview.subtitle') }}</p>
    </div>
    <OverviewPanel />
  </section>
</template>
