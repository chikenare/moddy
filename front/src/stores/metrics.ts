import { defineStore } from "pinia";
import { ref } from "vue";
import { api, type Metrics } from "@/lib/api";
import { t } from "@/i18n";

// One store per scope (all groups, or one group), so the overview and a group tab don't overwrite each other.
export function useMetricsStore(chatId?: number) {
  return defineStore(`metrics:${chatId ?? "all"}`, () => {
    const data = ref<Metrics | null>(null);
    const loading = ref(false);
    const error = ref<string | null>(null);
    let latest = 0;

    async function load(days: number) {
      const ticket = ++latest;
      loading.value = true;
      error.value = null;
      try {
        const result = await api.metrics(days, chatId);
        if (ticket === latest) data.value = result;
      } catch (e) {
        if (ticket === latest) error.value = e instanceof Error ? e.message : t("common.unknownError");
      } finally {
        if (ticket === latest) loading.value = false;
      }
    }

    return { data, loading, error, load };
  })();
}
