import { defineStore } from "pinia";
import { ref } from "vue";
import { api, type ChatRecord } from "@/lib/api";

export const useChatsStore = defineStore("chats", () => {
  const chats = ref<ChatRecord[]>([]);
  const appEnv = ref<"development" | "production" | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      const [health, list] = await Promise.all([api.health(), api.listChats()]);
      appEnv.value = health.appEnv;
      chats.value = list;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Error desconocido";
    } finally {
      loading.value = false;
    }
  }

  async function forget(id: number) {
    await api.forgetChat(id);
    chats.value = chats.value.filter((c) => c.id !== id);
  }

  return { chats, appEnv, loading, error, load, forget };
});
