<script setup lang="ts">
import { TriangleAlert } from '@lucide/vue'
import { onMounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { ChatRecord } from '@/lib/api'
import { useChatsStore } from '@/stores/chats'

const store = useChatsStore()
onMounted(() => store.load())

const typeLabels = { group: 'Grupo', supergroup: 'Supergrupo', channel: 'Canal' } as const

const isInactive = (c: ChatRecord) => c.botStatus === 'left' || c.botStatus === 'kicked'
const needsAdmin = (c: ChatRecord) => c.type !== 'channel' && !isInactive(c) && (!c.canDelete || !c.canRestrict)

const target = ref<ChatRecord | null>(null)
const dialogOpen = ref(false)
const busy = ref(false)

const askForget = (c: ChatRecord) => { target.value = c; dialogOpen.value = true }

async function confirmForget() {
  if (!target.value) return
  busy.value = true
  try {
    await store.forget(target.value.id)
    toast.success('Chat olvidado')
    dialogOpen.value = false
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'No se pudo olvidar el chat')
  } finally {
    busy.value = false
  }
}

watch(() => store.error, (msg) => { if (msg) toast.error(msg) })
</script>

<template>
  <section class="space-y-4">
    <h1 class="text-2xl font-semibold tracking-tight">Chats</h1>

    <p v-if="store.loading && !store.chats.length" class="text-sm text-muted-foreground">Cargando...</p>
    <p v-else-if="store.error && !store.chats.length" class="text-sm text-destructive">{{ store.error }}</p>
    <p v-else-if="!store.chats.length" class="text-sm text-muted-foreground">
      Agrega el bot a un grupo y escribe un mensaje para que aparezca aquí
    </p>

    <Card v-for="c in store.chats" :key="c.id" class="py-4">
      <CardContent class="space-y-3 px-4">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div class="min-w-0 flex-1">
            <RouterLink :to="`/chats/${c.id}`" class="block truncate font-medium hover:underline">{{ c.title }}</RouterLink>
            <div class="text-sm text-muted-foreground">{{ typeLabels[c.type] }}</div>
          </div>
          <Badge v-if="isInactive(c)" variant="outline">Inactivo</Badge>
          <Badge v-else-if="c.moderationEnabled" variant="default">Encendido</Badge>
          <Badge v-else variant="secondary">Apagado</Badge>
          <Button variant="outline" size="sm" @click="askForget(c)">Salir y olvidar</Button>
        </div>
        <Alert v-if="needsAdmin(c)" variant="destructive">
          <TriangleAlert />
          <AlertDescription>Hazme admin con permisos de eliminar mensajes y banear usuarios</AlertDescription>
        </Alert>
      </CardContent>
    </Card>

    <AlertDialog v-model:open="dialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Salir de {{ target?.title }}?</AlertDialogTitle>
          <AlertDialogDescription>
            El bot saldrá del chat y se borrarán su configuración, listas y registro de eventos.
            Los bans ya aplicados siguen vigentes en Telegram y no podrás deshacerlos desde aquí.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="busy">Cancelar</AlertDialogCancel>
          <AlertDialogAction :disabled="busy" @click.prevent="confirmForget">Salir y olvidar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
</template>
