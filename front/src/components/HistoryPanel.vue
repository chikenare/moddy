<script setup lang="ts">
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { EventRecord, FilterName } from '@/lib/api'
import { useChatDetailStore } from '@/stores/chatDetail'

const props = defineProps<{ id: number }>()
const store = useChatDetailStore(props.id)

const filterLabels: Record<FilterName, string> = {
  link: 'Enlaces', word: 'Palabras', flood: 'Flood', bot: 'Bots',
}

const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium' })
const when = (ts: number) => fmt.format(new Date(ts * 1000))

const isActiveBan = (e: EventRecord) => e.banOk === true && !e.dryRun && e.unbannedAt === null

function outcome(e: EventRecord) {
  const parts: string[] = []
  if (e.deleteOk) parts.push('Borrado')
  if (e.banOk) parts.push(e.unbannedAt !== null ? 'Baneado (deshecho)' : 'Baneado')
  return parts.join(' y ') || 'Sin efecto'
}

const target = ref<EventRecord | null>(null)
const dialogOpen = ref(false)
const busy = ref(false)
const loadingMore = ref(false)

const askUnban = (e: EventRecord) => { target.value = e; dialogOpen.value = true }

async function confirmUnban() {
  if (!target.value) return
  busy.value = true
  try {
    await store.unban(target.value.id)
    toast.success('Usuario desbaneado')
    dialogOpen.value = false
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'No se pudo desbanear')
  } finally {
    busy.value = false
  }
}

async function more() {
  loadingMore.value = true
  try {
    await store.loadMoreEvents()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'No se pudo cargar más')
  } finally {
    loadingMore.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <p v-if="!store.events.length" class="text-sm text-muted-foreground">Todavía no hay eventos</p>
    <div v-else class="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Remitente</TableHead>
            <TableHead>Filtro</TableHead>
            <TableHead>Coincidencia</TableHead>
            <TableHead>Resultado</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="e in store.events" :key="e.id" class="align-top">
            <TableCell class="whitespace-nowrap">{{ when(e.createdAt) }}</TableCell>
            <TableCell class="max-w-40 break-words whitespace-normal">{{ e.senderName }}</TableCell>
            <TableCell>{{ filterLabels[e.filter] }}</TableCell>
            <TableCell class="max-w-64 whitespace-normal">
              <div class="break-all">{{ e.matched }}</div>
              <div v-if="e.text" class="mt-1 break-words text-xs text-muted-foreground">{{ e.text }}</div>
            </TableCell>
            <TableCell class="max-w-48 whitespace-normal">
              <div class="flex flex-wrap items-center gap-1">
                <span>{{ outcome(e) }}</span>
                <Badge v-if="e.dryRun" variant="outline">Simulado</Badge>
              </div>
              <div v-if="e.error" class="mt-1 break-words text-xs text-destructive">{{ e.error }}</div>
            </TableCell>
            <TableCell>
              <Button v-if="isActiveBan(e)" variant="outline" size="sm" @click="askUnban(e)">Desbanear</Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
    <Button v-if="store.nextBefore !== null" variant="outline" :disabled="loadingMore" @click="more">
      Cargar más
    </Button>

    <AlertDialog v-model:open="dialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Desbanear a {{ target?.senderName }}?</AlertDialogTitle>
          <AlertDialogDescription>
            Podrá volver a entrar, pero debe hacerlo por su cuenta: el bot no lo vuelve a agregar al grupo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="busy">Cancelar</AlertDialogCancel>
          <AlertDialogAction :disabled="busy" @click.prevent="confirmUnban">Desbanear</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
