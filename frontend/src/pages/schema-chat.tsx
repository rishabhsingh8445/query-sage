import { useState, useRef, useEffect } from "react";
import { MessageSquare, Send, Database, Loader2, Plus, Trash2, Menu, Sparkles, Zap } from "lucide-react";
import { useAuth } from "@clerk/react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { useAppStore } from "@/store/useAppStore";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type Thread = {
  id: string;
  title: string;
  createdAt: string;
};

export default function SchemaChatPage() {
  const { chatMessages, setChatMessages, currentThreadId, setCurrentThreadId } = useAppStore();
  const messages = chatMessages || [];
  const setMessages = setChatMessages;
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { getToken } = useAuth();

  const [threads, setThreads] = useState<Thread[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    fetchThreads();
  }, []);

  const fetchThreads = async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/schema-chat/threads`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setThreads(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadThread = async (id: string) => {
    setCurrentThreadId(id);
    setIsSidebarOpen(false);
    try {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/schema-chat/threads/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch (e) {
      toast.error("Failed to load thread");
    }
  };

  const deleteThread = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const token = await getToken();
      await fetch(`${import.meta.env.VITE_API_URL}/api/schema-chat/threads/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (currentThreadId === id) {
        startNewChat();
      }
      fetchThreads();
    } catch (e) {
      toast.error("Failed to delete thread");
    }
  };

  const startNewChat = () => {
    setCurrentThreadId(null);
    setMessages([]);
    setIsSidebarOpen(false);
  };

  useEffect(() => {
    if (scrollRef.current) {
      const scrollElement = scrollRef.current;
      setTimeout(() => {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }, 100);
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage = input.trim();
    setInput("");
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
                  // Remove the blank assistant message we added
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
              if (data.thread_id) {
                setCurrentThreadId(data.thread_id);
                fetchThreads(); // Refresh thread list
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

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-background border-r border-border p-3 w-full">
      <Button onClick={startNewChat} className="mb-6 w-full justify-start gap-2 shadow-sm rounded-xl h-11 bg-card hover:bg-accent text-foreground border border-border" variant="outline">
        <Plus className="w-5 h-5" />
        New Chat
      </Button>
      
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-3">
        Recent Chats
      </div>
      
      <ScrollArea className="flex-1 -mx-2 px-2">
        <div className="space-y-1">
          {threads.length === 0 && (
            <div className="text-sm text-muted-foreground p-3 text-center opacity-70">No history yet.</div>
          )}
          {threads.map((t) => (
            <div
              key={t.id}
              onClick={() => loadThread(t.id)}
              className={`group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all duration-200 ${
                currentThreadId === t.id ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <MessageSquare className={`w-4 h-4 shrink-0 ${currentThreadId === t.id ? 'text-primary' : 'opacity-70'}`} />
                <span className="truncate text-sm">{t.title}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100 h-7 w-7 transition-opacity hover:bg-destructive/10 hover:text-destructive"
                onClick={(e) => deleteThread(e, t.id)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );

  return (
    <div className="h-full flex w-full bg-background relative overflow-hidden">
      {/* Background Ambient Glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[20%] left-[50%] -translate-x-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full mix-blend-screen filter blur-[120px] opacity-70 animate-pulse"></div>
      </div>

      {/* Desktop Sidebar (ChatGPT Style) */}
      <div className="hidden md:block w-[280px] shrink-0 h-full z-10 border-r border-border/50 bg-background/50 backdrop-blur-xl pt-16">
        <SidebarContent />
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative z-10 pt-16">
        
        {/* Mobile Header (When topbar is hidden, though app-layout handles mobile menu, we keep this for safety) */}
        <div className="md:hidden flex items-center p-4 border-b border-border/50 bg-background/80 backdrop-blur-md">
          <Sheet open={isSidebarOpen} onOpenChange={setIsSidebarOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0 mr-3">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-[280px]">
              <SidebarContent />
            </SheetContent>
          </Sheet>
          <span className="font-semibold text-primary">QuerySage</span>
        </div>

        <div className="flex-1 flex flex-col min-h-0 w-full max-w-4xl mx-auto px-4">
          
          <ScrollArea className="flex-1 w-full" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="h-full min-h-[70vh] flex flex-col items-center justify-center animate-in fade-in zoom-in duration-700">
                <div className="relative mb-8">
                  <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full scale-150"></div>
                  <div className="relative bg-card border border-primary/20 p-5 rounded-3xl shadow-2xl flex items-center justify-center">
                    <Database className="w-12 h-12 text-primary" />
                    <Sparkles className="absolute -top-3 -right-3 w-6 h-6 text-yellow-400 animate-pulse" />
                  </div>
                </div>
                <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4 text-center bg-gradient-to-br from-white to-white/50 bg-clip-text text-transparent">
                  Hi Sir, I'm QuerySage
                </h1>
                <p className="text-lg text-muted-foreground text-center max-w-lg mb-8">
                  Your autonomous database assistant. I can optimize queries, analyze schema relationships, and detect security anomalies in real-time. How may I help you today?
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl">
                  <Button variant="outline" className="justify-start h-auto p-4 bg-card/50 hover:bg-primary/10 border-border/50 hover:border-primary/30 transition-all text-left flex-col items-start group" onClick={() => setInput("Can you find any slow queries affecting performance?")}>
                    <span className="font-medium flex items-center group-hover:text-primary transition-colors"><Zap className="w-4 h-4 mr-2 text-primary"/> Find Slow Queries</span>
                    <span className="text-xs text-muted-foreground mt-1">Analyze pg_stat_statements</span>
                  </Button>
                  <Button variant="outline" className="justify-start h-auto p-4 bg-card/50 hover:bg-primary/10 border-border/50 hover:border-primary/30 transition-all text-left flex-col items-start group" onClick={() => setInput("Analyze my schema and suggest missing indexes.")}>
                    <span className="font-medium flex items-center group-hover:text-primary transition-colors"><Database className="w-4 h-4 mr-2 text-primary"/> Schema Analysis</span>
                    <span className="text-xs text-muted-foreground mt-1">Check for missing optimizations</span>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-6 py-8 pb-32 w-full">
                {messages.map((msg: ChatMessage, idx: number) => (
                  <div
                    key={idx}
                    className={`flex ${
                      msg.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] md:max-w-[80%] rounded-3xl px-6 py-4 text-[15px] leading-relaxed ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground rounded-tr-sm shadow-md"
                          : "bg-card/50 backdrop-blur-sm text-foreground rounded-tl-sm border border-border/50 shadow-sm"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                      ) : (
                        <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-black/50 prose-pre:border prose-pre:border-border/50">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {isLoading && messages[messages.length - 1]?.role === "user" && (
                  <div className="flex justify-start">
                    <div className="bg-card/50 backdrop-blur-sm rounded-3xl rounded-tl-sm px-6 py-5 border border-border/50 shadow-sm flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-primary animate-bounce"></div>
                      <div className="w-2 h-2 rounded-full bg-primary animate-bounce delay-75"></div>
                      <div className="w-2 h-2 rounded-full bg-primary animate-bounce delay-150"></div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
          
          <div className="p-4 pt-0 bg-gradient-to-t from-background via-background to-transparent w-full">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="relative max-w-4xl mx-auto shadow-2xl shadow-primary/5 rounded-full"
            >
              <Input
                placeholder="Ask QuerySage anything about your database..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isLoading}
                className="w-full rounded-full pl-6 pr-14 h-14 border border-border/50 bg-card/80 backdrop-blur-xl focus-visible:ring-1 focus-visible:ring-primary focus-visible:border-primary text-base shadow-inner"
              />
              <Button 
                type="submit" 
                disabled={!input.trim() || isLoading}
                size="icon"
                className="absolute right-1.5 top-1.5 rounded-full h-11 w-11 bg-primary hover:bg-primary/90 shadow-md transition-transform active:scale-95 text-white"
              >
                <Send className="w-5 h-5 ml-1" />
              </Button>
            </form>
            <div className="text-center mt-3">
              <span className="text-[11px] text-muted-foreground/60 tracking-wide">QuerySage can make mistakes. Always verify destructive queries.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
