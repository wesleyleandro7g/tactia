import { ChatScreen } from '@/components/app/chat-screen';

export const metadata = { title: 'Chat · Tactia' };

/** Nova conversa: só é criada quando a primeira pergunta é enviada. */
export default function ChatPage() {
  return <ChatScreen conversationId={null} />;
}
