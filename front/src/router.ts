import { createRouter, createWebHistory } from "vue-router";
import ChatDetailView from "@/views/ChatDetailView.vue";
import ChatsView from "@/views/ChatsView.vue";
import MessagesView from "@/views/MessagesView.vue";
import OverviewView from "@/views/OverviewView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: OverviewView },
    { path: "/groups", component: ChatsView },
    { path: "/chats/:id(-?\\d+)", component: ChatDetailView, props: false },
    { path: "/messages", component: MessagesView },
  ],
});
