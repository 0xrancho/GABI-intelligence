import ChatWidget from '@/components/ChatWidget';

export default function Home() {
  return (
    <div className="min-h-screen bg-purple-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Joel Austin AI Interviewer
          </h1>
          <p className="text-xl text-gray-600 mb-2">
            GTM Product Strategy • AI Sales Enablement • Cross-Functional Innovation
          </p>
          <p className="text-gray-500">
            Chat with GABI to explore opportunities and assess project fit
          </p>
        </div>
        
        <div className="max-w-2xl mx-auto">
          <ChatWidget />
        </div>
        
        <div className="mt-12 text-center text-sm text-gray-400">
          <p>This is a test environment for Joel's AI screening system</p>
        </div>
      </div>
    </div>
  );
}
