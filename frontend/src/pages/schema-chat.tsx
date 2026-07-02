import { useState, useRef, useEffect } from "react";
import { Send, Database, Loader2, Sparkles, Zap, Bot, Mic, Fingerprint } from "lucide-react";
import { useAuth, SignInButton } from "@clerk/react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { useAppStore } from "@/store/useAppStore";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  isAuthWarning?: boolean;
};

const BOOT_SEQUENCE = [
  "> INITIALIZING NEURAL NETWORK...",
  "> CONNECTING TO POSTGRESQL CORES...",
  "> BYPASSING MAINFRAME SECURITY PROTOCOLS...",
  "> SCANNING FOR SECURITY THREATS...",
  "> SYSTEMS OPTIMAL."
];

export default function SchemaChatPage() {
  const { chatMessages, setChatMessages, currentThreadId, setCurrentThreadId } = useAppStore();
  const messages = chatMessages || [];
  const setMessages = setChatMessages;
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [bootPhase, setBootPhase] = useState<"init" | "diagnostics" | "ready">("init");
  const [bootText, setBootText] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const { getToken, isSignedIn } = useAuth();

  const clearChat = useAppStore((state) => state.clearChat);

  // Cinematic Boot Sequence Logic
  useEffect(() => {
    // ALWAYS clear chat on fresh load to ensure the boot animation plays and old sessions are wiped
    clearChat();
    
    setBootPhase("diagnostics");
    let currentLine = 0;
    
    const interval = setInterval(() => {
      if (currentLine < BOOT_SEQUENCE.length) {
        setBootText(prev => [...prev, BOOT_SEQUENCE[currentLine]]);
        currentLine++;
      } else {
        clearInterval(interval);
        setTimeout(() => setBootPhase("ready"), 1000); // Wait 1 sec before showing UI
      }
    }, 600); // 600ms per diagnostic line

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      const scrollElement = scrollRef.current;
      setTimeout(() => {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }, 100);
    }
  }, [messages]);

  // Handle Speech Recognition (Web Speech API)
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
    recognition.lang = 'en-US'; // Can be expanded to Hindi 'hi-IN' based on settings

    recognition.onstart = () => setIsListening(true);
    
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
      setIsListening(false);
      // Auto-send after a short delay so user can see what was typed
      setTimeout(() => {
         document.getElementById("jarvis-send-btn")?.click();
      }, 500);
    };

    recognition.onerror = (event: any) => {
      console.error(event.error);
      setIsListening(false);
    };

    recognition.onend = () => setIsListening(false);

    recognition.start();
  };

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage = input.trim();
    setInput("");
    
    // Auth Intercept - The Cinematic Way
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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: userMessage,
          chat_history: messages,
          thread_id: currentThreadId || undefined,
          timezone_offset: new Date().getTimezoneOffset(),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to send message");
      }

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
            } catch (e) {
              // Ignore parse errors
            }
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

  // Render Boot Sequence
  if (bootPhase === "diagnostics") {
    return (
      <div className="h-full flex flex-col items-center justify-center w-full bg-[#0a0a0a] relative overflow-hidden font-mono text-cyan-500 p-8">
         <div className="max-w-2xl w-full">
           {bootText.map((line, idx) => (
             <div key={idx} className="mb-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
               {line}
             </div>
           ))}
           <div className="w-4 h-5 bg-cyan-500 animate-pulse mt-2"></div>
         </div>
      </div>
    );
  }

  return (
    <div className="h-full flex w-full bg-[#0a0a0a] relative overflow-hidden font-sans">
      
      {/* HUD Elements (Sci-Fi Aesthetics) */}
      <div className="absolute top-6 left-6 z-0 pointer-events-none text-[10px] text-cyan-500/50 font-mono tracking-widest hidden md:block">
        SYS.LOAD: [||||||....] <br/>
        NET.UPLINK: SECURE <br/>
        MEM.CORE: 42%
      </div>
      <div className="absolute top-6 right-24 z-0 pointer-events-none text-[10px] text-cyan-500/50 font-mono tracking-widest text-right hidden md:block">
        THREAT_LVL: <span className={!isSignedIn ? "text-red-500/80 font-bold animate-pulse" : "text-green-500/80"}>{!isSignedIn ? "CRITICAL" : "ZERO"}</span> <br/>
        LATENCY: 14ms <br/>
        BIOMETRIC: {!isSignedIn ? "UNVERIFIED" : "VERIFIED"}
      </div>

      {/* Background Ambient Glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className={`absolute top-[20%] left-[50%] -translate-x-1/2 w-[800px] h-[800px] rounded-full mix-blend-screen filter blur-[150px] opacity-60 animate-pulse transition-colors duration-1000 ${!isSignedIn ? 'bg-red-500/10' : 'bg-primary/10'}`}></div>
        <div className={`absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full mix-blend-screen filter blur-[120px] opacity-40 transition-colors duration-1000 ${!isSignedIn ? 'bg-orange-500/10' : 'bg-blue-500/10'}`}></div>
      </div>

      {/* Main Chat Area - 100% Width */}
      <div className="flex-1 flex flex-col min-h-0 relative z-10 w-full pt-16">
        
        <div className="flex-1 w-full px-4 md:px-8 max-w-5xl mx-auto overflow-y-auto" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="h-full min-h-[70vh] flex flex-col items-center justify-center animate-in fade-in zoom-in duration-1000">
                <div className="relative mb-8 group">
                  <div className={`absolute inset-0 blur-3xl rounded-full scale-150 transition-all duration-700 group-hover:scale-[2.0] ${!isSignedIn ? 'bg-red-500/20 group-hover:bg-red-500/30' : 'bg-primary/30 group-hover:bg-primary/40'}`}></div>
                  <div className={`relative border p-6 rounded-[2rem] shadow-2xl flex items-center justify-center backdrop-blur-xl transition-colors duration-500 ${!isSignedIn ? 'bg-black/60 border-red-500/20' : 'bg-black/40 border-white/10'}`}>
                    <Bot className={`w-16 h-16 drop-shadow-[0_0_15px_rgba(255,255,255,0.5)] transition-colors duration-500 ${!isSignedIn ? 'text-red-400' : 'text-white'}`} />
                    {isSignedIn && <Sparkles className="absolute -top-4 -right-4 w-8 h-8 text-yellow-400 animate-pulse drop-shadow-[0_0_10px_rgba(250,204,21,0.8)]" />}
                  </div>
                </div>
                
                <h1 className={`text-5xl md:text-6xl font-extrabold tracking-tight mb-6 text-center bg-gradient-to-br bg-clip-text text-transparent drop-shadow-sm ${!isSignedIn ? 'from-red-400 to-orange-400' : 'from-white via-white/90 to-white/40'}`}>
                  {isSignedIn ? "Welcome to QuerySage." : "Identify Yourself."}
                </h1>
                
                <p className="text-lg md:text-xl text-muted-foreground/80 text-center max-w-2xl mb-12 font-medium leading-relaxed">
                  {isSignedIn ? (
                    <>QuerySage is online. Systems are nominal. <br/><span className="text-white/60">Awaiting your command. 🚀</span></>
                  ) : (
                    <>QuerySage mainframe is locked. Unidentified signature detected. <br/><span className="text-red-400/80">Awaiting biometric verification. ⚠️</span></>
                  )}
                </p>

                {isSignedIn ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-3xl">
                    <Button variant="outline" className="justify-start h-auto p-5 bg-white/5 hover:bg-white/10 border-white/10 hover:border-white/20 transition-all duration-300 text-left flex-col items-start group rounded-2xl" onClick={() => setInput("Can you find any slow queries affecting performance?")}>
                      <span className="font-semibold flex items-center text-white/90 group-hover:text-white text-base"><Zap className="w-5 h-5 mr-3 text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.6)]"/> Run Diagnostics</span>
                      <span className="text-sm text-white/40 mt-1.5 ml-8">Analyze database load and latency</span>
                    </Button>
                    <Button variant="outline" className="justify-start h-auto p-5 bg-white/5 hover:bg-white/10 border-white/10 hover:border-white/20 transition-all duration-300 text-left flex-col items-start group rounded-2xl" onClick={() => setInput("Analyze my schema and suggest missing indexes.")}>
                      <span className="font-semibold flex items-center text-white/90 group-hover:text-white text-base"><Database className="w-5 h-5 mr-3 text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.6)]"/> Schema Analysis</span>
                      <span className="text-sm text-white/40 mt-1.5 ml-8">Scan for structural vulnerabilities</span>
                    </Button>
                  </div>
                ) : (
                   <SignInButton mode="modal" forceRedirectUrl="/">
                      <Button className="bg-red-600 hover:bg-red-700 text-white border-none shadow-[0_0_20px_rgba(220,38,38,0.6)] gap-3 rounded-full px-8 py-6 text-lg animate-pulse">
                        <Fingerprint className="w-6 h-6" />
                        VERIFY IDENTITY
                      </Button>
                   </SignInButton>
                )}
              </div>
            ) : (
              <div className="space-y-8 py-8 w-full max-w-4xl mx-auto">
                {messages.map((msg: ChatMessage, idx: number) => (
                  <div
                    key={idx}
                    className={`flex ${
                      msg.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] md:max-w-[80%] rounded-[2rem] px-7 py-5 text-[16px] leading-relaxed shadow-xl ${
                        msg.role === "user"
                          ? "bg-white/10 text-white rounded-tr-sm border border-white/5 backdrop-blur-md"
                          : msg.isAuthWarning 
                            ? "bg-red-500/10 border border-red-500/30 text-red-100 rounded-tl-sm backdrop-blur-md"
                            : "bg-transparent text-white/90 rounded-tl-sm"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <div className="whitespace-pre-wrap font-medium">{msg.content}</div>
                      ) : (
                        <div className="prose prose-base md:prose-lg dark:prose-invert max-w-none prose-p:leading-loose prose-pre:bg-white/5 prose-pre:border prose-pre:border-white/10 prose-pre:rounded-xl prose-pre:backdrop-blur-md">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                          
                          {/* Render Biometric Auth Button if it's an auth warning */}
                          {msg.isAuthWarning && (
                             <div className="mt-6">
                               <SignInButton mode="modal" forceRedirectUrl="/">
                                  <Button className="bg-red-600 hover:bg-red-700 text-white border-none shadow-[0_0_15px_rgba(220,38,38,0.5)] gap-2 rounded-full px-6">
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
                  <div className="flex justify-start pl-4">
                    <div className="bg-transparent rounded-3xl rounded-tl-sm px-6 py-5 flex items-center gap-3">
                      <div className="w-2.5 h-2.5 rounded-full bg-white/50 animate-bounce shadow-[0_0_10px_rgba(255,255,255,0.5)]"></div>
                      <div className="w-2.5 h-2.5 rounded-full bg-white/50 animate-bounce delay-75 shadow-[0_0_10px_rgba(255,255,255,0.5)]"></div>
                      <div className="w-2.5 h-2.5 rounded-full bg-white/50 animate-bounce delay-150 shadow-[0_0_10px_rgba(255,255,255,0.5)]"></div>
                    </div>
                  </div>
                )}
              </div>
            )}
        </div>
        
        {/* Docked Input Box - Flex Layout (Not Absolute) */}
        <div className="w-full max-w-4xl mx-auto px-4 md:px-8 pb-6 pt-2 shrink-0 z-20">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="relative w-full shadow-[0_0_40px_rgba(0,0,0,0.5)] rounded-full group flex items-center"
            >
              <div className={`absolute -inset-0.5 rounded-full blur opacity-50 group-hover:opacity-100 transition duration-500 ${!isSignedIn && messages.length > 0 ? 'bg-gradient-to-r from-red-500/30 to-orange-500/30' : 'bg-gradient-to-r from-primary/30 to-blue-500/30'}`}></div>
              
              <Input
                placeholder="Talk to QuerySage or type a command..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isLoading}
                className="relative w-full rounded-l-full rounded-r-none pl-8 pr-4 h-16 border-y border-l border-white/10 bg-black/60 backdrop-blur-2xl focus-visible:ring-0 focus-visible:border-white/30 text-lg text-white shadow-inner placeholder:text-white/30"
              />
              
              {/* Voice Input Button */}
              <div className="relative h-16 bg-black/60 border-y border-white/10 backdrop-blur-2xl flex items-center px-2">
                 <Button
                   type="button"
                   onClick={toggleListening}
                   variant="ghost"
                   size="icon"
                   className={`rounded-full h-10 w-10 transition-all ${isListening ? 'bg-red-500/20 text-red-400 animate-pulse' : 'text-white/50 hover:text-white hover:bg-white/10'}`}
                 >
                   <Mic className="w-5 h-5" />
                 </Button>
              </div>

              {/* Send Button */}
              <div className="relative h-16 border-y border-r border-white/10 bg-black/60 backdrop-blur-2xl rounded-r-full flex items-center pr-2">
                <Button 
                  id="jarvis-send-btn"
                  type="submit" 
                  disabled={!input.trim() || isLoading}
                  size="icon"
                  className={`rounded-full h-12 w-12 text-black transition-all active:scale-95 disabled:bg-white/20 disabled:text-white/40 ${!isSignedIn && messages.length > 0 ? 'bg-red-500 hover:bg-red-400 shadow-[0_0_15px_rgba(239,68,68,0.3)]' : 'bg-white hover:bg-white/90 shadow-[0_0_15px_rgba(255,255,255,0.3)]'}`}
                >
                  <Send className="w-5 h-5 ml-1" />
                </Button>
              </div>
            </form>
            <div className="text-center mt-4 flex items-center justify-center gap-2">
              <div className={`w-2 h-2 rounded-full animate-pulse ${!isSignedIn ? 'bg-red-500' : 'bg-green-500'}`}></div>
              <span className="text-[10px] text-white/30 tracking-widest font-mono uppercase">
                {isSignedIn ? 'Connection Secure. Auth Validated.' : 'Awaiting Authentication. System Locked.'}
              </span>
            </div>
        </div>
      </div>
    </div>
  );
}
