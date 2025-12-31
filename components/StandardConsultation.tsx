import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatMessage } from '../types';
import { generateHealthResponseStream, generateSpeech } from '../services/geminiService';
import { Image, Send, Volume2, StopCircle, Loader2, User, Bot, Sparkles, X, Paperclip, Mic, MicOff, Activity, RefreshCw, Search, HeartPulse, Key } from 'lucide-react';
import { blobToBase64, decodeBase64, decodeAudioData } from '../utils/audioUtils';

type AnalysisStep = 'identifying' | 'diagnosing' | 'curing' | null;

export const StandardConsultation: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'model',
      text: "Hello! I'm your AI Health Assistant. 🩺\n\nYou can describe your symptoms in English, Hindi, or Hinglish. How can I help you today?",
      suggestions: ["Mujhe sirdard hai", "I have a stomach ache", "Tips for better sleep"]
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [timeOfDay, setTimeOfDay] = useState('');
  const [analysisStep, setAnalysisStep] = useState<AnalysisStep>(null);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [audioLoadingId, setAudioLoadingId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  
  // API Key Modal State
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, playingMessageId, analysisStep]);

  useEffect(() => {
    const hours = new Date().getHours();
    if (hours < 12) setTimeOfDay('Good Morning');
    else if (hours < 18) setTimeOfDay('Good Afternoon');
    else setTimeOfDay('Good Evening');
  }, []);

  const parseResponse = (rawText: string): { content: string, suggestions: string[] } => {
    const parts = rawText.split('---SUGGESTIONS---');
    const content = parts[0].trim();
    let suggestions: string[] = [];
    if (parts[1]) {
      suggestions = parts[1].split('|').map(s => s.trim()).filter(s => s.length > 0);
    }
    return { content, suggestions };
  };

  const handleClearChat = () => {
    stopAudio();
    setMessages([{
      id: Date.now().toString(),
      role: 'model',
      text: "Chat cleared. How else can I assist you with your health today?",
      suggestions: ["Nutrition advice", "Exercise tips", "Yoga benefits"]
    }]);
  };

  const saveApiKey = () => {
    if (tempApiKey.trim().startsWith('AIza')) {
      localStorage.setItem('GEMINI_API_KEY', tempApiKey.trim());
      setShowApiKeyModal(false);
      setTempApiKey('');
      // Optionally reload or just let the user retry
      alert("API Key saved! Please try sending your message again.");
    } else {
      alert("Invalid API Key. It must start with 'AIza'.");
    }
  };

  const handleSendMessage = async (textOverride?: string) => {
    const textToSend = textOverride || inputText;
    if ((!textToSend.trim() && !selectedImage) || isLoading) return;

    stopAudio();

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: textToSend,
      image: selectedImage || undefined
    };

    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setSelectedImage(null);
    setIsLoading(true);

    setAnalysisStep('identifying');
    
    const aiMsgId = (Date.now() + 1).toString();
    const initialAiMsg: ChatMessage = {
      id: aiMsgId,
      role: 'model',
      text: '',
      suggestions: []
    };
    setMessages(prev => [...prev, initialAiMsg]);

    try {
      setTimeout(() => setAnalysisStep('diagnosing'), 2000);
      setTimeout(() => setAnalysisStep('curing'), 4000);
      setTimeout(() => setAnalysisStep(null), 6000);

      let fullAccumulatedText = '';
      const stream = generateHealthResponseStream(userMsg.text || "Analyse this", userMsg.image);

      for await (const chunk of stream) {
        // Handle Error Signals from Service
        if (chunk === 'ACCESS_DENIED_ERROR' || chunk === 'MISSING_API_KEY_ERROR') {
            setShowApiKeyModal(true);
            fullAccumulatedText = "⚠️ **Action Required**: Please enter your API Key to continue.";
            break;
        }

        fullAccumulatedText += chunk;
        setMessages(prev => prev.map(msg => 
          msg.id === aiMsgId 
            ? { ...msg, text: fullAccumulatedText } 
            : msg
        ));
      }

      const { content, suggestions } = parseResponse(fullAccumulatedText);
      setMessages(prev => prev.map(msg => 
        msg.id === aiMsgId 
          ? { ...msg, text: content, suggestions } 
          : msg
      ));

    } catch (error) {
      console.error(error);
      setMessages(prev => prev.map(msg => 
        msg.id === aiMsgId 
          ? { ...msg, text: "I encountered an error. Please check your connection and try again." } 
          : msg
      ));
      setAnalysisStep(null);
    } finally {
      setIsLoading(false);
    }
  };

  const splitTextIntoChunks = (text: string): string[] => {
    const chunks: string[] = [];
    const splitRegex = /([.!?।\n]+)/; 
    const parts = text.split(splitRegex);
    let currentChunk = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (splitRegex.test(part)) {
        currentChunk += part;
        if (currentChunk.trim().length >= 40 || i >= parts.length - 2) {
           if (currentChunk.trim()) {
             chunks.push(currentChunk.trim());
             currentChunk = '';
           }
        }
      } else {
        currentChunk += part;
      }
    }
    if (currentChunk.trim()) chunks.push(currentChunk.trim());
    return chunks;
  };

  const playAudioChunk = (base64: string, ctx: AudioContext): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      try {
        const audioBuffer = await decodeAudioData(decodeBase64(base64), ctx, 24000, 1);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        sourceNodeRef.current = source;
        source.onended = () => resolve();
        source.start();
      } catch (e) {
        reject(e);
      }
    });
  };

  const toggleAudio = async (msg: ChatMessage) => {
    if (playingMessageId === msg.id) {
      stopAudio();
      return;
    }
    stopAudio();
    setPlayingMessageId(msg.id);
    setAudioLoadingId(msg.id);
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      const cleanText = (msg.text || '').replace(/[#*`]/g, '').trim();
      if (!cleanText) return;
      const chunks = splitTextIntoChunks(cleanText);
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();
      const ctx = audioContextRef.current;
      let nextAudioPromise = generateSpeech(chunks[0]);
      for (let i = 0; i < chunks.length; i++) {
         if (signal.aborted) break;
         const currentAudioPromise = nextAudioPromise;
         if (i + 1 < chunks.length) nextAudioPromise = generateSpeech(chunks[i + 1]);
         else nextAudioPromise = Promise.resolve(null);
         const base64Audio = await currentAudioPromise;
         if (signal.aborted) break;
         if (!base64Audio) continue;
         if (i === 0) setAudioLoadingId(null);
         await playAudioChunk(base64Audio, ctx);
      }
    } catch (e) {
      console.error("Audio playback error", e);
    } finally {
      if (!signal.aborted) {
        setPlayingMessageId(null);
        setAudioLoadingId(null);
      }
    }
  };

  const stopAudio = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch (e) {}
      sourceNodeRef.current = null;
    }
    setPlayingMessageId(null);
    setAudioLoadingId(null);
  };

  const handleVoiceInput = () => {
    if (isListening) {
      if (recognitionRef.current) recognitionRef.current.stop();
      setIsListening(false);
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Your browser does not support voice input.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'hi-IN, en-US';
    recognition.interimResults = false;
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInputText((prev) => prev.trim() ? `${prev.trim()} ${transcript}` : transcript);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const base64 = await blobToBase64(file);
        setSelectedImage(base64);
      } catch (err) {
        console.error("Image upload failed", err);
      }
    }
  };

  return (
    <div className="flex flex-col h-full relative">
      
      {/* API Key Modal */}
      {showApiKeyModal && (
        <div className="absolute inset-0 z-[100] bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-slate-800 border border-cyan-500/30 rounded-2xl p-6 max-w-md w-full shadow-2xl animate-in fade-in zoom-in-95">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                        <Key className="text-red-400" size={20} />
                    </div>
                    <h2 className="text-xl font-bold text-white">Setup API Key</h2>
                </div>
                <p className="text-slate-300 mb-6 text-sm leading-relaxed">
                    It looks like the server's API key is invalid or restricted. Please enter your own 
                    <strong className="text-cyan-400"> Google Gemini API Key</strong> to make the app fully functional.
                </p>
                <div className="space-y-4">
                    <input 
                        type="password" 
                        value={tempApiKey}
                        onChange={(e) => setTempApiKey(e.target.value)}
                        placeholder="Paste AIza... key here"
                        className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-cyan-500 outline-none"
                    />
                    <div className="flex gap-3">
                         <button 
                            onClick={() => setShowApiKeyModal(false)}
                            className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl font-bold text-slate-300 transition-colors"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={saveApiKey}
                            disabled={!tempApiKey}
                            className="flex-1 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-xl font-bold text-white shadow-lg shadow-cyan-900/20 disabled:opacity-50 transition-all"
                        >
                            Save & Activate
                        </button>
                    </div>
                </div>
                <p className="mt-4 text-xs text-slate-500 text-center">
                   This key is saved locally in your browser.
                </p>
            </div>
        </div>
      )}

      {/* Consultation Animated Overlay */}
      {analysisStep && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-xl transition-all duration-500 animate-in fade-in">
           <div className="max-w-md w-full p-8 text-center flex flex-col items-center gap-6">
              
              <div className="relative w-32 h-32 flex items-center justify-center">
                 <div className="absolute inset-0 bg-cyan-500/10 rounded-full animate-ping opacity-25"></div>
                 <div className="absolute inset-2 border-2 border-cyan-500/20 rounded-full animate-[spin_10s_linear_infinite]"></div>
                 <div className="absolute inset-4 border border-blue-500/30 rounded-full animate-[spin_5s_linear_infinite_reverse]"></div>
                 
                 <div className="relative p-6 bg-slate-800 rounded-full border border-white/10 shadow-2xl text-cyan-400">
                    {analysisStep === 'identifying' && <Search size={48} className="animate-pulse" />}
                    {analysisStep === 'diagnosing' && <Activity size={48} className="animate-bounce" />}
                    {analysisStep === 'curing' && <HeartPulse size={48} className="animate-pulse" />}
                 </div>
              </div>

              <div className="space-y-2">
                 <h2 className="text-2xl font-black text-white tracking-tight">
                    {analysisStep === 'identifying' && "Identifying the problem..."}
                    {analysisStep === 'diagnosing' && "Diagnosing Symptoms..."}
                    {analysisStep === 'curing' && "Suggesting the Cure..."}
                 </h2>
                 <p className="text-slate-400 text-sm font-medium">
                    {analysisStep === 'identifying' && "Scanning input data for patterns and health markers."}
                    {analysisStep === 'diagnosing' && "Cross-referencing symptoms with medical knowledge base."}
                    {analysisStep === 'curing' && "Formulating actionable advice and treatment options."}
                 </p>
              </div>

              <div className="flex items-center gap-4 w-full px-12">
                 <div className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${analysisStep === 'identifying' || analysisStep === 'diagnosing' || analysisStep === 'curing' ? 'bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.5)]' : 'bg-slate-700'}`}></div>
                 <div className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${analysisStep === 'diagnosing' || analysisStep === 'curing' ? 'bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.5)]' : 'bg-slate-700'}`}></div>
                 <div className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${analysisStep === 'curing' ? 'bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.5)]' : 'bg-slate-700'}`}></div>
              </div>
           </div>
        </div>
      )}

      {/* Modern Header */}
      <div className="relative p-6 z-20 border-b border-white/5 bg-slate-900/30 backdrop-blur-md">
        <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
                <div className="relative group cursor-pointer">
                    <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl blur opacity-25 group-hover:opacity-75 transition duration-1000 group-hover:duration-200"></div>
                    <div className="relative w-12 h-12 bg-slate-900 rounded-xl border border-white/10 flex items-center justify-center">
                        <Activity className="text-cyan-400 animate-pulse" size={24} />
                    </div>
                </div>
                <div>
                    <h1 className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-white via-cyan-200 to-blue-400 tracking-tight">
                        AI Health Assistant
                    </h1>
                    <p className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                       <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                       Online • {timeOfDay}
                    </p>
                </div>
            </div>

            <div className="flex items-center gap-3">
                 <button 
                    onClick={() => setShowApiKeyModal(true)}
                    className="p-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-cyan-400 transition-all border border-transparent hover:border-cyan-500/30 group"
                    title="Update API Key"
                >
                    <Key size={20} />
                </button>

                 <button 
                    onClick={handleClearChat}
                    className="p-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all border border-transparent hover:border-white/10 group"
                    title="Reset Conversation"
                >
                    <RefreshCw size={20} className="group-hover:rotate-180 transition-transform duration-700 ease-out" />
                </button>
            </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-8 scroll-smooth mask-fade-top">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-float`} style={{animationDuration: '0s', animation: 'fadeIn 0.5s ease-out'}}>
            
            <div className={`flex gap-4 max-w-[90%] lg:max-w-[80%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              
              <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center mt-2 shadow-[0_0_15px_rgba(0,0,0,0.3)] ${
                msg.role === 'user' 
                  ? 'bg-gradient-to-br from-indigo-500 to-purple-600' 
                  : 'bg-gradient-to-br from-cyan-400 to-blue-500'
              }`}>
                {msg.role === 'user' ? <User size={18} className="text-white" /> : <Bot size={18} className="text-white" />}
              </div>

              <div className="flex flex-col gap-2">
                <div className={`p-6 shadow-xl backdrop-blur-md border transition-colors duration-300 ${
                  msg.role === 'user' 
                    ? 'rounded-[30px] rounded-tr-none bg-gradient-to-r from-indigo-600/80 to-blue-600/80 border-indigo-500/30 text-white' 
                    : 'rounded-[30px] rounded-tl-none bg-white border-white/50 text-slate-900'
                }`}>
                  {msg.image && (
                    <div className="mb-4 rounded-2xl overflow-hidden border border-white/10 shadow-lg">
                      <img src={`data:image/jpeg;base64,${msg.image}`} alt="Uploaded" className="max-w-full max-h-64 object-cover" />
                    </div>
                  )}
                  
                  <div className={`prose max-w-none
                    prose-headings:font-bold prose-headings:mb-4 prose-headings:mt-6
                    prose-p:leading-loose prose-p:mb-6 prose-p:text-base
                    prose-li:mb-3 prose-li:leading-relaxed
                    prose-ul:my-6 prose-ol:my-6
                    prose-strong:font-bold
                    ${msg.role === 'user' 
                      ? 'prose-invert text-white prose-headings:text-cyan-300 prose-strong:text-white prose-li:marker:text-cyan-400' 
                      : 'text-slate-900 prose-headings:text-cyan-700 prose-strong:text-slate-900 prose-li:marker:text-cyan-500'
                    }
                  `}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.text || ''}
                    </ReactMarkdown>
                  </div>

                  {msg.role === 'model' && !isLoading && msg.text && (
                    <div className="mt-4 pt-4 border-t border-slate-200 flex items-center gap-3">
                       <button 
                         onClick={() => toggleAudio(msg)}
                         className={`flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-full transition-all ${
                           playingMessageId === msg.id 
                             ? 'bg-red-100 text-red-500 border border-red-200 shadow-inner' 
                             : 'bg-slate-100 text-slate-500 hover:text-cyan-700 hover:bg-slate-200 border border-transparent hover:shadow-md'
                         }`}
                       >
                         {audioLoadingId === msg.id ? (
                           <Loader2 size={14} className="animate-spin" />
                         ) : playingMessageId === msg.id ? (
                           <> <StopCircle size={14} /> Stop Speaking </>
                         ) : (
                           <> <Volume2 size={14} /> Listen </>
                         )}
                       </button>
                    </div>
                  )}
                </div>

                {msg.suggestions && msg.suggestions.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2 pl-2">
                    {msg.suggestions.map((suggestion, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSendMessage(suggestion)}
                        disabled={isLoading}
                        className="text-xs bg-slate-800/80 hover:bg-cyan-500/20 border border-white/10 hover:border-cyan-500/50 text-cyan-300 px-4 py-2 rounded-full transition-all flex items-center gap-2 hover:scale-105 active:scale-95 disabled:opacity-50"
                      >
                        <Sparkles size={12} />
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        
        {isLoading && !analysisStep && messages[messages.length - 1].role === 'user' && (
          <div className="flex justify-start gap-4 max-w-[80%] animate-pulse">
             <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center shadow-lg">
                <Bot size={18} className="text-white" />
             </div>
             <div className="bg-white rounded-[30px] rounded-tl-none p-6 border border-white/50 flex items-center gap-3 shadow-xl">
               <div className="flex gap-1.5">
                 <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                 <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                 <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
               </div>
               <span className="text-slate-600 text-sm font-medium">Drafting response...</span>
             </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 lg:p-6 z-20">
        <div className="max-w-4xl mx-auto relative group">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-full opacity-30 group-focus-within:opacity-100 blur transition duration-500"></div>
          
          <div className="relative bg-slate-900/90 rounded-full flex items-center p-2 pr-3 shadow-2xl backdrop-blur-xl border border-white/10">
            
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="p-3 text-slate-400 hover:text-cyan-300 hover:bg-white/5 rounded-full transition-colors"
            >
              <Paperclip size={20} />
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleImageUpload} 
              accept="image/*" 
              className="hidden" 
            />

            {selectedImage && (
               <div className="flex items-center gap-2 bg-slate-800 px-3 py-1 rounded-full mr-2 border border-white/10">
                  <span className="text-xs text-cyan-300">Image added</span>
                  <button onClick={() => setSelectedImage(null)} className="text-slate-400 hover:text-white"><X size={12} /></button>
               </div>
            )}

            <input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder={isListening ? "Listening... Speak now" : "Type your health question..."}
              className={`flex-1 bg-transparent border-none focus:ring-0 text-white placeholder:text-slate-500 px-4 h-12 transition-all ${isListening ? 'placeholder:text-red-400 placeholder:animate-pulse' : ''}`}
            />

            <button 
              onClick={handleVoiceInput}
              className={`p-3 rounded-full transition-all duration-300 ${
                isListening 
                  ? 'bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.5)] animate-pulse' 
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {isListening ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
            
            <button 
              onClick={() => handleSendMessage()}
              disabled={(!inputText && !selectedImage) || isLoading}
              className={`p-3 ml-2 rounded-full transition-all duration-300 ${
                (!inputText && !selectedImage) || isLoading
                ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                : 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_0_15px_rgba(6,182,212,0.4)] hover:scale-105 active:scale-95'
              }`}
            >
              {isLoading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};