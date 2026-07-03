import { useState, useRef, useEffect } from "react";
import { Send, Mic, Fingerprint, Activity, Network, Cpu } from "lucide-react";
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

export default function SchemaChatPage() {
  const { chatMessages, setChatMessages, currentThreadId, setCurrentThreadId } = useAppStore();
  const messages = chatMessages || [];
  const setMessages = setChatMessages;
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  
  // Animation States for Cinematic Intro
  const [introStep, setIntroStep] = useState(0); 
  const [introText, setIntroText] = useState("");
  const [randomHex, setRandomHex] = useState<string>("0x0000");
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const { getToken, isSignedIn } = useAuth();
  const clearChat = useAppStore((state) => state.clearChat);

  // Cinematic Intro Sequence
  useEffect(() => {
    clearChat(); // Always wipe on fresh load
    setIntroStep(1);

    const sequence = async () => {
      // Step 1: "Hello."
      await typeText("Hello, Sir.");
      await new Promise(r => setTimeout(r, 1000));
      
      // Step 2: Main Intro
      setIntroStep(2);
      await typeText("I am QuerySage. I can optimize your SQL queries, analyze your database schema, and detect vulnerabilities.");
      await new Promise(r => setTimeout(r, 1500));

      // Step 3: Awaiting
      setIntroStep(3);
      if (isSignedIn) {
        await typeText("How may I assist you today?");
      } else {
        await typeText("Unidentified biological signature. Please verify your identity to access the mainframe.");
      }
      
      setIntroStep(4); // Input box appears
    };

    sequence();

    // Random hex generator for background HUD
    const hexInterval = setInterval(() => {
      setRandomHex("0x" + Math.floor(Math.random()*16777215).toString(16).toUpperCase().padStart(6, '0'));
    }, 100);

    return () => clearInterval(hexInterval);
  }, [isSignedIn]);

  const typeText = async (text: string) => {
    setIntroText("");
    let curr = "";
    for (let i = 0; i < text.length; i++) {
      curr += text[i];
      setIntroText(curr);
      await new Promise(r => setTimeout(r, 30)); // 30ms per character
    }
  };

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      const scrollElement = scrollRef.current;
      setTimeout(() => {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }, 100);
    }
  }, [messages, isListening, introStep]);

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
          content: "⚠️ **ACCESS DENIED:** You must authenticate to interact with the database core.",
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

  // JARVIS Theme Colors
  const coreColor = !isSignedIn ? "red" : isListening ? "yellow" : "cyan";

  return (
    <div className="h-full flex w-full bg-[#02040a] relative overflow-hidden font-sans text-cyan-50">
      
      {/* HUD Holographic Grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#06b6d408_1px,transparent_1px),linear-gradient(to_bottom,#06b6d408_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(ellipse_70%_70%_at_50%_50%,#000_30%,transparent_100%)] pointer-events-none z-0"></div>

      {/* Live HUD Elements (Corners) */}
      <div className="absolute top-6 left-6 z-0 pointer-events-none text-[10px] text-cyan-500/50 font-mono tracking-widest hidden md:block">
        <div className="flex items-center gap-2 mb-1"><Activity className="w-3 h-3 text-cyan-500/80"/> SYS.LOAD: [||||||....]</div>
        <div className="flex items-center gap-2 mb-1"><Network className="w-3 h-3 text-cyan-500/80"/> NET.UPLINK: SECURE</div>
        <div className="flex items-center gap-2"><Cpu className="w-3 h-3 text-cyan-500/80"/> MEM.CORE: {randomHex}</div>
      </div>
      <div className="absolute top-6 right-24 z-0 pointer-events-none text-[10px] font-mono tracking-widest text-right hidden md:block">
        <div className={`mb-1 ${!isSignedIn ? "text-red-500 font-bold animate-pulse" : "text-cyan-500/50"}`}>THREAT_LVL: {!isSignedIn ? "CRITICAL" : "ZERO"}</div>
        <div className="text-cyan-500/50 mb-1">LATENCY: {Math.floor(Math.random() * 20 + 10)}ms</div>
        <div className="text-cyan-500/50">BIOMETRIC: {!isSignedIn ? "UNVERIFIED" : "VERIFIED"}</div>
      </div>

      {/* Dynamic Ambient Glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0 flex items-center justify-center">
        <div className={`w-[900px] h-[900px] rounded-full mix-blend-screen filter blur-[180px] opacity-[0.15] transition-colors duration-1000 ${
          !isSignedIn ? 'bg-red-600' : isListening ? 'bg-yellow-500' : 'bg-cyan-500'
        } ${isListening ? 'animate-pulse' : ''}`}></div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-0 relative z-10 w-full pt-16">
        
        <div className="flex-1 w-full px-4 md:px-8 max-w-5xl mx-auto overflow-y-auto custom-scrollbar" ref={scrollRef}>
            {messages.length === 0 ? (
              
              /* Cinematic AI Core Empty State */
              <div className="h-full min-h-[75vh] flex flex-col items-center justify-center animate-in fade-in duration-1000">
                
                {/* Central Arc Reactor */}
                <div className="relative flex items-center justify-center w-56 h-56 md:w-80 md:h-80 mb-16 shrink-0 transition-transform duration-700 hover:scale-105">
                   {/* Outer Scanning Ring */}
                   <div className={`absolute inset-0 rounded-full border-t-2 border-l-2 border-transparent animate-spin duration-1000 ${!isSignedIn ? 'border-t-red-500 border-l-red-500/20' : isListening ? 'border-t-yellow-400 border-l-yellow-400/20' : 'border-t-cyan-400 border-l-cyan-400/20'}`} style={{ animationDuration: isListening ? '1s' : '3s' }}></div>
                   
                   {/* Middle Tech Ring */}
                   <div className={`absolute inset-4 rounded-full border-2 border-dashed opacity-30 animate-[spin_reverse_linear_infinite] ${!isSignedIn ? 'border-red-400' : isListening ? 'border-yellow-300' : 'border-cyan-300'}`} style={{ animationDuration: '15s' }}></div>
                   
                   {/* Inner Solid Ring */}
                   <div className={`absolute inset-10 rounded-full border border-opacity-20 animate-[spin_linear_infinite] ${!isSignedIn ? 'border-red-400' : isListening ? 'border-yellow-300' : 'border-cyan-300'}`} style={{ animationDuration: '8s' }}></div>
                   
                   {/* Center Glowing Core */}
                   <div className={`absolute inset-16 rounded-full backdrop-blur-md flex items-center justify-center shadow-[0_0_80px_rgba(0,0,0,0.8)] transition-all duration-700 ${!isSignedIn ? 'bg-red-500/10 shadow-red-500/30' : isListening ? 'bg-yellow-500/10 shadow-yellow-500/40 scale-110' : 'bg-cyan-500/10 shadow-cyan-500/30'}`}>
                      {/* Pulse Effect */}
                      <div className={`absolute inset-0 rounded-full animate-ping opacity-20 ${!isSignedIn ? 'bg-red-400' : isListening ? 'bg-yellow-400' : 'bg-cyan-400'}`} style={{ animationDuration: '3s' }}></div>
                   </div>
                </div>
                
                {/* Cinematic Typewriter Text */}
                <div className="min-h-[120px] flex flex-col items-center justify-center text-center">
                  <h1 className={`text-3xl md:text-4xl lg:text-5xl font-light tracking-wide leading-relaxed max-w-4xl mx-auto drop-shadow-[0_0_25px_rgba(255,255,255,0.4)] ${!isSignedIn ? 'text-red-100' : 'text-cyan-50'}`}>
                    {introText}<span className="animate-pulse font-bold opacity-70">|</span>
                  </h1>
                </div>

                {/* Login Button (Fades in if unauthenticated and text is done) */}
                {!isSignedIn && introStep >= 4 && (
                   <div className="mt-12 animate-in fade-in slide-in-from-bottom-4 duration-1000">
                     <SignInButton mode="modal" forceRedirectUrl="/">
                        <Button className="bg-transparent border border-red-500/50 hover:bg-red-500/10 text-red-400 hover:text-red-300 shadow-[0_0_20px_rgba(220,38,38,0.2)] gap-3 rounded-none px-10 py-6 text-sm tracking-[0.3em] font-mono uppercase transition-all">
                          <Fingerprint className="w-5 h-5" />
                          Initiate Override
                        </Button>
                     </SignInButton>
                   </div>
                )}
              </div>
              
            ) : (
              
              /* HUD Style Chat View (Not standard Chatbot bubbles) */
              <div className="space-y-12 py-8 w-full max-w-5xl mx-auto mb-32">
                {messages.map((msg: ChatMessage, idx: number) => (
                  <div key={idx} className={`w-full flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    
                    {msg.role === "user" ? (
                      /* User Query: Align Right, Minimalist HUD style */
                      <div className="max-w-[75%] border-r-2 border-cyan-500/50 pr-6 text-right">
                         <div className="text-[10px] text-cyan-500/60 font-mono tracking-widest mb-2 uppercase">Command Input</div>
                         <div className="text-lg md:text-xl font-light text-cyan-50 whitespace-pre-wrap tracking-wide leading-relaxed">
                           {msg.content}
                         </div>
                      </div>
                    ) : (
                      /* AI Response: Align Left, Holographic Data Block */
                      <div className="w-full max-w-[90%] md:max-w-[85%] border-l-2 border-cyan-400/60 pl-6 bg-gradient-to-r from-cyan-950/30 to-transparent py-4 rounded-r-3xl">
                         <div className="text-[10px] text-cyan-400/80 font-mono tracking-widest mb-3 uppercase flex items-center gap-2">
                           <Activity className="w-3 h-3 animate-pulse" /> System Output
                         </div>
                         <div className={`prose prose-base md:prose-lg dark:prose-invert max-w-none prose-p:leading-loose prose-pre:bg-black/60 prose-pre:border prose-pre:border-cyan-500/20 prose-pre:rounded-none prose-pre:shadow-[inset_0_0_20px_rgba(0,0,0,0.8)] font-light tracking-wide ${msg.isAuthWarning ? 'text-red-200' : 'text-cyan-50'}`}>
                           <ReactMarkdown>{msg.content}</ReactMarkdown>
                           {msg.isAuthWarning && (
                              <div className="mt-8">
                                <SignInButton mode="modal" forceRedirectUrl="/">
                                   <Button className="bg-red-950/40 border border-red-500/40 hover:bg-red-900/60 text-red-300 font-mono uppercase tracking-widest text-xs rounded-none px-6 shadow-[0_0_15px_rgba(220,38,38,0.2)]">
                                     Verify Credentials
                                   </Button>
                                </SignInButton>
                              </div>
                           )}
                         </div>
                      </div>
                    )}

                  </div>
                ))}
                
                {isLoading && messages[messages.length - 1]?.role === "user" && (
                  <div className="w-full flex justify-start">
                    <div className="border-l-2 border-cyan-500/50 pl-6 py-2">
                      <div className="text-cyan-400 font-mono text-xs tracking-[0.2em] flex items-center gap-3">
                        <div className="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
                        PROCESSING DATA...
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
        </div>
        
        {/* Holographic Input Console (Fades in only when intro is done, or if already chatting) */}
        {(messages.length > 0 || introStep >= 4) && (
          <div className="w-full max-w-3xl mx-auto px-4 md:px-8 pb-8 pt-4 shrink-0 z-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
              <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="relative w-full group flex items-center">
                
                <div className={`relative flex w-full bg-black/40 backdrop-blur-2xl border-b-2 overflow-hidden transition-all duration-300 ${!isSignedIn ? 'border-red-500/50' : isListening ? 'border-yellow-400' : 'border-cyan-500/50'} focus-within:border-cyan-400 focus-within:bg-black/60`}>
                  
                  {/* Voice Input Button */}
                  <div className="flex items-center justify-center pl-4">
                     <Button
                       type="button"
                       onClick={toggleListening}
                       variant="ghost"
                       size="icon"
                       className={`rounded-none h-12 w-12 transition-all ${isListening ? 'text-yellow-400 animate-pulse' : 'text-cyan-500/50 hover:text-cyan-400'}`}
                     >
                       <Mic className="w-5 h-5" />
                     </Button>
                  </div>

                  <Input
                    placeholder={isListening ? "Acoustic sensor active..." : "Enter system command..."}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={isLoading}
                    className="relative w-full h-14 border-none bg-transparent focus-visible:ring-0 text-lg md:text-xl text-cyan-50 placeholder:text-cyan-500/30 font-light tracking-wide rounded-none"
                  />

                  {/* Send Button */}
                  <div className="flex items-center justify-center pr-4">
                    <Button 
                      id="jarvis-send-btn"
                      type="submit" 
                      disabled={!input.trim() || isLoading}
                      size="icon"
                      variant="ghost"
                      className={`rounded-none h-12 w-12 transition-all disabled:opacity-20 ${!isSignedIn ? 'text-red-500 hover:text-red-400' : isListening ? 'text-yellow-400' : 'text-cyan-500 hover:text-cyan-300 hover:scale-110'}`}
                    >
                      <Send className="w-5 h-5" />
                    </Button>
                  </div>
                </div>
              </form>
          </div>
        )}
      </div>
    </div>
  );
}
