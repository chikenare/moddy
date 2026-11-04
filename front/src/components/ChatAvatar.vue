<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { avatarHue, initials } from '@/lib/chats'
import { cn } from '@/lib/utils'

const props = defineProps<{ chat: { id: number; title: string }; class?: HTMLAttributes['class'] }>()
const hue = computed(() => avatarHue(props.chat.id))
</script>

<template>
  <Avatar :class="cn('size-10', props.class)" aria-hidden="true">
    <AvatarImage :src="`/api/chats/${chat.id}/photo`" alt="" />
    <AvatarFallback class="chat-avatar-tint text-[0.8em] font-semibold" :style="{ '--avatar-hue': hue }">
      {{ initials(chat.title) }}
    </AvatarFallback>
  </Avatar>
</template>
