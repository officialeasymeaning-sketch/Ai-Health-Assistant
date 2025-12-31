import React, { useState, useEffect } from 'react';
import { StandardConsultation } from './components/StandardConsultation';
import { LiveConsultation } from './components/LiveConsultation';
import { generateHealthQuote } from './services/geminiService';
import { Quote, Sparkles, Activity, ShieldCheck, HeartPulse, Zap, Wifi, Bot } from 'lucide-react';

const App: React.FC = () => {
  const [quote, setQuote] = useState<string>("Your health is your greatest wealth...");

  useEffect(() => {
    const fetchQuote = async () => {
      const q = await generateHealthQuote();
      setQuote(q);
    };
    fetchQuote();
    const interval = setInterval(fetchQuote, 300000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-screen w-full bg-background relative overflow-hidden flex-col">
      
      {/* --- BACKGROUND MOTION GRAPHICS --- */}
      <div className="absolute top-0 left-0 w-[200%] h-full pointer-events-none opacity-30 z-0">
        <svg className="w-full h-full animate-wave" viewBox="0 0 1440 320" preserveAspectRatio="none">
          <path fill="url(#grad1)" fillOpacity="1" d="M0,192L48,197.3C96,203,192,213,288,229.3C384,245,480,267,576,250.7C672,235,768,181,864,181.3C960,181,1056,235,1152,234.7C1248,235,1344,181,1392,154.7L1440,128L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"></path>
          <defs>
            <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" style={{stopColor:'#06b6d4', stopOpacity:1}} />
              <stop offset="50%" style={{stopColor:'#3b82f6', stopOpacity:1}} />
              <stop offset="100%" style={{stopColor:'#8b5cf6', stopOpacity:1}} />
            </linearGradient>
          </defs>
        </svg>
      </div>
      
      <div className="absolute top-[-10%] left-[10%] w-96 h-96 bg-primary/20 rounded-full blur-[100px] animate-float"></div>
      <div className="absolute bottom-[10%] right-[10%] w-96 h-96 bg-accent/20 rounded-full blur-[100px] animate-float" style={{animationDelay: '2s'}}></div>

      {/* --- MAIN CONTENT --- */}
      <main className="flex-1 flex flex-col relative z-10 p-4 pb-2 gap-4 h-full overflow-hidden">
        
        <div className="flex-1 flex gap-4 overflow-hidden">
          
          {/* Left Column - Live Consultation Sidebar */}
          <div className="hidden lg:flex w-80 flex-col animate-slideIn">
             <LiveConsultation />
          </div>

          {/* Central Area - Standard Consultation Interface */}
          <div className="flex-1 glass-panel rounded-3xl overflow-hidden flex flex-col relative transition-all duration-500 border border-white/5 shadow-2xl">
             <StandardConsultation />
          </div>

          {/* Right Panel - AI Avatar & Health Hub */}
          <div className="hidden xl:flex w-96 flex-col gap-4 animate-slideIn h-full">
            
            {/* AI Avatar Container */}
            <div className="flex-[2] glass-panel rounded-3xl relative overflow-hidden flex flex-col items-center justify-start p-8 group border border-cyan-500/20">
               <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/10 to-transparent"></div>
               <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl animate-pulse-glow"></div>

               {/* AI Robot Avatar Display - Abstract Core */}
               <div className="relative w-full aspect-square z-10 ai-container flex items-center justify-center">
                  <div className="absolute inset-0 border border-cyan-500/10 rounded-full animate-spin-slow"></div>
                  <div className="absolute inset-4 border border-blue-500/5 rounded-full animate-spin-reverse"></div>
                  
                  <div className="relative w-full h-full flex items-center justify-center animate-float">
                    {/* Replaced Image with Abstract Digital Core */}
                    <div className="relative w-40 h-40 flex items-center justify-center">
                        <div className="absolute inset-0 bg-cyan-500/20 rounded-full blur-md animate-pulse"></div>
                        <div className="relative z-10 w-32 h-32 rounded-full bg-slate-900/50 border border-cyan-400/30 flex items-center justify-center shadow-[0_0_30px_rgba(6,182,212,0.2)]">
                            <Bot size={64} className="text-cyan-300 drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]" />
                        </div>
                    </div>
                  </div>
               </div>

               <div className="mt-10 text-center z-10 relative">
                  <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-cyan-500/10 border border-cyan-500/20 rounded-full mb-4">
                     <Zap size={14} className="text-cyan-400 animate-pulse" />
                     <h3 className="text-cyan-400 font-black text-[10px] uppercase tracking-[0.2em]">Neural Engine Link</h3>
                  </div>
                  
                  <div className="flex flex-col items-center gap-1">
                    <p className="text-white text-xl font-black tracking-tighter uppercase italic">Dr. Health Bot</p>
                    <div className="flex items-center justify-center gap-2 mt-1">
                      <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]"></span>
                      <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">Biometric Link: Stable</p>
                    </div>
                  </div>
               </div>
               
               {/* Quick Stats Grid */}
               <div className="grid grid-cols-2 gap-4 mt-8 w-full z-10">
                  <div className="bg-white/5 rounded-2xl p-4 border border-white/5 flex flex-col items-center hover:bg-white/10 transition-colors group/stat">
                     <ShieldCheck size={18} className="text-cyan-400 mb-2 group-hover/stat:scale-110 transition-transform" />
                     <span className="text-[10px] text-slate-500 font-black uppercase tracking-tighter">Safe Mode</span>
                  </div>
                  <div className="bg-white/5 rounded-2xl p-4 border border-white/5 flex flex-col items-center hover:bg-white/10 transition-colors group/stat">
                     <HeartPulse size={18} className="text-pink-400 mb-2 group-hover/stat:scale-110 transition-transform" />
                     <span className="text-[10px] text-slate-500 font-black uppercase tracking-tighter">Realtime</span>
                  </div>
               </div>
            </div>

            {/* Quote Widget */}
            <div className="flex-1 glass-panel p-8 rounded-3xl relative overflow-hidden flex flex-col justify-center border border-white/5">
               <div className="absolute top-0 right-0 p-4 text-white/5 rotate-12">
                  <Quote size={80} />
               </div>
               <div className="relative z-10">
                  <div className="mb-4 text-cyan-400">
                     <Quote size={28} className="fill-cyan-400/10" />
                  </div>
                  <p className="text-lg font-bold text-slate-200 leading-relaxed italic animate-slideIn">
                     "{quote}"
                  </p>
                  <div className="mt-6 flex items-center gap-3">
                     <div className="w-10 h-1 bg-gradient-to-r from-cyan-500 to-transparent rounded-full"></div>
                     <span className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Mindset Check</span>
                  </div>
               </div>
            </div>

          </div>
        </div>
      </main>

      {/* --- FOOTER --- */}
      <footer className="relative z-20 px-6 py-4 border-t border-white/5 bg-slate-900/60 backdrop-blur-md flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-xs text-slate-400 font-medium tracking-wide">
          <Sparkles size={14} className="text-cyan-400 animate-pulse" />
          <span>Built by AIDS Students: <span className="text-cyan-400 font-bold">Raman, Mulayam, Shruti, Vaishnavi, Nisha</span></span>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="h-4 w-[1px] bg-white/10 hidden sm:block"></div>
          <span className="text-xs font-semibold text-slate-300">
            Advisor: <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-400 font-black">Mr. Ashish Sir</span>
          </span>
        </div>
      </footer>
    </div>
  );
};

export default App;