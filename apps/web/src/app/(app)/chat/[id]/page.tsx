import { ChatScreen } from '@/components/app/chat-screen';

export const metadata = { title: 'Chat · Tactia' };

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ChatScreen conversationId={id} />;
}
