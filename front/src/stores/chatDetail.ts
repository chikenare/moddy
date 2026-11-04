import { defineStore } from "pinia";
import { ref } from "vue";
import { api, type ChatRecord, type ChatSettings, type EventRecord } from "@/lib/api";

export function useChatDetailStore(id: number) {
  return defineStore(`chatDetail:${id}`, () => {
    const chat = ref<ChatRecord | null>(null);
    const words = ref<string[]>([]);
    const whitelist = ref<string[]>([]);
    const events = ref<EventRecord[]>([]);
    const nextBefore = ref<number | null>(null);
    const loading = ref(false);
    const error = ref<string | null>(null);

    async function load() {
      loading.value = true;
      error.value = null;
      try {
        const [c, w, wl, ev] = await Promise.all([
          api.getChat(id), api.listWords(id), api.listWhitelist(id), api.listEvents(id),
        ]);
        chat.value = c;
        words.value = w;
        whitelist.value = wl;
        events.value = ev.events;
        nextBefore.value = ev.nextBefore;
      } catch (e) {
        error.value = e instanceof Error ? e.message : "Error desconocido";
      } finally {
        loading.value = false;
      }
    }

    async function update(patch: Partial<ChatSettings>) {
      const current = chat.value;
      if (!current) return;
      const previous = Object.fromEntries(
        (Object.keys(patch) as (keyof ChatSettings)[]).map((k) => [k, current[k]]),
      );
      chat.value = { ...current, ...patch };
      try {
        chat.value = await api.updateChat(id, patch);
      } catch (e) {
        chat.value = { ...chat.value!, ...previous };
        throw e;
      }
    }

    async function addWord(w: string) {
      const word = await api.addWord(id, w);
      if (!words.value.includes(word)) words.value = [...words.value, word].sort();
    }

    async function removeWord(w: string) {
      await api.removeWord(id, w);
      words.value = words.value.filter((x) => x !== w);
    }

    async function addEntry(e: string) {
      const entry = await api.addWhitelistEntry(id, e);
      if (!whitelist.value.includes(entry)) whitelist.value = [...whitelist.value, entry].sort();
    }

    async function removeEntry(e: string) {
      await api.removeWhitelistEntry(id, e);
      whitelist.value = whitelist.value.filter((x) => x !== e);
    }

    async function loadMoreEvents() {
      if (nextBefore.value === null) return;
      const page = await api.listEvents(id, nextBefore.value);
      events.value = [...events.value, ...page.events];
      nextBefore.value = page.nextBefore;
    }

    async function unban(eventId: number) {
      const updated = await api.unban(id, eventId);
      events.value = events.value.map((ev) =>
        ev.id === eventId ? updated
          : ev.senderType === updated.senderType && ev.senderId === updated.senderId ? { ...ev, unbannedAt: updated.unbannedAt }
          : ev);
      return updated;
    }

    return { chat, words, whitelist, events, nextBefore, loading, error, load, update, addWord, removeWord, addEntry, removeEntry, loadMoreEvents, unban };
  })();
}
