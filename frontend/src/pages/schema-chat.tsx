import { useState, useRef, useEffect } from "react";
import { Send, Mic, Activity, Network, Cpu } from "lucide-react";
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
  const [isFocused, setIsFocused] = useState(false);
  
  // Animation States for Cinematic Intro
  const [introStep, setIntroStep] = useState(0); 
  const [introText, setIntroText] = useState("");
  const [fadeState, setFadeState] = useState<"in" | "out">("in");
  const [randomHex, setRandomHex] = useState<string>("0x0000");
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const { getToken, isSignedIn } = useAuth();
  const clearChat = useAppStore((state) => state.clearChat);

  // Cinematic Intro Sequence (Fluid Fade In/Out)
  useEffect(() => {
    clearChat(); // Always wipe on fresh load
    setIntroStep(1);

    const sequence = async () => {
      // Small pause on mount
      await new Promise(r => setTimeout(r, 500));
      
      // Step 1: "Hello."
      setIntroText("Hello.");
      setFadeState("in");
      await new Promise(r => setTimeout(r, 1800));
      
      setFadeState("out");
      await new Promise(r => setTimeout(r, 800));
      
      // Step 2: Main Intro (Skip if already signed in)
      if (!isSignedIn) {
        setIntroStep(2);
        setIntroText("I am QuerySage.\nYour database intelligence.");
        setFadeState("in");
        await new Promise(r => setTimeout(r, 2500));

        setFadeState("out");
        await new Promise(r => setTimeout(r, 800));
      }

      // Step 3: Awaiting
      setIntroStep(3);
      if (isSignedIn) {
        setIntroText("How may I assist you today?");
      } else {
        setIntroText("Authentication required to access the core.");
      }
      setFadeState("in");
      
      await new Promise(r => setTimeout(r, 800));
      setIntroStep(4); // Input box appears
    };

    sequence();

    // Random hex generator for minimal background HUD
    const hexInterval = setInterval(() => {
      setRandomHex("0x" + Math.floor(Math.random()*16777215).toString(16).toUpperCase().padStart(6, '0'));
    }, 100);

    return () => clearInterval(hexInterval);
  }, [isSignedIn]);

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
          content: "Authentication required to interact with the database core. Please sign in.",
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

  return (
    <div className="h-full flex w-full bg-[#050505] relative overflow-hidden font-sans text-zinc-50">
      
      {/* Subtle Background Elements */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-indigo-900/10 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-violet-900/10 blur-[120px] rounded-full"></div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-0 relative z-10 w-full pt-16">
        
        <div className="flex-1 w-full px-4 md:px-8 max-w-5xl mx-auto overflow-y-auto custom-scrollbar" ref={scrollRef}>
            {messages.length === 0 ? (
              
              /* Cinematic AI Core Empty State */
              <div className="h-full min-h-[75vh] flex flex-col items-center justify-center">
                
                {/* Fluid Neural Core Orb */}
                <div className={`relative w-48 h-48 sm:w-64 sm:h-64 mb-16 flex items-center justify-center transition-all duration-1000 transform ${introStep >= 1 ? 'scale-100 opacity-100' : 'scale-75 opacity-0'}`}>
                  
                  {/* Base Glow */}
                  <div className={`absolute inset-0 rounded-full blur-2xl opacity-60 transition-colors duration-1000 ${
                    !isSignedIn ? 'bg-red-500' : isListening ? 'bg-amber-400' : 'bg-indigo-500'
                  }`}></div>

                  {/* Orb 1: Violet/Pink */}
                  <div className={`absolute w-[120%] h-[120%] -top-[10%] -left-[10%] rounded-full mix-blend-screen filter blur-[24px] animate-blob transition-colors duration-1000 ${
                    !isSignedIn ? 'bg-rose-500/80' : isListening ? 'bg-yellow-400/80' : 'bg-violet-500/80'
                  }`}></div>
                  
                  {/* Orb 2: Cyan/Blue */}
                  <div className={`absolute w-[110%] h-[110%] top-[0%] right-[0%] rounded-full mix-blend-screen filter blur-[20px] animate-blob animation-delay-2000 transition-colors duration-1000 ${
                    !isSignedIn ? 'bg-orange-500/80' : isListening ? 'bg-orange-400/80' : 'bg-cyan-400/80'
                  }`}></div>
                  
                  {/* Orb 3: Fuchsia/Purple */}
                  <div className={`absolute w-[100%] h-[100%] -bottom-[10%] left-[10%] rounded-full mix-blend-screen filter blur-[20px] animate-blob animation-delay-4000 transition-colors duration-1000 ${
                    !isSignedIn ? 'bg-red-600/80' : isListening ? 'bg-amber-500/80' : 'bg-fuchsia-500/80'
                  }`}></div>

                  {/* Core Surface for depth */}
                  <div className="absolute inset-2 rounded-full border border-white/5 backdrop-blur-[2px] shadow-[inset_0_0_30px_rgba(255,255,255,0.05)]"></div>
                  
                  {/* Pulse Effect when listening */}
                  {isListening && (
                    <div className="absolute inset-[-10%] rounded-full border border-amber-400/40 animate-ping" style={{ animationDuration: '2s' }}></div>
                  )}
                </div>
                
                {/* Cinematic Fading Text */}
                <div className="min-h-[100px] flex flex-col items-center justify-center text-center px-4">
                  <h1 className={`text-3xl md:text-4xl lg:text-5xl font-light tracking-wide leading-relaxed max-w-3xl mx-auto transition-all duration-700 ease-in-out whitespace-pre-wrap ${fadeState === 'in' ? 'opacity-100 transform translate-y-0' : 'opacity-0 transform translate-y-4'} ${!isSignedIn ? 'text-red-100' : 'text-zinc-50'}`}>
                    {introText}
                  </h1>
                </div>

                {/* Login Button (Fades in if unauthenticated and text is done) */}
                {!isSignedIn && introStep >= 4 && (
                   <div className="mt-12 animate-in fade-in slide-in-from-bottom-4 duration-1000">
                     <SignInButton mode="modal" forceRedirectUrl="/">
                        <Button className="bg-white hover:bg-zinc-200 text-black shadow-[0_0_20px_rgba(255,255,255,0.2)] rounded-full px-10 py-6 text-sm font-medium transition-all">
                          Authenticate to Continue
                        </Button>
                     </SignInButton>
                   </div>
                )}
              </div>
              
            ) : (
              
              /* Output Panels (No Chatbot Bubbles) */
              <div className="space-y-12 py-8 w-full max-w-4xl mx-auto mb-32">
                {messages.map((msg: ChatMessage, idx: number) => (
                  <div key={idx} className={`w-full flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    
                    {msg.role === "user" ? (
                      /* User Input: Minimalist text */
                      <div className="max-w-[75%] border-r-2 border-indigo-500/50 pr-6 text-right">
                         <div className="text-[10px] text-zinc-500 font-medium tracking-widest mb-2 uppercase">Your Query</div>
                         <div className="text-xl md:text-2xl font-light text-zinc-100 whitespace-pre-wrap tracking-wide leading-relaxed">
                           {msg.content}
                         </div>
                      </div>
                    ) : (
                      /* AI Output: Structured software panel */
                      <div className={`w-full max-w-[95%] border-l-2 pl-6 bg-gradient-to-r py-5 rounded-r-3xl shadow-sm ${msg.isAuthWarning ? 'border-red-500/50 from-red-950/20 to-transparent' : 'border-indigo-500/40 from-indigo-950/10 to-transparent'}`}>
                         <div className="text-[10px] text-zinc-500 font-medium tracking-widest mb-3 uppercase flex items-center gap-2">
                           <div className={`w-2 h-2 rounded-full animate-pulse ${msg.isAuthWarning ? 'bg-red-500' : 'bg-indigo-400'}`}></div>
                           QuerySage Output
                         </div>
                         <div className={`prose prose-base md:prose-lg dark:prose-invert max-w-none prose-p:leading-loose prose-pre:bg-[#0a0a0c] prose-pre:border prose-pre:border-zinc-800/80 prose-pre:rounded-xl font-light tracking-wide ${msg.isAuthWarning ? 'text-red-200' : 'text-zinc-200'}`}>
                           <ReactMarkdown>{msg.content}</ReactMarkdown>
                           {msg.isAuthWarning && (
                              <div className="mt-8">
                                <SignInButton mode="modal" forceRedirectUrl="/">
                                   <Button className="bg-red-950/40 border border-red-500/40 hover:bg-red-900/60 text-red-200 text-sm rounded-lg px-6 transition-all">
                                     Authenticate
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
                  <div className="w-full flex justify-start animate-in fade-in duration-300">
                    <div className="border-l-2 border-indigo-500/40 pl-6 py-2 bg-gradient-to-r from-indigo-950/10 to-transparent rounded-r-3xl w-64">
                      <div className="text-zinc-400 font-mono text-xs tracking-widest flex items-center gap-3">
                        <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
                        PROCESSING...
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
        </div>
        
        {/* Glassmorphic Input Console (Always active when ready) */}
        {(messages.length > 0 || introStep >= 4) && (
          <div className="w-full max-w-3xl mx-auto px-4 md:px-8 pb-8 pt-4 shrink-0 z-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
              <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="relative w-full group flex items-center">
                
                {/* Ambient glow behind input */}
                <div className={`absolute -inset-1 rounded-full blur-xl opacity-20 transition duration-500 ${!isSignedIn ? 'bg-red-500' : isListening ? 'bg-amber-400' : 'bg-indigo-500'}`}></div>
                
                <div className={`relative flex items-center w-full bg-[#111113]/80 backdrop-blur-2xl border rounded-full overflow-hidden transition-all duration-300 shadow-2xl ${
                  isFocused ? (!isSignedIn ? 'border-red-500/50' : 'border-indigo-500/50 shadow-[0_0_0_1px_rgba(99,102,241,0.2)]') 
                            : (!isSignedIn ? 'border-red-500/20' : 'border-white/10')
                }`}>
                  
                  {/* Voice Input Button */}
                  <div className="flex items-center justify-center pl-2">
                     <Button
                       type="button"
                       onClick={toggleListening}
                       variant="ghost"
                       size="icon"
                       className={`rounded-full h-12 w-12 transition-all ${isListening ? 'text-amber-400 bg-amber-400/10 animate-pulse' : 'text-zinc-500 hover:text-zinc-300'}`}
                     >
                       <Mic className="w-5 h-5" />
                     </Button>
                  </div>

                  <Input
                    placeholder={isListening ? "Listening..." : "Query your database..."}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    disabled={isLoading}
                    className="relative w-full h-14 border-none bg-transparent focus-visible:ring-0 text-[16px] text-zinc-100 placeholder:text-zinc-600 font-medium px-2"
                  />

                  {/* Send Button */}
                  <div className="flex items-center justify-center pr-2">
                    <Button 
                      id="jarvis-send-btn"
                      type="submit" 
                      disabled={!input.trim() || isLoading}
                      size="icon"
                      className={`rounded-full h-10 w-10 transition-all disabled:opacity-20 flex items-center justify-center ${!isSignedIn ? 'bg-red-500 hover:bg-red-400 text-white' : isListening ? 'bg-amber-400 hover:bg-amber-300 text-black' : 'bg-white hover:bg-zinc-200 text-black'}`}
                    >
                      <Send className="w-4 h-4 ml-0.5" />
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
