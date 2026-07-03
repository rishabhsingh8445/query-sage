import { useState, useEffect } from "react";
import { useAuth, SignInButton, useClerk } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Database, Code2, Zap, SearchCode, Loader2, Activity, Network, Blocks } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

type ViewState = 
  | "dashboard" 
  | "query-suboptions" 
  | "telemetry-suboptions" 
  | "sql-optimizer" 
  | "schema-architect" 
  | "db-analyzer-slow" 
  | "db-analyzer-active";

export default function SchemaChatPage() {
  const { getToken, isSignedIn } = useAuth();
  const clerk = useClerk();
  const [view, setView] = useState<ViewState>("dashboard");
  const [isLoaded, setIsLoaded] = useState(false);
  const [introStep, setIntroStep] = useState(0);

  // SQL Optimizer State
  const [rawSql, setRawSql] = useState("");
  const [optimizedOutput, setOptimizedOutput] = useState("");
  const [isOptimizing, setIsOptimizing] = useState(false);

  // DB Analyzer State
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    // Initial fade in for the "Wow" entrance
    const timer1 = setTimeout(() => setIsLoaded(true), 100);
    
    // Cinematic Intro Sequence
    const seq1 = setTimeout(() => setIntroStep(1), 2500);
    const seq2 = setTimeout(() => setIntroStep(2), 5000);
    
    return () => {
      clearTimeout(timer1);
      clearTimeout(seq1);
      clearTimeout(seq2);
    };
  }, []);

  const handleOptimize = async (sqlToOptimize: string) => {
    if (!isSignedIn) {
      toast.error("Please authenticate first.");
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
                setOptimizedOutput(prev => prev + `\n\n[ Error: ${errorMsg} ]`);
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
      setOptimizedOutput("Analysis failed. Please try again.");
    } finally {
      setIsOptimizing(false);
    }
  };

  const mockConnectDb = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSignedIn) {
      toast.error("Please authenticate first.");
      return;
    }
    setIsConnecting(true);
    await new Promise(r => setTimeout(r, 1500));
    setIsConnecting(false);
    setIsConnected(true);
    toast.success("Database connected successfully.");
  };

  const MOCK_SLOW_QUERIES = [
    { id: 1, query: "SELECT * FROM users u LEFT JOIN orders o ON u.id = o.user_id WHERE u.created_at < '2024-01-01'", duration: "1250ms", calls: 45 },
    { id: 2, query: "SELECT count(*) FROM audit_logs WHERE action = 'LOGIN' GROUP BY user_id", duration: "840ms", calls: 120 },
    { id: 3, query: "SELECT u.name, p.title FROM users u JOIN posts p ON u.id = p.author_id ORDER BY p.created_at DESC", duration: "610ms", calls: 350 },
  ];

  const goBack = () => {
    if (view === "sql-optimizer" || view === "schema-architect") setView("query-suboptions");
    else if (view === "db-analyzer-slow" || view === "db-analyzer-active") setView("telemetry-suboptions");
    else setView("dashboard");
  };

  return (
    <div className={`h-full w-full relative overflow-hidden flex flex-col font-sans transition-opacity duration-1000 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}>
      
      {/* Mesh Background */}
      <div className="mesh-bg-container">
        <div className="mesh-orb mesh-orb-1"></div>
        <div className="mesh-orb mesh-orb-2"></div>
        <div className="mesh-orb mesh-orb-3"></div>
      </div>

      {/* Premium Header */}
      <div className="relative z-20 w-full px-8 py-6 flex items-center justify-between shrink-0 border-b border-white/5 bg-[#030305]/60 backdrop-blur-xl">
        <div className="flex items-center gap-6">
           {view !== "dashboard" && (
              <Button variant="ghost" size="icon" onClick={goBack} className="text-zinc-400 hover:text-white hover:bg-white/10 transition-colors rounded-full">
                <ArrowLeft className="w-5 h-5" />
              </Button>
           )}
           <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-fuchsia-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <Database className="w-4 h-4 text-white" />
              </div>
              <h1 className="text-xl font-bold tracking-tight text-zinc-100">
                 QuerySage
              </h1>
           </div>
        </div>
        
        {!isSignedIn && introStep === 2 && (
           <SignInButton mode="modal" forceRedirectUrl="/">
              <Button className="bg-white text-black hover:bg-zinc-200 font-semibold px-6 py-2 h-9 rounded-full text-sm shadow-lg shadow-white/10 transition-all hover:scale-105 active:scale-95">
                Sign In
              </Button>
           </SignInButton>
        )}
      </div>

      <div className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex-1 flex flex-col min-h-0 py-12">

        {/* --- CINEMATIC INTRO --- */}
        {introStep === 0 && (
          <div className="flex-1 flex items-center justify-center animate-in fade-in zoom-in-95 duration-1000 fill-mode-both">
            <h1 className="text-4xl md:text-5xl font-mono text-zinc-300 tracking-tight">
               Hi, I'm <span className="gradient-text-primary font-bold">Query Sage.</span>
            </h1>
          </div>
        )}

        {introStep === 1 && (
          <div className="flex-1 flex items-center justify-center animate-in fade-in zoom-in-95 duration-1000 fill-mode-both">
            <h1 className="text-3xl md:text-4xl font-mono text-zinc-400 tracking-tight">
               Please select one option.
            </h1>
          </div>
        )}

        {/* --- LEVEL 1: DASHBOARD --- */}
        {introStep === 2 && view === "dashboard" && (
          <div className="flex flex-col items-center justify-center flex-1 min-h-0 w-full animate-in zoom-in-95 fade-in duration-1000 fill-mode-both slide-in-from-bottom-8">
            
            <div className="text-center mb-16 space-y-4">
              <h2 className="text-4xl md:text-6xl font-bold tracking-tight text-white">
                Intelligence for your <span className="gradient-text-primary">Database</span>
              </h2>
              <p className="text-zinc-400 text-lg md:text-xl max-w-2xl mx-auto">
                Select a module to optimize queries, analyze schema, or monitor live database telemetry.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl">
              
              {/* Option 1 */}
              <div 
                className="premium-card p-10 cursor-pointer group flex flex-col items-center text-center h-64 justify-center"
                onClick={() => {
                  if (!isSignedIn) clerk.openSignIn();
                  else setView("query-suboptions");
                }}
              >
                <div className="w-16 h-16 rounded-2xl bg-fuchsia-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-500 shadow-lg shadow-fuchsia-500/20 group-hover:bg-fuchsia-500/20">
                   <Code2 className="w-8 h-8 text-fuchsia-400" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-3">Query Intelligence</h3>
                <p className="text-zinc-400 leading-relaxed">AI-powered optimization for your queries and database schema structures.</p>
              </div>

              {/* Option 2 */}
              <div 
                className="premium-card p-10 cursor-pointer group flex flex-col items-center text-center h-64 justify-center"
                onClick={() => {
                  if (!isSignedIn) clerk.openSignIn();
                  else setView("telemetry-suboptions");
                }}
              >
                <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-500 shadow-lg shadow-cyan-500/20 group-hover:bg-cyan-500/20">
                   <Activity className="w-8 h-8 text-cyan-400" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-3">Database Telemetry</h3>
                <p className="text-zinc-400 leading-relaxed">Connect securely to your database to analyze live bottlenecks and slow queries.</p>
              </div>

            </div>
          </div>
        )}

        {/* --- LEVEL 2: QUERY SUB-OPTIONS --- */}
        {view === "query-suboptions" && (
          <div className="flex flex-col items-center justify-center flex-1 min-h-0 w-full animate-in zoom-in-95 fade-in duration-500 slide-in-from-right-8">
            <div className="text-center mb-12 space-y-4">
              <h2 className="text-3xl font-bold tracking-tight text-white">
                <span className="gradient-text-primary">Query Intelligence</span> Modules
              </h2>
              <p className="text-zinc-400">Select the specific optimization tool.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-3xl">
              <div className="premium-card p-8 cursor-pointer group flex flex-col h-48 justify-center" onClick={() => setView("sql-optimizer")}>
                <div className="flex items-center gap-4 mb-3">
                   <div className="p-3 rounded-xl bg-indigo-500/10 group-hover:bg-indigo-500/20 transition-colors">
                     <Zap className="w-6 h-6 text-indigo-400" />
                   </div>
                   <h3 className="text-xl font-bold text-white">Single Query Optimizer</h3>
                </div>
                <p className="text-zinc-400 text-sm">Paste a raw SQL query to get instant performance fixes and index suggestions.</p>
              </div>

              <div className="premium-card p-8 cursor-pointer group flex flex-col h-48 justify-center" onClick={() => setView("schema-architect")}>
                <div className="flex items-center gap-4 mb-3">
                   <div className="p-3 rounded-xl bg-violet-500/10 group-hover:bg-violet-500/20 transition-colors">
                     <Blocks className="w-6 h-6 text-violet-400" />
                   </div>
                   <h3 className="text-xl font-bold text-white">Schema Architect</h3>
                </div>
                <p className="text-zinc-400 text-sm">Upload your DDL schema to receive holistic normalization and architecture advice.</p>
              </div>
            </div>
          </div>
        )}

        {/* --- LEVEL 2: TELEMETRY SUB-OPTIONS --- */}
        {view === "telemetry-suboptions" && (
          <div className="flex flex-col items-center justify-center flex-1 min-h-0 w-full animate-in zoom-in-95 fade-in duration-500 slide-in-from-right-8">
            <div className="text-center mb-12 space-y-4">
              <h2 className="text-3xl font-bold tracking-tight text-white">
                <span className="gradient-text-secondary">Telemetry</span> Modules
              </h2>
              <p className="text-zinc-400">Select the telemetry analysis tool.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-3xl">
              <div className="premium-card p-8 cursor-pointer group flex flex-col h-48 justify-center" onClick={() => setView("db-analyzer-slow")}>
                <div className="flex items-center gap-4 mb-3">
                   <div className="p-3 rounded-xl bg-cyan-500/10 group-hover:bg-cyan-500/20 transition-colors">
                     <SearchCode className="w-6 h-6 text-cyan-400" />
                   </div>
                   <h3 className="text-xl font-bold text-white">Live Slow Queries</h3>
                </div>
                <p className="text-zinc-400 text-sm">Connect to your database to automatically fetch and analyze slow-running queries.</p>
              </div>

              <div className="premium-card p-8 cursor-pointer group flex flex-col h-48 justify-center" onClick={() => setView("db-analyzer-active")}>
                <div className="flex items-center gap-4 mb-3">
                   <div className="p-3 rounded-xl bg-blue-500/10 group-hover:bg-blue-500/20 transition-colors">
                     <Network className="w-6 h-6 text-blue-400" />
                   </div>
                   <h3 className="text-xl font-bold text-white">Active Connections</h3>
                </div>
                <p className="text-zinc-400 text-sm">Monitor active database connections, locks, and connection pool bottlenecks.</p>
              </div>
            </div>
          </div>
        )}

        {/* --- LEVEL 3: SQL OPTIMIZER --- */}
        {view === "sql-optimizer" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in slide-in-from-right-8 duration-500 flex-1 min-h-0">
            {/* Left Pane: Input */}
            <div className="premium-card flex flex-col h-full min-h-0 border-white/5">
               <div className="border-b border-white/5 p-5 shrink-0 bg-white/[0.02]">
                 <h3 className="text-base font-semibold text-white flex items-center gap-2">
                   Raw SQL Input
                 </h3>
               </div>
               <div className="flex-1 flex flex-col min-h-0 p-5">
                  <Textarea 
                     value={rawSql}
                     onChange={(e) => setRawSql(e.target.value)}
                     placeholder="Enter your SQL query here..."
                     className="flex-1 w-full h-full resize-none bg-black/40 border-0 focus-visible:ring-1 focus-visible:ring-fuchsia-500/50 text-zinc-300 text-sm p-4 rounded-xl"
                  />
               </div>
               <div className="p-5 border-t border-white/5 shrink-0 bg-white/[0.02]">
                  <Button 
                    onClick={() => handleOptimize(rawSql)} 
                    disabled={isOptimizing || !rawSql.trim()}
                    className="w-full bg-white text-black hover:bg-zinc-200 font-semibold rounded-xl h-12 transition-all hover:scale-[1.02] active:scale-[0.98]"
                  >
                    {isOptimizing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing Query...</> : "Run Optimization"}
                  </Button>
               </div>
            </div>

            {/* Right Pane: Output */}
            <div className="premium-card flex flex-col h-full min-h-0 border-white/5">
               <div className="border-b border-white/5 p-5 shrink-0 bg-white/[0.02]">
                 <h3 className="text-base font-semibold text-white flex items-center gap-2">
                   AI Analysis
                 </h3>
               </div>
               <div className="p-6 overflow-y-auto flex-1 min-h-0">
                  {!optimizedOutput && !isOptimizing ? (
                     <div className="h-full flex items-center justify-center text-zinc-600 text-sm">
                       Run an optimization to see the results here.
                     </div>
                  ) : (
                     <div className="prose prose-sm md:prose-base prose-invert max-w-none text-zinc-300 prose-p:leading-relaxed prose-pre:bg-[#0a0a0c] prose-pre:border prose-pre:border-white/10 prose-pre:rounded-xl">
                        <ReactMarkdown>{optimizedOutput}</ReactMarkdown>
                     </div>
                  )}
               </div>
            </div>
          </div>
        )}

        {/* --- LEVEL 3: SCHEMA ARCHITECT (Coming Soon Placeholder) --- */}
        {view === "schema-architect" && (
          <div className="flex flex-col items-center justify-center flex-1 min-h-0 w-full animate-in fade-in duration-500">
             <Blocks className="w-16 h-16 text-zinc-700 mb-4" />
             <h2 className="text-2xl font-bold text-white mb-2">Schema Architect</h2>
             <p className="text-zinc-500">This module is currently in development.</p>
          </div>
        )}

        {/* --- LEVEL 3: ACTIVE CONNECTIONS (Coming Soon Placeholder) --- */}
        {view === "db-analyzer-active" && (
          <div className="flex flex-col items-center justify-center flex-1 min-h-0 w-full animate-in fade-in duration-500">
             <Network className="w-16 h-16 text-zinc-700 mb-4" />
             <h2 className="text-2xl font-bold text-white mb-2">Active Connections Analyzer</h2>
             <p className="text-zinc-500">This module is currently in development.</p>
          </div>
        )}

        {/* --- LEVEL 3: LIVE SLOW QUERIES --- */}
        {view === "db-analyzer-slow" && (
           <div className="animate-in fade-in slide-in-from-right-8 duration-500 flex-1 flex flex-col min-h-0 overflow-hidden w-full max-w-5xl mx-auto">
              {!isConnected ? (
                 <div className="max-w-md mx-auto mt-20 premium-card p-10 w-full">
                    <h3 className="text-2xl font-bold text-white mb-2">Connect Database</h3>
                    <p className="text-sm text-zinc-400 mb-8">Enter your connection string to securely fetch telemetry.</p>
                    
                    <form onSubmit={mockConnectDb} className="space-y-6">
                       <div className="space-y-3">
                          <label className="text-sm font-medium text-zinc-300">Connection URI</label>
                          <Input placeholder="postgresql://user:pass@host:5432/db" required className="bg-black/50 border-white/10 text-white focus-visible:ring-cyan-500/50 rounded-xl h-12" />
                       </div>
                       <Button type="submit" disabled={isConnecting} className="w-full bg-white text-black hover:bg-zinc-200 font-semibold rounded-xl h-12 transition-all hover:scale-[1.02] active:scale-[0.98]">
                          {isConnecting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Connecting...</> : "Initialize Connection"}
                       </Button>
                    </form>
                 </div>
              ) : (
                 <div className="premium-card flex flex-col h-full min-h-0 w-full">
                    <div className="border-b border-white/5 p-6 shrink-0 bg-white/[0.02] flex justify-between items-center">
                       <div>
                          <h3 className="text-lg font-bold text-white">Live Slow Queries</h3>
                          <p className="text-sm text-zinc-400 mt-1">Fetched from pg_stat_statements</p>
                       </div>
                       <div className="text-xs font-semibold text-cyan-400 px-3 py-1 bg-cyan-500/10 rounded-full flex items-center gap-2 border border-cyan-500/20">
                          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></div> Live Connected
                       </div>
                    </div>
                    <div className="p-0 flex-1 min-h-0 overflow-y-auto">
                       <table className="w-full text-left border-collapse text-sm">
                          <thead className="bg-black/40 sticky top-0 backdrop-blur-md z-10">
                             <tr>
                                <th className="p-5 border-b border-white/5 font-semibold text-zinc-300">Query String</th>
                                <th className="p-5 border-b border-white/5 font-semibold text-zinc-300 w-32">Latency</th>
                                <th className="p-5 border-b border-white/5 font-semibold text-zinc-300 w-24">Hits</th>
                                <th className="p-5 border-b border-white/5 font-semibold text-zinc-300 text-right w-32">Action</th>
                             </tr>
                          </thead>
                          <tbody>
                             {MOCK_SLOW_QUERIES.map((q) => (
                                <tr key={q.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                                   <td className="p-5 font-mono text-xs text-zinc-400 truncate max-w-md">{q.query}</td>
                                   <td className="p-5 font-semibold text-white">{q.duration}</td>
                                   <td className="p-5 text-zinc-400">{q.calls}</td>
                                   <td className="p-5 text-right">
                                      <Button size="sm" variant="secondary" className="rounded-lg font-medium bg-white/10 hover:bg-white/20 text-white h-8" onClick={() => {
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
