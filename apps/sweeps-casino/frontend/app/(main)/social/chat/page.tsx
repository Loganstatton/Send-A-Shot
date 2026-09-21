import { EmptyState } from "@/components/ui/EmptyState";
import { MessageCircle } from "@/components/ui/icons";

export default function ChatPage() {
  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-4 text-xl font-bold text-text-primary">Chat</h1>
      <EmptyState
        icon={<MessageCircle className="h-10 w-10" />}
        title="Global chat is coming in Phase 2"
        description="The WebSocket gateway and moderation schema (mute/ban, message history) are already built on the backend — the chat UI itself ships in Phase 2. The activity panel on the right already shows real, live play activity."
        phase="P2"
      />
    </div>
  );
}
