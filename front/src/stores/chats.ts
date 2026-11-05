import { defineStore } from "pinia";
import { ref } from "vue";
import { api, type ChatRecord } from "@/lib/api";
import { t } from "@/i18n";

export const useChatsStore = defineStore("chats", () => {
  const chats = ref<ChatRecord[]>([]);
  const appEnv = ref<"development" | "production" | null>(null);
  const botUsername = ref<string | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      const [info, list] = await Promise.all([api.info(), api.listChats()]);
      appEnv.value = info.appEnv;
      botUsername.value = info.botUsername;
      chats.value = list;
    } catch (e) {
      error.value = e instanceof Error ? e.message : t("common.unknownError");
    } finally {
      loading.value = false;
    }
  }

  async function forget(id: number) {
    await api.forgetChat(id);
    chats.value = chats.value.filter((c) => c.id !== id);
  }

  return { chats, appEnv, botUsername, loading, error, load, forget };
});
