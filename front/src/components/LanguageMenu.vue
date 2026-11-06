<script setup lang="ts">
import { Check, Languages } from '@lucide/vue'
import {
  DropdownMenuContent, DropdownMenuItemIndicator, DropdownMenuPortal, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuRoot, DropdownMenuTrigger,
} from 'reka-ui'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { LOCALES, setLocale, type Locale } from '@/i18n'

// The root renders nothing, so a class from the parent (where to place it) goes on the button.
defineOptions({ inheritAttrs: false })

const { t, locale } = useI18n()
</script>

<template>
  <DropdownMenuRoot :modal="false">
    <DropdownMenuTrigger as-child>
      <Button v-bind="$attrs" variant="ghost" size="sm" class="gap-1.5" :aria-label="t('layout.language')" :title="t('layout.language')">
        <Languages class="size-4" />
        <span class="text-xs font-medium uppercase">{{ locale }}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        align="end" :side-offset="4"
        class="z-50 min-w-36 rounded-md bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      >
        <DropdownMenuRadioGroup :model-value="locale" @update:model-value="(v) => setLocale(v as Locale)">
          <DropdownMenuRadioItem
            v-for="l in LOCALES" :key="l.code" :value="l.code" :lang="l.code"
            class="relative flex cursor-default items-center rounded-sm py-1.5 pr-2 pl-7 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
          >
            <DropdownMenuItemIndicator class="absolute left-2 inline-flex items-center">
              <Check class="size-4" />
            </DropdownMenuItemIndicator>
            {{ l.name }}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
