'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ChatWidgetProps {
  isEmbedded?: boolean;
  onClose?: () => void;
}

// Function to format analysis content with proper HTML
const formatAnalysisContent = (content: string) => {
  // Clean up any extra markdown artifacts first
  let cleaned = content
    .replace(/\$\d+/g, '') // Remove $2, $3 artifacts
    .replace(/---+/g, '<hr class="my-4 border-gray-300">') // Horizontal rules
    .replace(/^\| (.+) \|$/gm, (match, content) => {
      // Convert table rows to proper HTML, skip empty rows
      if (!content.trim() || content.replace(/\s/g, '').replace(/\|/g, '') === '') {
        return '';
      }
      const cells = content.split(' | ').map(cell => `<td class="px-3 py-2 border border-gray-200">${cell.trim()}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    })
    .replace(/^\|[-\s|:]+\|$/gm, '') // Remove table separator rows
    .replace(/<tr><\/tr>/g, '') // Remove empty table rows
    .replace(/^# (.*$)/gm, '<h1 class="text-2xl font-bold mb-4 text-gray-900">$1</h1>')
    .replace(/^## (.*$)/gm, '<h2 class="text-xl font-semibold mb-3 mt-6 text-blue-800">$1</h2>')
    .replace(/^### (.*$)/gm, '<h3 class="text-lg font-semibold mb-2 mt-4 text-gray-800">$1</h3>')
    .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
    .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')
    .replace(/→ \*\*(.*?)\*\*/g, '→ <strong class="text-blue-600 font-semibold">$1</strong>')
    .replace(/⭐/g, '<span class="text-yellow-500">⭐</span>');

  // Wrap table content
  if (cleaned.includes('<tr>')) {
    cleaned = cleaned.replace(/(<tr>.*<\/tr>)/gs, '<table class="w-full border-collapse border border-gray-300 my-4">$1</table>');
  }

  // Convert line breaks and paragraphs
  cleaned = cleaned
    .split('\n\n')
    .map(paragraph => paragraph.trim())
    .filter(paragraph => paragraph.length > 0)
    .map(paragraph => {
      if (paragraph.includes('<h1>') || paragraph.includes('<h2>') || paragraph.includes('<h3>') || 
          paragraph.includes('<table>') || paragraph.includes('<hr>')) {
        return paragraph;
      }
      return `<p class="mb-3 text-gray-700 leading-relaxed">${paragraph.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');

  return cleaned;
};

// Function to render message content with calendar button for recommendations
const renderMessageContent = (content: string) => {
  // Check if this is a recommendation message that should show a calendar button
  const isRecommendation = content.includes('## Recommendation:') || 
                          content.includes('SCHEDULE') ||
                          content.includes('calendly.com');
  
  // Clean up the content by removing any existing calendar link markdown and artifacts
  const cleanedContent = content
    .replace(/→ \[Calendar Link\]\(https:\/\/calendly\.com\/joelaustin\/30min\).*$/gm, '')
    .replace(/\[Calendar Link\]\(https:\/\/calendly\.com\/joelaustin\/30min\)/g, '')
    .replace(/→ \[Calendar Link\]/g, '')
    .replace(/\[Calendar Link\]/g, '')
    .replace(/- Mention GABI sent you/g, '')
    .replace(/\|\s*\|\s*\|\s*\|/g, '') // Remove empty table rows
    .replace(/\n\s*\n\s*\n/g, '\n\n') // Remove excessive line breaks
    .trim();

  return (
    <div>
      {/* Render the cleaned message content */}
      <div 
        className="prose prose-sm max-w-none"
        dangerouslySetInnerHTML={{ 
          __html: formatAnalysisContent(cleanedContent) 
        }} 
      />
      
      {/* Show calendar button if this is a recommendation */}
      {isRecommendation && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <a 
            href="https://calendly.com/joelaustin/30min" 
            target="_blank" 
            rel="noopener noreferrer"
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-sm text-sm"
          >
            Schedule a Call
            <svg className="ml-2 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 002 2z" />
            </svg>
          </a>
          <p className="text-xs text-gray-500 mt-2">
            Mention GABI sent you
          </p>
        </div>
      )}
    </div>
  );
};

export default function ChatWidget({ isEmbedded = false, onClose }: ChatWidgetProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "Hi! I'm GABI, Joel's AI assistant. I help screen potential opportunities and partnerships. What kind of project or role are you exploring?",
      timestamp: new Date()
    }
  ]);
  
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // Focus input when widget opens
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const sendMessage = async (messageContent: string) => {
    if (!messageContent.trim()) return;

    setIsLoading(true);
    
    // Add user message
    const newMessages = [...messages, { role: 'user' as const, content: messageContent, timestamp: new Date() }];
    setMessages(newMessages);
    setInput('');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: newMessages.map(msg => ({
            role: msg.role,
            content: msg.content
          }))
        }),
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      // Add GABI's response to conversation
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.message,
        timestamp: new Date()
      }]);

    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "Sorry, I'm having trouble responding right now. Please try again.",
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <div className={`flex flex-col ${isEmbedded ? 'h-full' : 'h-[600px]'} bg-white border border-gray-200 rounded-lg shadow-lg`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-blue-50">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-blue-600" />
          <div>
            <h3 className="font-medium text-gray-900">GABI</h3>
            <p className="text-xs text-gray-600">Joel's AI Assistant</p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl font-bold"
          >
            ×
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {message.role === 'assistant' && (
              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-blue-600" />
              </div>
            )}
            
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-900'
              }`}
            >
              {message.role === 'assistant' ? (
                renderMessageContent(message.content)
              ) : (
                <>
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  <span className="text-xs opacity-70">
                    {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </>
              )}
              
              {message.role === 'user' && (
                <span className="text-xs opacity-70">
                  {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>

            {message.role === 'user' && (
              <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                <User className="w-4 h-4 text-gray-600" />
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
              <Bot className="w-4 h-4 text-blue-600" />
            </div>
            <div className="bg-gray-100 rounded-lg px-3 py-2">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-200">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            disabled={isLoading}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
} 