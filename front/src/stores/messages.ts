import { defineStore } from "pinia";
import { ref } from "vue";
import { api, type FormattedMessage, type RecurringInput, type RecurringMessage, type ScheduledMessage } from "@/lib/api";

export const useMessagesStore = defineStore("messages", () => {
  const messages = ref<ScheduledMessage[]>([]);
  const recurring = ref<RecurringMessage[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load() {
    loading.value = true;
    try {
      const [list, rules] = await Promise.all([api.listMessages(), api.listRecurring()])
      messages.value = list
      recurring.value = rules;
      error.value = null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Unknown error";
    } finally {
      loading.value = false;
    }
  }

  async function send(message: FormattedMessage, chatIds: number[], sendAt: number | null) {
    const created = await api.sendMessage(message, chatIds, sendAt);
    messages.value = [created, ...messages.value];
  }

  async function cancel(id: number) {
    const updated = await api.cancelMessage(id);
    messages.value = messages.value.map((m) => (m.id === id ? updated : m));
  }

  const replace = (rule: RecurringMessage) => {
    recurring.value = recurring.value.map((r) => (r.id === rule.id ? rule : r));
  }

  async function createRecurring(input: RecurringInput) {
    recurring.value = [await api.createRecurring(input), ...recurring.value];
  }
  async function updateRecurring(id: number, input: RecurringInput) {
    replace(await api.updateRecurring(id, input));
  }
  async function setPaused(id: number, paused: boolean) {
    replace(await (paused ? api.pauseRecurring(id) : api.resumeRecurring(id)));
  }
  async function removeRecurring(id: number) {
    await api.deleteRecurring(id);
    recurring.value = recurring.value.filter((r) => r.id !== id);
  }

  return { messages, recurring, loading, error, load, send, cancel, createRecurring, updateRecurring, setPaused, removeRecurring };
});
