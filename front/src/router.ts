import { createRouter, createWebHistory } from "vue-router";
import { CHANGE_PASSWORD_PATH, guardRoute } from "@/lib/next";
import { useAuthStore } from "@/stores/auth";
import ChangePasswordView from "@/views/ChangePasswordView.vue";
import ChatDetailView from "@/views/ChatDetailView.vue";
import ChatsView from "@/views/ChatsView.vue";
import LoginView from "@/views/LoginView.vue";
import MessagesView from "@/views/MessagesView.vue";
import OverviewView from "@/views/OverviewView.vue";

declare module "vue-router" {
  interface RouteMeta {
    public?: boolean;
    bare?: boolean;
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", component: LoginView, meta: { public: true, bare: true } },
    { path: CHANGE_PASSWORD_PATH, component: ChangePasswordView, meta: { bare: true } },
    { path: "/", component: OverviewView },
    { path: "/groups", component: ChatsView },
    { path: "/chats/:id(-?\\d+)", component: ChatDetailView, props: false },
    { path: "/messages", component: MessagesView },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  // The redirect after a failed check: asking again would keep the page blank for another timeout.
  if (to.meta.public && auth.unreachable) return true;
  return guardRoute(to, await auth.check());
});
