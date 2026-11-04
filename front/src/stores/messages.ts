import { defineStore } from "pinia";
import { ref } from "vue";
import { api, type ScheduledMessage } from "@/lib/api";

export const useMessagesStore = defineStore("messages", () => {
  const messages = ref<ScheduledMessage[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load() {
    loading.value = true;
    try {
      messages.value = await api.listMessages();
      error.value = null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Unknown error";
    } finally {
      loading.value = false;
    }
  }

  async function send(text: string, chatIds: number[], sendAt: number | null) {
    const created = await api.sendMessage(text, chatIds, sendAt);
    messages.value = [created, ...messages.value];
  }

  async function cancel(id: number) {
    const updated = await api.cancelMessage(id);
    messages.value = messages.value.map((m) => (m.id === id ? updated : m));
  }

  return { messages, loading, error, load, send, cancel };
});
