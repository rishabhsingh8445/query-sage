import { useState, useRef, useEffect } from "react";
import { Send, Database, Loader2, Sparkles, Zap, Bot, Mic, Fingerprint, Activity, Cpu, Network } from "lucide-react";
import { useAuth, SignInButton } from "@clerk/react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { useAppStore } from "@/store/useAppStore";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  isAuthWarning?: boolean;
};

// JARVIS Boot Sequence Data
const BOOT_LOGS = [
  "OS: J.A.R.V.I.S. v3.4.1 [ONLINE]",
  "KERNEL: MICRO-CORE INITIATED",
  "NEURAL_NET: SYNAPSES LINKED",
  "SECURITY: MAINFRAME ENCRYPTED",
  "UPLINK: SATELLITE 4 ESTABLISHED",
  "MODULES: NLP, SQL, ML DEPLOYED",
  "STATUS: AWAITING COMMAND..."
];

export default function SchemaChatPage() {
  const { chatMessages, setChatMessages, currentThreadId, setCurrentThreadId } = useAppStore();
  const messages = chatMessages || [];
  const setMessages = setChatMessages;
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  
  // Animation States
  const [bootPhase, setBootPhase] = useState<"init" | "diagnostics" | "ready">("diagnostics");
  const [bootLogs, setBootLogs] = useState<string[]>([]);
  const [randomHex, setRandomHex] = useState<string>("0x0000");
  const [welcomeText, setWelcomeText] = useState("");
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const { getToken, isSignedIn } = useAuth();
  const clearChat = useAppStore((state) => state.clearChat);

  // Cinematic Boot Sequence
  useEffect(() => {
    clearChat();
    setBootPhase("diagnostics");
    
    // Rapidly generate boot logs
    let logIndex = 0;
    const logInterval = setInterval(() => {
      if (logIndex < BOOT_LOGS.length) {
        setBootLogs(prev => [...prev, BOOT_LOGS[logIndex]]);
        logIndex++;
      } else {
        clearInterval(logInterval);
        setTimeout(() => setBootPhase("ready"), 1500); // Dramatic pause before UI
      }
    }, 300);

    // Random hex generator for background effect
    const hexInterval = setInterval(() => {
      setRandomHex("0x" + Math.floor(Math.random()*16777215).toString(16).toUpperCase());
    }, 100);

    return () => {
      clearInterval(logInterval);
      clearInterval(hexInterval);
    };
  }, []);

  // Typewriter effect for Welcome Text
  useEffect(() => {
    if (bootPhase === "ready") {
      const fullText = isSignedIn ? "Welcome to QuerySage." : "Identify Yourself.";
      let curr = "";
      let i = 0;
      const typeInterval = setInterval(() => {
        if (i < fullText.length) {
          curr += fullText[i];
          setWelcomeText(curr);
          i++;
        } else {
          clearInterval(typeInterval);
        }
      }, 50);
      return () => clearInterval(typeInterval);
    }
    return undefined;
  }, [bootPhase, isSignedIn]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      const scrollElement = scrollRef.current;
      setTimeout(() => {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }, 100);
    }
  }, [messages, isListening, bootPhase]);

  const toggleListening = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast.error("Voice recognition is not supported in this browser.");
      return;
    }

    if (isListening) {
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => setIsListening(true);
    
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
      setIsListening(false);
      setTimeout(() => {
         document.getElementById("jarvis-send-btn")?.click();
      }, 500);
    };

    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    const userMessage = input.trim();
    setInput("");
    
    if (!isSignedIn) {
      setMessages((prev: ChatMessage[]) => [
        ...(prev || []), 
        { role: "user", content: userMessage },
        { 
          role: "assistant", 
          content: "⚠️ **WARNING:** Unidentified biological signature detected.\n\nAccess to Database Mainframe denied. Please verify your identity to proceed.",
          isAuthWarning: true 
        }
      ]);
      return;
    }

    setMessages((prev: ChatMessage[]) => [...(prev || []), { role: "user", content: userMessage }]);
    setIsLoading(true);
    let assistantMessageAdded = false;

    try {
      const token = await getToken();
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/schema-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: userMessage,
          chat_history: messages,
          thread_id: currentThreadId || undefined,
          timezone_offset: new Date().getTimezoneOffset(),
        }),
      });

      if (!response.ok) throw new Error("Failed to send message");

      setMessages((prev: ChatMessage[]) => [...(prev || []), { role: "assistant", content: "" }]);
      assistantMessageAdded = true;

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      let currentEvent = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.replace("event: ", "").trim();
          } else if (line.startsWith("data: ")) {
            const dataStr = line.replace("data: ", "").trim();
            if (!dataStr) continue;
            
            if (currentEvent === "error") {
              try {
                const errorMsg = JSON.parse(dataStr);
                toast.error(errorMsg);
                setMessages((prev: ChatMessage[]) => {
                  const newMsgs = [...(prev || [])];
                  if (newMsgs[newMsgs.length - 1]?.role === "assistant" && !newMsgs[newMsgs.length - 1].content) {
                    return newMsgs.slice(0, -1);
                  }
                  return newMsgs;
                });
              } catch (e) {}
              continue;
            }

            try {
              const data = JSON.parse(dataStr);
              if (data.thread_id && !currentThreadId) {
                setCurrentThreadId(data.thread_id);
              } else if (typeof data === "string" && currentEvent !== "error") {
                setMessages((prev: ChatMessage[]) => {
                  const newMsgs = [...(prev || [])];
                  const last = newMsgs[newMsgs.length - 1];
                  if (last && last.role === "assistant") {
                    last.content += data;
                  }
                  return newMsgs;
                });
              }
            } catch (e) {}
          }
        }
      }
    } catch (err) {
      toast.error("Failed to communicate with AI");
      if (assistantMessageAdded) {
        setMessages((prev: ChatMessage[]) => (prev || []).slice(0, -1));
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Render Cinematic Boot Phase
  if (bootPhase === "diagnostics") {
    return (
      <div className="h-full flex flex-col items-center justify-center w-full bg-[#030712] relative overflow-hidden text-cyan-500">
         {/* Background Grid */}
         <div className="absolute inset-0 bg-[linear-gradient(to_right,#06b6d41a_1px,transparent_1px),linear-gradient(to_bottom,#06b6d41a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_70%,transparent_100%)]"></div>
         
         <div className="absolute inset-0 flex items-center justify-center opacity-20">
           <div className="w-[800px] h-[800px] border border-cyan-500/20 rounded-full animate-[spin_20s_linear_infinite]"></div>
           <div className="absolute w-[600px] h-[600px] border border-cyan-400/20 rounded-full animate-[spin_15s_linear_infinite_reverse]"></div>
         </div>

         <div className="relative z-10 flex flex-col md:flex-row items-center gap-12 max-w-4xl w-full px-8">
           {/* Arc Reactor Core Animation */}
           <div className="relative flex items-center justify-center w-48 h-48 md:w-64 md:h-64 shrink-0">
             <div className="absolute inset-0 rounded-full border-4 border-t-cyan-400 border-r-transparent border-b-cyan-600 border-l-transparent animate-spin duration-700 shadow-[0_0_30px_rgba(34,211,238,0.5)]"></div>
             <div className="absolute inset-4 rounded-full border-2 border-dashed border-cyan-300/50 animate-[spin_3s_linear_infinite_reverse]"></div>
             <div className="absolute inset-10 rounded-full border border-cyan-500/30 animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]"></div>
             <div className="absolute inset-14 bg-cyan-500/20 rounded-full backdrop-blur-xl flex items-center justify-center shadow-[inset_0_0_20px_rgba(34,211,238,0.8)]">
               <Bot className="w-12 h-12 text-cyan-100 animate-pulse" />
             </div>
           </div>

           {/* Terminal Logs */}
           <div className="flex-1 font-mono text-sm md:text-base text-cyan-400/90 shadow-2xl bg-black/40 border border-cyan-500/20 p-6 rounded-lg backdrop-blur-md w-full">
             <div className="flex justify-between items-center mb-4 border-b border-cyan-500/30 pb-2">
               <span className="text-cyan-200 font-bold">JARVIS // TERMINAL</span>
               <span className="text-cyan-600 text-xs">{randomHex}</span>
             </div>
             {bootLogs.map((line, idx) => (
               <div key={idx} className="mb-2 animate-in fade-in slide-in-from-left-4 duration-200">
                 {line}
               </div>
             ))}
             <div className="w-3 h-5 bg-cyan-400 animate-pulse mt-2"></div>
           </div>
         </div>
      </div>
    );
  }

  // JARVIS Main UI
  const themeColor = !isSignedIn ? "red" : isListening ? "yellow" : "cyan";

  return (
    <div className="h-full flex w-full bg-[#030712] relative overflow-hidden font-sans">
      
      {/* Background Holographic Grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#06b6d405_1px,transparent_1px),linear-gradient(to_bottom,#06b6d405_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,#000_40%,transparent_100%)] pointer-events-none z-0"></div>

      {/* Live HUD Elements (Corners) */}
      <div className="absolute top-4 left-4 z-0 pointer-events-none text-[10px] text-cyan-500/60 font-mono tracking-widest hidden md:block">
        <div className="flex items-center gap-2 mb-1"><Activity className="w-3 h-3 text-cyan-400"/> SYS.LOAD: [||||||....]</div>
        <div className="flex items-center gap-2 mb-1"><Network className="w-3 h-3 text-cyan-400"/> NET.UPLINK: SECURE</div>
        <div className="flex items-center gap-2"><Cpu className="w-3 h-3 text-cyan-400"/> MEM.CORE: {randomHex}</div>
      </div>
      <div className="absolute top-4 right-24 z-0 pointer-events-none text-[10px] font-mono tracking-widest text-right hidden md:block">
        <div className={`mb-1 ${!isSignedIn ? "text-red-500 font-bold animate-pulse" : "text-green-500/80"}`}>THREAT_LVL: {!isSignedIn ? "CRITICAL" : "ZERO"}</div>
        <div className="text-cyan-500/60 mb-1">LATENCY: {Math.floor(Math.random() * 20 + 10)}ms</div>
        <div className="text-cyan-500/60">BIOMETRIC: {!isSignedIn ? "UNVERIFIED" : "VERIFIED"}</div>
      </div>

      {/* Dynamic Ambient Core Glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0 flex items-center justify-center">
        <div className={`w-[800px] h-[800px] rounded-full mix-blend-screen filter blur-[150px] opacity-30 transition-colors duration-1000 ${
          !isSignedIn ? 'bg-red-600' : isListening ? 'bg-yellow-500' : 'bg-cyan-600'
        } ${isListening ? 'animate-pulse' : ''}`}></div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-h-0 relative z-10 w-full pt-16">
        
        <div className="flex-1 w-full px-4 md:px-8 max-w-5xl mx-auto overflow-y-auto custom-scrollbar" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="h-full min-h-[70vh] flex flex-col items-center justify-center animate-in zoom-in duration-1000">
                
                {/* Central Rotating HUD Ring */}
                <div className="relative flex items-center justify-center w-64 h-64 mb-8">
                   {/* Outer Scanner Ring */}
                   <div className={`absolute inset-0 rounded-full border border-t-[3px] border-l-transparent border-r-transparent border-b-transparent animate-spin duration-1000 transition-colors ${!isSignedIn ? 'border-t-red-500' : isListening ? 'border-t-yellow-400' : 'border-t-cyan-400'}`} style={{ animationDuration: isListening ? '1s' : '4s' }}></div>
                   
                   {/* Inner Dashed Ring */}
                   <div className={`absolute inset-4 rounded-full border-2 border-dashed opacity-40 animate-[spin_reverse_linear_infinite] transition-colors ${!isSignedIn ? 'border-red-400' : isListening ? 'border-yellow-300' : 'border-cyan-300'}`} style={{ animationDuration: '8s' }}></div>
                   
                   {/* Core Pulse */}
                   <div className={`absolute inset-12 rounded-full backdrop-blur-xl flex items-center justify-center shadow-[0_0_60px_rgba(0,0,0,0.5)] transition-colors duration-500 ${!isSignedIn ? 'bg-red-500/10 shadow-red-500/20' : isListening ? 'bg-yellow-500/20 shadow-yellow-500/30 scale-110' : 'bg-cyan-500/10 shadow-cyan-500/20'}`}>
                      {isListening ? (
                        <div className="flex items-center gap-1">
                          <div className="w-1 h-8 bg-yellow-400 animate-[bounce_0.8s_infinite]"></div>
                          <div className="w-1 h-12 bg-yellow-400 animate-[bounce_0.6s_infinite_0.1s]"></div>
                          <div className="w-1 h-8 bg-yellow-400 animate-[bounce_0.8s_infinite_0.2s]"></div>
                        </div>
                      ) : (
                        <Bot className={`w-16 h-16 drop-shadow-[0_0_15px_rgba(255,255,255,0.8)] transition-colors ${!isSignedIn ? 'text-red-400' : 'text-cyan-100'}`} />
                      )}
                      {isSignedIn && !isListening && <Sparkles className="absolute -top-2 -right-2 w-6 h-6 text-cyan-300 animate-pulse" />}
                   </div>
                </div>
                
                {/* Typewriter Text */}
                <h1 className={`text-4xl md:text-5xl font-extrabold tracking-tight mb-4 text-center bg-gradient-to-br bg-clip-text text-transparent drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] h-16 ${!isSignedIn ? 'from-red-400 to-orange-500' : 'from-cyan-100 to-cyan-500'}`}>
                  {welcomeText}<span className="animate-pulse">|</span>
                </h1>
                
                <p className="text-lg md:text-xl text-muted-foreground/80 text-center max-w-2xl mb-12 font-medium">
                  {isSignedIn ? (
                    <>Systems nominal. Neural net linked. <br/><span className="text-cyan-400/80">Awaiting voice or text input...</span></>
                  ) : (
                    <>Mainframe locked. Unidentified signature. <br/><span className="text-red-400/80">Biometric verification required.</span></>
                  )}
                </p>

                {isSignedIn ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-500 fill-mode-both">
                    <Button variant="outline" className="justify-start h-auto p-5 bg-cyan-950/20 hover:bg-cyan-900/40 border-cyan-500/20 hover:border-cyan-400/40 transition-all duration-300 flex-col items-start group rounded-xl" onClick={() => setInput("Can you find any slow queries affecting performance?")}>
                      <span className="font-semibold flex items-center text-cyan-100 group-hover:text-white text-base"><Zap className="w-5 h-5 mr-3 text-cyan-400"/> System Diagnostics</span>
                      <span className="text-sm text-cyan-500/60 mt-1.5 ml-8">Analyze query latency</span>
                    </Button>
                    <Button variant="outline" className="justify-start h-auto p-5 bg-cyan-950/20 hover:bg-cyan-900/40 border-cyan-500/20 hover:border-cyan-400/40 transition-all duration-300 flex-col items-start group rounded-xl" onClick={() => setInput("Analyze my schema and suggest missing indexes.")}>
                      <span className="font-semibold flex items-center text-cyan-100 group-hover:text-white text-base"><Database className="w-5 h-5 mr-3 text-cyan-400"/> Database Scans</span>
                      <span className="text-sm text-cyan-500/60 mt-1.5 ml-8">Detect structural anomalies</span>
                    </Button>
                  </div>
                ) : (
                   <SignInButton mode="modal" forceRedirectUrl="/">
                      <Button className="bg-red-600 hover:bg-red-500 text-white border-none shadow-[0_0_30px_rgba(220,38,38,0.4)] gap-3 rounded-full px-8 py-6 text-lg animate-pulse hover:animate-none transition-all hover:scale-105">
                        <Fingerprint className="w-6 h-6" />
                        OVERRIDE SECURITY (LOGIN)
                      </Button>
                   </SignInButton>
                )}
              </div>
            ) : (
              <div className="space-y-6 py-8 w-full max-w-4xl mx-auto">
                {messages.map((msg: ChatMessage, idx: number) => (
                  <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] md:max-w-[80%] rounded-2xl px-6 py-4 text-[16px] leading-relaxed shadow-lg ${
                        msg.role === "user"
                          ? "bg-cyan-950/40 text-cyan-50 rounded-tr-sm border border-cyan-500/20 backdrop-blur-md"
                          : msg.isAuthWarning 
                            ? "bg-red-950/60 border border-red-500/40 text-red-100 rounded-tl-sm backdrop-blur-md"
                            : "bg-black/40 text-cyan-50 rounded-tl-sm border border-cyan-500/10 backdrop-blur-sm"
                      }`}>
                      {msg.role === "user" ? (
                        <div className="whitespace-pre-wrap font-medium">{msg.content}</div>
                      ) : (
                        <div className="prose prose-base md:prose-lg dark:prose-invert max-w-none prose-p:leading-loose prose-pre:bg-black/50 prose-pre:border prose-pre:border-cyan-500/20 prose-pre:rounded-xl prose-pre:shadow-[inset_0_0_15px_rgba(0,0,0,0.5)]">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                          {msg.isAuthWarning && (
                             <div className="mt-6">
                               <SignInButton mode="modal" forceRedirectUrl="/">
                                  <Button className="bg-red-600 hover:bg-red-500 text-white border-none shadow-[0_0_20px_rgba(220,38,38,0.4)] gap-2 rounded-full px-6">
                                    <Fingerprint className="w-4 h-4" />
                                    VERIFY IDENTITY
                                  </Button>
                               </SignInButton>
                             </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {isLoading && messages[messages.length - 1]?.role === "user" && (
                  <div className="flex justify-start pl-4 animate-in fade-in duration-500">
                    <div className="bg-black/40 border border-cyan-500/20 rounded-full px-6 py-4 flex items-center gap-2 backdrop-blur-md">
                      <div className="text-cyan-400 font-mono text-xs tracking-widest mr-2">PROCESSING</div>
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></div>
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse delay-75"></div>
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse delay-150"></div>
                    </div>
                  </div>
                )}
              </div>
            )}
        </div>
        
        {/* Holographic Input Console */}
        <div className="w-full max-w-4xl mx-auto px-4 md:px-8 pb-8 pt-4 shrink-0 z-20">
            <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="relative w-full group flex items-center">
              
              {/* Outer Glow */}
              <div className={`absolute -inset-1 rounded-2xl blur opacity-30 transition duration-500 ${!isSignedIn ? 'bg-red-500' : isListening ? 'bg-yellow-400' : 'bg-cyan-500'}`}></div>
              
              <div className={`relative flex w-full bg-black/60 backdrop-blur-xl border rounded-2xl overflow-hidden transition-colors duration-300 ${!isSignedIn ? 'border-red-500/30' : isListening ? 'border-yellow-500/50 shadow-[0_0_30px_rgba(234,179,8,0.2)]' : 'border-cyan-500/30'}`}>
                
                {/* Voice Input Button */}
                <div className="flex items-center justify-center pl-2">
                   <Button
                     type="button"
                     onClick={toggleListening}
                     variant="ghost"
                     size="icon"
                     className={`rounded-full h-12 w-12 transition-all ${isListening ? 'bg-yellow-500/20 text-yellow-400 animate-pulse' : 'text-cyan-500/50 hover:text-cyan-400 hover:bg-cyan-900/30'}`}
                   >
                     <Mic className="w-6 h-6" />
                   </Button>
                </div>

                <Input
                  placeholder={isListening ? "Listening to audio feed..." : "Enter command query..."}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={isLoading}
                  className="relative w-full h-16 border-none bg-transparent focus-visible:ring-0 text-lg text-cyan-50 placeholder:text-cyan-500/40 font-medium"
                />

                {/* Send Button */}
                <div className="flex items-center justify-center pr-2">
                  <Button 
                    id="jarvis-send-btn"
                    type="submit" 
                    disabled={!input.trim() || isLoading}
                    size="icon"
                    className={`rounded-xl h-12 w-12 text-black transition-all active:scale-95 disabled:opacity-30 ${!isSignedIn ? 'bg-red-500 hover:bg-red-400 shadow-[0_0_15px_rgba(239,68,68,0.3)]' : isListening ? 'bg-yellow-400 hover:bg-yellow-300' : 'bg-cyan-400 hover:bg-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.3)]'}`}
                  >
                    <Send className="w-5 h-5 ml-1" />
                  </Button>
                </div>
              </div>
            </form>

            {/* Status Footer */}
            <div className="text-center mt-3 flex items-center justify-center gap-3">
              <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${!isSignedIn ? 'bg-red-500' : isListening ? 'bg-yellow-400' : 'bg-cyan-500'}`}></div>
              <span className={`text-[10px] tracking-[0.2em] font-mono uppercase ${!isSignedIn ? 'text-red-500/60' : isListening ? 'text-yellow-500/60' : 'text-cyan-500/60'}`}>
                {isListening ? 'AUDIO FEED ACTIVE. SPEAK NOW.' : isSignedIn ? 'J.A.R.V.I.S. INTERFACE ONLINE.' : 'MAINFRAME ACCESS DENIED.'}
              </span>
            </div>
        </div>
      </div>
    </div>
  );
}
