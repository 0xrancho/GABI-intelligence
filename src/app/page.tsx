import ChatWidget from '@/components/ChatWidget';

export default function Home() {
  return (
    <div className="min-h-screen bg-purple-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            GABI Qualify
          </h1>
          <p className="text-xl text-gray-600 mb-2">
            AI Qualification Agent • Calendar Integration • Lead Management
          </p>
          <p className="text-gray-500">
            Chat with GABI to explore opportunities and book meetings
          </p>
        </div>
        
        <div className="max-w-2xl mx-auto">
          <ChatWidget />
        </div>
        
        <div className="mt-12 text-center text-sm text-gray-400">
          <p>GABI Qualify - AI-powered qualification with integrated booking</p>
        </div>
      </div>
    </div>
  );
}
