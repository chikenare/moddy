import { createRouter, createWebHistory } from "vue-router";
import ChatDetailView from "@/views/ChatDetailView.vue";
import ChatsView from "@/views/ChatsView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: ChatsView },
    { path: "/chats/:id(-?\\d+)", component: ChatDetailView, props: false },
  ],
});
