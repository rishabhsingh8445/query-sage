import { useState, useRef, useEffect } from "react";
import { Send, Database, Zap, Bot, ShieldAlert, Sparkles, TerminalSquare, DatabaseZap, Search } from "lucide-react";
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
  const [isFocused, setIsFocused] = useState(false);
  
  // Cinematic Intro Sequence
  const [introStep, setIntroStep] = useState(0); 
  const [greetingText, setGreetingText] = useState("");
  const [subtitleText, setSubtitleText] = useState("");
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const { getToken, isSignedIn } = useAuth();
  const clearChat = useAppStore((state) => state.clearChat);

  // Elegant Software Boot Sequence
  useEffect(() => {
    clearChat(); // Fresh start
    
    const sequence = async () => {
      await new Promise(r => setTimeout(r, 500));
      setIntroStep(1);
      
      const greeting = "Hello.";
      let curr = "";
      for (let i = 0; i < greeting.length; i++) {
        curr += greeting[i];
        setGreetingText(curr);
        await new Promise(r => setTimeout(r, 60));
      }
      
      await new Promise(r => setTimeout(r, 600));
      setIntroStep(2);
      
      const subtitle = "I am QuerySage. Your intelligent database assistant.\nI can optimize SQL, analyze schemas, and secure your infrastructure.";
      curr = "";
      for (let i = 0; i < subtitle.length; i++) {
        curr += subtitle[i];
        setSubtitleText(curr);
        await new Promise(r => setTimeout(r, 30));
      }
      
      await new Promise(r => setTimeout(r, 800));
      setIntroStep(3); // Show input
    };

    sequence();
  }, [isSignedIn]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      const scrollElement = scrollRef.current;
      setTimeout(() => {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }, 100);
    }
  }, [messages, isLoading]);

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
          content: "Authentication required. Please sign in to connect to the database kernel.",
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
    <div className="h-full flex w-full bg-[#0A0A0B] text-zinc-100 relative overflow-hidden font-sans selection:bg-indigo-500/30">
      
      {/* Premium Desktop Software Background: Deep dark with subtle, elegant gradients */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-indigo-900/10 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-violet-900/10 blur-[120px] rounded-full"></div>
        {/* Subtle noise texture */}
        <div className="absolute inset-0 opacity-[0.015] bg-[url('https://grainy-gradients.vercel.app/noise.svg')]"></div>
      </div>

      {/* Main Container */}
      <div className="flex-1 flex flex-col h-full relative z-10 w-full max-w-5xl mx-auto">
        
        {/* Scrollable Content Area */}
        <div className="flex-1 w-full px-4 sm:px-8 overflow-y-auto custom-scrollbar flex flex-col pt-24 pb-8" ref={scrollRef}>
            
            {messages.length === 0 ? (
              
              /* Elegant Onboarding Experience */
              <div className="flex-1 flex flex-col justify-center max-w-3xl mx-auto w-full animate-in fade-in duration-1000">
                
                {/* Greeting */}
                <h1 className="text-4xl sm:text-5xl md:text-6xl font-medium tracking-tight text-white mb-6">
                  {greetingText}
                  {introStep === 1 && <span className="animate-pulse ml-1 text-zinc-500">|</span>}
                </h1>
                
                {/* Subtitle */}
                <div className="min-h-[80px]">
                  <p className="text-xl sm:text-2xl text-zinc-400 font-light leading-relaxed whitespace-pre-wrap">
                    {subtitleText}
                    {introStep === 2 && <span className="animate-pulse ml-1 text-zinc-600">|</span>}
                  </p>
                </div>

                {/* Authentication Block if not signed in */}
                {!isSignedIn && introStep >= 3 && (
                   <div className="mt-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
                     <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-6 backdrop-blur-md flex items-center justify-between">
                       <div>
                         <h3 className="text-zinc-200 font-medium mb-1">Authentication Required</h3>
                         <p className="text-zinc-500 text-sm">Please sign in to access the database assistant.</p>
                       </div>
                       <SignInButton mode="modal" forceRedirectUrl="/">
                          <Button className="bg-white hover:bg-zinc-200 text-black rounded-lg px-6 font-medium shadow-lg transition-all">
                            Sign In
                          </Button>
                       </SignInButton>
                     </div>
                   </div>
                )}
              </div>
              
            ) : (
              
              /* Sleek Software Chat Interface */
              <div className="flex flex-col space-y-8 w-full mx-auto">
                {messages.map((msg: ChatMessage, idx: number) => (
                  <div key={idx} className={`flex flex-col w-full animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                    
                    {msg.role === "user" ? (
                      /* User Message: Prominent, large text like a document header */
                      <div className="w-full mb-2 group">
                        <div className="flex items-center gap-3 text-zinc-500 mb-2">
                           <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center">
                             <Search className="w-3 h-3 text-zinc-400" />
                           </div>
                           <span className="text-xs font-medium tracking-wider uppercase">Query</span>
                        </div>
                        <div className="text-xl md:text-2xl font-medium text-zinc-100 whitespace-pre-wrap leading-relaxed pl-9">
                          {msg.content}
                        </div>
                      </div>
                    ) : (
                      /* AI Response: Structured software block */
                      <div className="w-full pl-9">
                        <div className="flex items-center gap-3 text-indigo-400/80 mb-3 ml-[-36px]">
                           <div className="w-6 h-6 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                             <Sparkles className="w-3 h-3 text-indigo-400" />
                           </div>
                           <span className="text-xs font-medium tracking-wider uppercase">QuerySage</span>
                        </div>
                        
                        <div className={`prose prose-zinc dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-[#111113] prose-pre:border prose-pre:border-zinc-800/80 prose-pre:rounded-xl text-[15px] md:text-[16px] text-zinc-300 ${msg.isAuthWarning ? 'text-red-400 bg-red-950/20 border border-red-900/30 p-4 rounded-xl' : ''}`}>
                           <ReactMarkdown>{msg.content}</ReactMarkdown>
                           
                           {msg.isAuthWarning && (
                              <div className="mt-4 pt-4 border-t border-red-900/30">
                                <SignInButton mode="modal" forceRedirectUrl="/">
                                   <Button className="bg-white hover:bg-zinc-200 text-black rounded-lg px-6 text-sm font-medium transition-all">
                                     Sign In to Continue
                                   </Button>
                                </SignInButton>
                              </div>
                           )}
                        </div>
                      </div>
                    )}

                  </div>
                ))}
                
                {/* Loading State */}
                {isLoading && messages[messages.length - 1]?.role === "user" && (
                  <div className="w-full pl-9 animate-in fade-in duration-300">
                     <div className="flex items-center gap-3 text-zinc-500 ml-[-36px]">
                       <div className="w-6 h-6 rounded-full bg-zinc-800/50 flex items-center justify-center">
                         <div className="w-3 h-3 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin"></div>
                       </div>
                       <span className="text-xs font-medium tracking-wider uppercase">Analyzing...</span>
                     </div>
                  </div>
                )}
              </div>
            )}
        </div>
        
        {/* Raycast-style Command Input */}
        {(messages.length > 0 || introStep >= 3) && isSignedIn && (
          <div className="w-full px-4 sm:px-8 pb-8 pt-4 shrink-0 animate-in fade-in slide-in-from-bottom-8 duration-700">
              <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="relative w-full max-w-3xl mx-auto">
                
                <div className={`relative flex items-center w-full bg-[#18181B]/80 backdrop-blur-xl border rounded-2xl overflow-hidden transition-all duration-300 shadow-2xl ${
                  isFocused ? 'border-zinc-600 shadow-[0_0_0_1px_rgba(82,82,91,0.5)]' : 'border-zinc-800 shadow-black/50'
                }`}>
                  
                  <div className="pl-4 pr-2 text-zinc-500">
                    <TerminalSquare className="w-5 h-5" />
                  </div>

                  <Input
                    placeholder="Ask QuerySage about your database..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    disabled={isLoading}
                    className="relative w-full h-14 border-none bg-transparent focus-visible:ring-0 text-[16px] text-zinc-100 placeholder:text-zinc-600 font-medium"
                  />

                  <div className="pr-3 pl-2">
                    <Button 
                      type="submit" 
                      disabled={!input.trim() || isLoading}
                      size="sm"
                      className="rounded-lg h-9 w-9 bg-white hover:bg-zinc-200 text-black transition-all disabled:opacity-20 flex items-center justify-center"
                    >
                      <Send className="w-4 h-4 ml-0.5" />
                    </Button>
                  </div>
                </div>
                
                <div className="text-center mt-3 text-xs text-zinc-600 font-medium tracking-wide">
                  QuerySage DB Assistant Software • Secure Connection
                </div>
              </form>
          </div>
        )}
      </div>
    </div>
  );
}
