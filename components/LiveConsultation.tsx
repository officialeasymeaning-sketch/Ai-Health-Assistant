import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Mic, MicOff, PhoneOff, Video, Activity, Loader2, ShieldAlert, Radio, RefreshCw } from 'lucide-react';
import { decodeBase64, decodeAudioData } from '../utils/audioUtils';
import { getApiKey } from '../services/geminiService'; // Import the shared key logic

// Configuration for the Live API
const LIVE_API_MODEL = 'gemini-2.5-flash-native-audio-preview-09-2025';
const AUDIO_SAMPLE_RATE = 16000; // Gemini expects 16kHz audio

export const LiveConsultation: React.FC = () => {
  // UI State
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [status, setStatus] = useState<string>('Ready to Connect');
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);

  // References for Audio & Session
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeSessionRef = useRef<any>(null);
  const isUserManualDisconnect = useRef<boolean>(false);
  const retryCount = useRef(0);
  const MAX_RETRIES = 3;
  
  // Audio Playback Queue
  const nextStartTimeRef = useRef<number>(0);
  const scheduledSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Initialize GenAI Client lazily
  const aiRef = useRef<GoogleGenAI | null>(null);

  const getAiClient = () => {
    const apiKey = getApiKey();
    if (!aiRef.current) {
        aiRef.current = new GoogleGenAI({ apiKey });
    }
    return aiRef.current;
  };

  // --- Audio Processing Helpers ---

  const processAudioInput = (inputData: Float32Array, inputSampleRate: number) => {
    const targetLength = Math.floor(inputData.length * (AUDIO_SAMPLE_RATE / inputSampleRate));
    const int16Data = new Int16Array(targetLength);
    const ratio = inputSampleRate / AUDIO_SAMPLE_RATE;

    for (let i = 0; i < targetLength; i++) {
        const inputIndex = Math.floor(i * ratio);
        const sample = Math.max(-1, Math.min(1, inputData[inputIndex])); // Clamp
        int16Data[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }

    let binary = '';
    const bytes = new Uint8Array(int16Data.buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const stopAllAudio = useCallback(() => {
    scheduledSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    scheduledSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  }, []);

  const cleanupSession = useCallback(() => {
     if (activeSessionRef.current) {
        try { activeSessionRef.current.close(); } catch (e) { console.error("Error closing session", e); }
        activeSessionRef.current = null;
    }

    if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
    }
    
    if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current = null;
    }

    if (inputSourceRef.current) {
        inputSourceRef.current.disconnect();
        inputSourceRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
    }
    aiRef.current = null; // Reset client on cleanup
  }, []);

  const handleDisconnect = useCallback(() => {
    setIsConnected(false);
    setIsConnecting(false);
    setStatus('Ready to Connect');
    setVolumeLevel(0);
    stopAllAudio();
    cleanupSession();
  }, [stopAllAudio, cleanupSession]);

  const connectToSession = async (isRetry = false) => {
    if (isConnecting || (isConnected && !isRetry)) return;
    
    if (!isRetry) {
        retryCount.current = 0;
        setError(null);
    }

    setIsConnecting(true);
    setStatus(isRetry ? `Reconnecting (${retryCount.current}/${MAX_RETRIES})...` : 'Requesting Mic Access...');
    isUserManualDisconnect.current = false;

    try {
      // 1. Initialize Audio Context
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass({ sampleRate: AUDIO_SAMPLE_RATE }); 
      audioContextRef.current = ctx;
      
      const outNode = ctx.createGain();
      outNode.connect(ctx.destination);
      outputNodeRef.current = outNode;

      // 2. Get Microphone Stream
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
            channelCount: 1, 
            sampleRate: AUDIO_SAMPLE_RATE,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        } 
      });
      streamRef.current = stream;

      setStatus('Connecting to AI...');

      // 3. Connect to Gemini Live API
      const ai = getAiClient();
      const sessionPromise = ai.live.connect({
        model: LIVE_API_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: `You are an advanced AI Health Consultant named 'Aura'.
          Your role is to listen to health concerns and provide professional guidance.
          Keep responses concise and conversational.
          If the user speaks Hindi, reply in Hindi.`,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
        },
        callbacks: {
            onopen: () => {
                setIsConnected(true);
                setIsConnecting(false);
                setStatus('Live Session Active');
                retryCount.current = 0; 
                console.log("Gemini Live Session Opened");
                setupAudioProcessing(ctx, stream, sessionPromise);
            },
            onmessage: async (message: LiveServerMessage) => {
                const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (audioData) {
                   await playAudioChunk(audioData);
                }
                if (message.serverContent?.interrupted) {
                    stopAllAudio();
                }
            },
            onclose: (e) => {
                if (!isUserManualDisconnect.current) handleAutoReconnect();
            },
            onerror: (err) => {
                console.error("Session error", err);
                if (!isUserManualDisconnect.current) handleAutoReconnect();
            }
        }
      });
      
      sessionPromise.then(sess => {
          activeSessionRef.current = sess;
      });

    } catch (err: any) {
        console.error("Connection failed:", err);
        if (!isUserManualDisconnect.current) {
            handleAutoReconnect();
        }
    }
  };

  const handleAutoReconnect = () => {
      if (retryCount.current < MAX_RETRIES) {
          retryCount.current += 1;
          setStatus(`Reconnecting attempt ${retryCount.current}...`);
          cleanupSession();
          
          setTimeout(() => {
              if (!isUserManualDisconnect.current) {
                  connectToSession(true);
              }
          }, 1000 + (retryCount.current * 500));
      } else {
          setError("Network unstable. Connection dropped.");
          handleDisconnect();
      }
  };

  const setupAudioProcessing = (ctx: AudioContext, stream: MediaStream, sessionPromise: Promise<any>) => {
    const source = ctx.createMediaStreamSource(stream);
    inputSourceRef.current = source;
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = async (e) => {
        if (isUserManualDisconnect.current) return;
        if (ctx.state === 'suspended') await ctx.resume();

        const inputData = e.inputBuffer.getChannelData(0);
        let effectiveData = inputData;
        if (isMuted) {
            effectiveData = new Float32Array(inputData.length).fill(0);
            setVolumeLevel(0);
        } else {
            let sum = 0;
            for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
            setVolumeLevel(Math.sqrt(sum / inputData.length));
        }

        const base64Audio = processAudioInput(effectiveData, ctx.sampleRate);
        
        sessionPromise.then(async session => {
            if (isUserManualDisconnect.current || !activeSessionRef.current) return;
            try {
                await session.sendRealtimeInput({
                    media: {
                        mimeType: `audio/pcm;rate=${AUDIO_SAMPLE_RATE}`,
                        data: base64Audio
                    }
                });
            } catch (err) {}
        });
    };
    source.connect(processor);
    processor.connect(ctx.destination);
  };

  const playAudioChunk = async (base64Audio: string) => {
     if (!audioContextRef.current || !outputNodeRef.current) return;
     const ctx = audioContextRef.current;
     if (ctx.state === 'closed') return;

     try {
        const audioBuffer = await decodeAudioData(decodeBase64(base64Audio), ctx, 24000, 1);
        const startTime = Math.max(ctx.currentTime, nextStartTimeRef.current);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(outputNodeRef.current);
        source.start(startTime);
        nextStartTimeRef.current = startTime + audioBuffer.duration;
        scheduledSourcesRef.current.add(source);
        source.onended = () => scheduledSourcesRef.current.delete(source);
     } catch (e) {
         console.error("Error decoding/playing audio", e);
     }
  };

  const handleManualDisconnect = () => {
      isUserManualDisconnect.current = true;
      handleDisconnect();
  };

  useEffect(() => {
    return () => {
        isUserManualDisconnect.current = true;
        handleDisconnect();
    };
  }, []);

  return (
    <div className="flex flex-col h-full bg-slate-900/60 rounded-[2.5rem] border border-white/5 overflow-hidden shadow-2xl relative">
      
      {/* Header Status Bar */}
      <div className="px-6 py-4 bg-white/5 border-b border-white/5 flex items-center justify-between backdrop-blur-sm z-10">
         <div className="flex items-center gap-3">
            <div className={`relative flex h-3 w-3`}>
              {isConnected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>}
              <span className={`relative inline-flex rounded-full h-3 w-3 ${isConnected ? 'bg-green-500' : 'bg-slate-500'}`}></span>
            </div>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300">
                {isConnected ? 'Live Uplink' : 'Offline'}
            </span>
         </div>
         <div className="flex items-center gap-2 px-3 py-1 bg-black/20 rounded-full border border-white/5">
             <Radio size={12} className={isConnected ? 'text-red-400 animate-pulse' : 'text-slate-600'} />
             <span className="text-[10px] font-mono text-slate-400">{status}</span>
         </div>
      </div>

      {/* Main Visualizer Area */}
      <div className="flex-1 relative flex flex-col items-center justify-center p-8">
         <div className={`absolute inset-0 transition-opacity duration-1000 ${isConnected ? 'opacity-100' : 'opacity-20'}`}>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-cyan-500/20 rounded-full blur-[80px] animate-pulse-slow"></div>
         </div>

         <div className="relative z-10">
            {isConnected && (
                <>
                    <div className="absolute inset-0 rounded-full border border-cyan-500/30"
                         style={{ transform: `scale(${1 + volumeLevel * 5})`, opacity: 0.5 - volumeLevel }}></div>
                    <div className="absolute inset-0 rounded-full border border-blue-500/30"
                         style={{ transform: `scale(${1 + volumeLevel * 8})`, opacity: 0.3 - volumeLevel }}></div>
                </>
            )}

            <div className={`relative w-48 h-48 rounded-full flex items-center justify-center transition-all duration-500 ${
                isConnected ? 'bg-slate-900/50 border-2 border-cyan-500/50 shadow-[0_0_50px_rgba(6,182,212,0.2)]' : 'bg-slate-800/50 border border-white/5'
            }`}>
               
               {isConnecting ? (
                   <Loader2 size={48} className="text-cyan-400 animate-spin" />
               ) : isConnected ? (
                   <div className="flex flex-col items-center gap-2">
                       <Activity size={48} className="text-cyan-400 animate-bounce" />
                       <div className="flex gap-1 h-4 items-end">
                           <div className="w-1 bg-cyan-400 rounded-full animate-[bounce_1s_infinite]" style={{height: `${20 + volumeLevel * 100}%`}}></div>
                           <div className="w-1 bg-cyan-400 rounded-full animate-[bounce_1.2s_infinite]" style={{height: `${30 + volumeLevel * 120}%`}}></div>
                           <div className="w-1 bg-cyan-400 rounded-full animate-[bounce_0.8s_infinite]" style={{height: `${20 + volumeLevel * 100}%`}}></div>
                       </div>
                   </div>
               ) : (
                   <div className="group cursor-pointer" onClick={() => connectToSession()}>
                       <div className="absolute inset-0 bg-cyan-500/20 rounded-full scale-0 group-hover:scale-100 transition-transform duration-500"></div>
                       <Video size={48} className="text-slate-400 group-hover:text-cyan-400 transition-colors relative z-10" />
                   </div>
               )}
            </div>
         </div>

         <div className="mt-12 text-center max-w-xs relative z-10">
             {error ? (
                 <div className="flex flex-col items-center gap-2">
                    <div className="flex items-center gap-2 text-red-400 bg-red-400/10 px-4 py-2 rounded-lg border border-red-400/20 justify-center">
                        <ShieldAlert size={16} />
                        <span className="text-xs font-bold">{error}</span>
                    </div>
                    <button onClick={() => connectToSession()} className="text-xs text-cyan-400 hover:text-cyan-300 underline mt-2 flex items-center gap-1">
                        <RefreshCw size={10} /> Retry Connection
                    </button>
                 </div>
             ) : (
                 <p className="text-slate-400 text-sm font-medium leading-relaxed">
                    {isConnected 
                        ? "Listening... Ask me about your symptoms, diet, or mental health." 
                        : "Start a real-time voice session with our AI Health Expert."}
                 </p>
             )}
         </div>
      </div>

      <div className="p-6 bg-slate-900/80 backdrop-blur-md border-t border-white/5 z-10">
         <div className="flex gap-4">
            {!isConnected ? (
                <button 
                    onClick={() => connectToSession()}
                    disabled={isConnecting}
                    className="flex-1 py-4 bg-gradient-to-r from-cyan-600 to-blue-600 rounded-2xl font-bold text-white text-xs uppercase tracking-widest shadow-lg shadow-cyan-900/40 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                >
                    {isConnecting ? <Loader2 size={16} className="animate-spin" /> : <Video size={16} />}
                    Start Live Consult
                </button>
            ) : (
                <>
                    <button 
                        onClick={() => setIsMuted(!isMuted)}
                        className={`flex-1 py-4 rounded-2xl font-bold text-xs uppercase tracking-widest border transition-all flex items-center justify-center gap-2 ${
                            isMuted 
                            ? 'bg-red-500/10 border-red-500/50 text-red-400' 
                            : 'bg-slate-800 border-white/10 text-slate-300 hover:bg-slate-700'
                        }`}
                    >
                        {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                        {isMuted ? 'Muted' : 'Mute'}
                    </button>
                    <button 
                        onClick={handleManualDisconnect}
                        className="flex-1 py-4 bg-red-500/10 border border-red-500/20 hover:bg-red-500 hover:text-white text-red-500 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                    >
                        <PhoneOff size={16} />
                        End
                    </button>
                </>
            )}
         </div>
      </div>

    </div>
  );
};