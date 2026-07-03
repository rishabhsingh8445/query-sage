import { useState, useEffect } from "react";
import { useAuth, SignInButton, useClerk } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Database, Code2, Zap, SearchCode, Loader2, Activity } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

type ViewState = "dashboard" | "sql-optimizer" | "db-analyzer";

export default function SchemaChatPage() {
  const { getToken, isSignedIn } = useAuth();
  const clerk = useClerk();
  const [view, setView] = useState<ViewState>("dashboard");
  
  // Cinematic Boot State
  const [bootStep, setBootStep] = useState(0); 
  const [typingText, setTypingText] = useState("");

  // SQL Optimizer State
  const [rawSql, setRawSql] = useState("");
  const [optimizedOutput, setOptimizedOutput] = useState("");
  const [isOptimizing, setIsOptimizing] = useState(false);

  // DB Analyzer State
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  
  useEffect(() => {
    if (view !== "dashboard") return;
    setBootStep(1);
    
    const typeOut = async (text: string, delay = 50) => {
      setTypingText("");
      for (let i = 0; i <= text.length; i++) {
        setTypingText(text.slice(0, i));
        await new Promise(r => setTimeout(r, delay));
      }
    };

    const sequence = async () => {
      await new Promise(r => setTimeout(r, 800));
      await typeOut("[ SYSTEM INITIATED ]");
      await new Promise(r => setTimeout(r, 800));
      await typeOut("I am QuerySage. Awaiting command module selection...");
      await new Promise(r => setTimeout(r, 1000));
      setBootStep(2); // Show modules
    };
    sequence();
  }, [view]);

  const handleOptimize = async (sqlToOptimize: string) => {
    if (!isSignedIn) {
      toast.error("AUTH REQUIRED. MODULE LOCKED.");
      return;
    }
    if (!sqlToOptimize.trim()) return;
    
    setIsOptimizing(true);
    setOptimizedOutput("");

    try {
      const token = await getToken();
      const baseUrl = import.meta.env.VITE_API_URL || "";
      const apiUrl = `${baseUrl}/api/schema-chat`;
      
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: `Please optimize the following SQL query. Return the optimized code block and a brief explanation of the performance improvements (e.g. index utilization, joins):\n\n\`\`\`sql\n${sqlToOptimize}\n\`\`\``,
          chat_history: [],
          timezone_offset: new Date().getTimezoneOffset(),
        }),
      });

      if (!response.ok) throw new Error("Connection failed.");

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
                setOptimizedOutput(prev => prev + `\n\n[ CRITICAL ERROR: ${errorMsg} ]`);
              } catch (e) {}
              continue;
            }

            try {
              const data = JSON.parse(dataStr);
              if (typeof data === "string" && currentEvent !== "error") {
                setOptimizedOutput(prev => prev + data);
              }
            } catch (e) {}
          }
        }
      }
    } catch (err) {
      console.error(err);
      setOptimizedOutput("[ TELEMETRY LOST. RECONNECT TO MAINFRAME. ]");
    } finally {
      setIsOptimizing(false);
    }
  };

  const mockConnectDb = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSignedIn) {
      toast.error("AUTH REQUIRED. LINK TERMINATED.");
      return;
    }
    setIsConnecting(true);
    await new Promise(r => setTimeout(r, 1500));
    setIsConnecting(false);
    setIsConnected(true);
    toast.success("MAINFRAME LINK ESTABLISHED.");
  };

  const MOCK_SLOW_QUERIES = [
    { id: 1, query: "SELECT * FROM users u LEFT JOIN orders o ON u.id = o.user_id WHERE u.created_at < '2024-01-01'", duration: "1250ms", calls: 45 },
    { id: 2, query: "SELECT count(*) FROM audit_logs WHERE action = 'LOGIN' GROUP BY user_id", duration: "840ms", calls: 120 },
    { id: 3, query: "SELECT u.name, p.title FROM users u JOIN posts p ON u.id = p.author_id ORDER BY p.created_at DESC", duration: "610ms", calls: 350 },
  ];

  return (
    <div className="h-full w-full relative overflow-hidden flex flex-col hud-font text-[#00f3ff] selection:bg-[#00f3ff]/30">
      
      {/* Header (Full Width, Top Corners) */}
      <div className="relative z-20 w-full px-6 py-6 flex items-center justify-between shrink-0 border-b border-[#00f3ff]/20 bg-black/60 backdrop-blur-md">
        <div className="flex items-center gap-4">
           {view !== "dashboard" && (
              <Button variant="ghost" size="icon" onClick={() => setView("dashboard")} className="text-[#00f3ff]/60 hover:text-[#00f3ff] hover:bg-[#00f3ff]/10">
                <ArrowLeft className="w-5 h-5" />
              </Button>
           )}
           <div>
              <h1 className="text-2xl font-bold tracking-[0.2em] uppercase flex items-center gap-3">
                 <Database className="w-5 h-5 text-[#ff9f0a]" />
                 J.A.R.V.I.S // QS
              </h1>
              <p className="text-xs text-[#00f3ff]/50 mt-1 uppercase tracking-widest">Enterprise Database Intelligence Toolkit</p>
           </div>
        </div>
        
        {!isSignedIn && (
           <SignInButton mode="modal" forceRedirectUrl="/">
              <Button className="bg-transparent border border-[#ff9f0a] text-[#ff9f0a] hover:bg-[#ff9f0a]/20 uppercase tracking-widest font-bold px-6 py-2 h-9 rounded-none text-xs">
                [ Authenticate ]
              </Button>
           </SignInButton>
        )}
      </div>

      <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex-1 flex flex-col min-h-0 py-8">

        {/* --- VIEW: DASHBOARD --- */}
        {view === "dashboard" && (
          <div className="flex flex-col items-center justify-center flex-1 min-h-0 w-full">
            
            {/* Rotating HUD Rings */}
            <div className={`relative w-48 h-48 sm:w-64 sm:h-64 mb-8 flex items-center justify-center transition-all duration-1000 transform ${bootStep >= 1 ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`}>
               <div className="hud-ring hud-ring-1"></div>
               <div className="hud-ring hud-ring-2"></div>
               <div className="hud-ring hud-ring-3"></div>
               <Database className="w-12 h-12 text-[#00f3ff] opacity-80" />
            </div>

            {/* Terminal Typing Text */}
            <div className="min-h-[40px] flex items-center justify-center text-center px-4 mb-12">
              <h2 className="text-lg md:text-xl font-bold uppercase tracking-widest typing-text">
                {typingText}
              </h2>
            </div>

            {/* Dashboard Command Modules */}
            {bootStep >= 2 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl animate-in zoom-in-95 fade-in duration-700">
                
                {/* Module 1 */}
                <div 
                  className="hud-panel p-8 cursor-pointer group flex flex-col items-start justify-center h-48"
                  onClick={() => {
                    if (!isSignedIn) clerk.openSignIn();
                    else setView("sql-optimizer");
                  }}
                >
                  <div className="hud-scanline"></div>
                  <div className="flex items-center gap-4 mb-4">
                     <Code2 className="w-8 h-8 text-[#ff9f0a] group-hover:scale-110 transition-transform" />
                     <h3 className="text-xl font-bold uppercase tracking-widest text-white group-hover:text-[#ff9f0a] transition-colors">SQL Optimizer</h3>
                  </div>
                  <p className="text-sm text-[#00f3ff]/60 leading-relaxed uppercase tracking-wide">Initiate query refactoring sequence and analyze index matrices.</p>
                </div>

                {/* Module 2 */}
                <div 
                  className="hud-panel p-8 cursor-pointer group flex flex-col items-start justify-center h-48"
                  onClick={() => {
                    if (!isSignedIn) clerk.openSignIn();
                    else setView("db-analyzer");
                  }}
                >
                  <div className="hud-scanline"></div>
                  <div className="flex items-center gap-4 mb-4">
                     <SearchCode className="w-8 h-8 text-[#ff9f0a] group-hover:scale-110 transition-transform" />
                     <h3 className="text-xl font-bold uppercase tracking-widest text-white group-hover:text-[#ff9f0a] transition-colors">Telemetry Analyzer</h3>
                  </div>
                  <p className="text-sm text-[#00f3ff]/60 leading-relaxed uppercase tracking-wide">Establish secure uplink to fetch live slow-query telemetry data.</p>
                </div>

              </div>
            )}
          </div>
        )}

        {/* --- VIEW: SQL OPTIMIZER --- */}
        {view === "sql-optimizer" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in slide-in-from-right-8 duration-500 flex-1 min-h-0">
            
            {/* Left Pane: Input */}
            <div className="hud-panel flex flex-col h-full min-h-0">
               <div className="hud-scanline"></div>
               <div className="border-b border-[#00f3ff]/20 p-4 shrink-0 bg-[#00f3ff]/5">
                 <h3 className="text-lg font-bold uppercase tracking-widest flex items-center gap-2">
                   <Code2 className="w-5 h-5 text-[#ff9f0a]" /> [ RAW_QUERY_INPUT ]
                 </h3>
               </div>
               <div className="flex-1 flex flex-col min-h-0 p-4">
                  <Textarea 
                     value={rawSql}
                     onChange={(e) => setRawSql(e.target.value)}
                     placeholder="> Enter SQL sequence here..."
                     className="flex-1 w-full h-full resize-none bg-black/40 border border-[#00f3ff]/20 focus-visible:ring-1 focus-visible:ring-[#00f3ff] text-[#00f3ff] hud-font text-sm p-4 rounded-none"
                  />
               </div>
               <div className="p-4 border-t border-[#00f3ff]/20 shrink-0 bg-[#00f3ff]/5">
                  <Button 
                    onClick={() => handleOptimize(rawSql)} 
                    disabled={isOptimizing || !rawSql.trim()}
                    className="w-full bg-[#00f3ff]/10 hover:bg-[#00f3ff]/20 border border-[#00f3ff] text-[#00f3ff] uppercase tracking-widest font-bold rounded-none h-12"
                  >
                    {isOptimizing ? <><Loader2 className="w-4 h-4 mr-3 animate-spin" /> Processing...</> : <><Zap className="w-4 h-4 mr-3 text-[#ff9f0a]" /> Execute Analysis</>}
                  </Button>
               </div>
            </div>

            {/* Right Pane: Output */}
            <div className="hud-panel flex flex-col h-full min-h-0">
               <div className="hud-scanline"></div>
               <div className="border-b border-[#00f3ff]/20 p-4 shrink-0 bg-[#00f3ff]/5">
                 <h3 className="text-lg font-bold uppercase tracking-widest flex items-center gap-2">
                   <Zap className="w-5 h-5 text-[#ff9f0a]" /> [ OPTIMIZED_OUTPUT ]
                 </h3>
               </div>
               <div className="p-6 overflow-y-auto flex-1 min-h-0">
                  {!optimizedOutput && !isOptimizing ? (
                     <div className="h-full flex items-center justify-center text-[#00f3ff]/40 text-sm uppercase tracking-widest">
                       > Awaiting Execution...
                     </div>
                  ) : (
                     <div className="prose prose-sm md:prose-base prose-invert max-w-none text-[#00f3ff] prose-p:leading-relaxed prose-pre:bg-black/80 prose-pre:border prose-pre:border-[#00f3ff]/30 prose-pre:rounded-none">
                        <ReactMarkdown>{optimizedOutput}</ReactMarkdown>
                     </div>
                  )}
               </div>
            </div>

          </div>
        )}

        {/* --- VIEW: DB ANALYZER --- */}
        {view === "db-analyzer" && (
           <div className="animate-in fade-in slide-in-from-right-8 duration-500 flex-1 flex flex-col min-h-0 overflow-hidden">
              
              {!isConnected ? (
                 <div className="max-w-md mx-auto mt-20 hud-panel p-8 w-full">
                    <div className="hud-scanline"></div>
                    <h3 className="text-xl font-bold uppercase tracking-widest mb-2 flex items-center gap-3">
                       <Database className="text-[#ff9f0a]" /> ESTABLISH UPLINK
                    </h3>
                    <p className="text-xs text-[#00f3ff]/60 uppercase tracking-widest mb-8">Enter connection URI to fetch live telemetry.</p>
                    
                    <form onSubmit={mockConnectDb} className="space-y-6">
                       <div className="space-y-3">
                          <label className="text-xs font-bold uppercase tracking-widest text-[#00f3ff]">URI String</label>
                          <Input placeholder="postgresql://user:pass@host:5432/db" required className="bg-black/50 border-[#00f3ff]/40 text-[#00f3ff] focus-visible:ring-[#00f3ff] rounded-none hud-font" />
                       </div>
                       <Button type="submit" disabled={isConnecting} className="w-full bg-[#ff9f0a]/10 hover:bg-[#ff9f0a]/20 border border-[#ff9f0a] text-[#ff9f0a] uppercase tracking-widest font-bold rounded-none h-12">
                          {isConnecting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Connecting...</> : "Initialize Link"}
                       </Button>
                    </form>
                 </div>
              ) : (
                 <div className="hud-panel flex flex-col h-full min-h-0 w-full max-w-5xl mx-auto">
                    <div className="hud-scanline"></div>
                    <div className="border-b border-[#00f3ff]/20 p-6 shrink-0 bg-[#00f3ff]/5 flex justify-between items-center">
                       <div>
                          <h3 className="text-xl font-bold uppercase tracking-widest flex items-center gap-3 text-white">
                             <Activity className="w-6 h-6 text-[#ff9f0a]" /> TELEMETRY: SLOW QUERIES
                          </h3>
                          <p className="text-xs text-[#00f3ff]/60 uppercase tracking-widest mt-1">Live data feed from pg_stat_statements</p>
                       </div>
                       <div className="text-xs font-bold text-[#ff9f0a] uppercase tracking-widest animate-pulse border border-[#ff9f0a]/30 px-3 py-1 bg-[#ff9f0a]/10">
                          Live
                       </div>
                    </div>
                    <div className="p-0 flex-1 min-h-0 overflow-y-auto">
                       <table className="w-full text-left border-collapse text-sm">
                          <thead className="bg-[#00f3ff]/10 sticky top-0">
                             <tr>
                                <th className="p-4 border-b border-[#00f3ff]/20 font-bold uppercase tracking-widest">Query Stream</th>
                                <th className="p-4 border-b border-[#00f3ff]/20 font-bold uppercase tracking-widest w-32">Latency</th>
                                <th className="p-4 border-b border-[#00f3ff]/20 font-bold uppercase tracking-widest w-24">Hits</th>
                                <th className="p-4 border-b border-[#00f3ff]/20 font-bold uppercase tracking-widest text-right w-32">Action</th>
                             </tr>
                          </thead>
                          <tbody>
                             {MOCK_SLOW_QUERIES.map((q) => (
                                <tr key={q.id} className="border-b border-[#00f3ff]/10 hover:bg-[#00f3ff]/5 transition-colors">
                                   <td className="p-4 font-mono text-xs text-[#00f3ff]/80 truncate max-w-md">{q.query}</td>
                                   <td className="p-4 font-bold text-[#ff9f0a]">{q.duration}</td>
                                   <td className="p-4">{q.calls}</td>
                                   <td className="p-4 text-right">
                                      <Button size="sm" variant="outline" className="border-[#ff9f0a]/50 hover:bg-[#ff9f0a]/20 text-[#ff9f0a] rounded-none uppercase tracking-widest text-xs h-8" onClick={() => {
                                         setRawSql(q.query);
                                         setView("sql-optimizer");
                                         setTimeout(() => handleOptimize(q.query), 300);
                                      }}>
                                         Analyze
                                      </Button>
                                   </td>
                                </tr>
                             ))}
                          </tbody>
                       </table>
                    </div>
                 </div>
              )}
           </div>
        )}

      </div>
    </div>
  );
}
