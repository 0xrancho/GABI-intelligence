import ChatWidget from '@/components/ChatWidget';

export default function WidgetPage() {
  return (
    <div className="h-screen w-full">
      <ChatWidget isEmbedded={true} />
    </div>
  );
}
