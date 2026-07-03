import { useState, useEffect } from "react";
import { useAuth, SignInButton, useClerk } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Database, Code2, Zap, SearchCode, Loader2, Activity } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

type ViewState = "dashboard" | "sql-optimizer" | "db-analyzer";

export default function SchemaChatPage() {
  const { getToken, isSignedIn } = useAuth();
  const clerk = useClerk();
  const [view, setView] = useState<ViewState>("dashboard");
  
  // Cinematic Intro State
  const [introStep, setIntroStep] = useState(0); 
  const [introText, setIntroText] = useState("");
  const [fadeState, setFadeState] = useState<"in" | "out">("in");

  // SQL Optimizer State
  const [rawSql, setRawSql] = useState("");
  const [optimizedOutput, setOptimizedOutput] = useState("");
  const [isOptimizing, setIsOptimizing] = useState(false);

  // DB Analyzer State
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  
  useEffect(() => {
    // Only play intro when entering the dashboard
    if (view !== "dashboard") return;
    
    setIntroStep(1);
    const sequence = async () => {
      await new Promise(r => setTimeout(r, 500));
      
      setIntroText("Hello. I am QuerySage.");
      setFadeState("in");
      await new Promise(r => setTimeout(r, 2000));
      
      setFadeState("out");
      await new Promise(r => setTimeout(r, 800));
      
      setIntroText("Please select an option to begin.");
      setFadeState("in");
      await new Promise(r => setTimeout(r, 1500));
      
      setIntroStep(2); // Unlocks the dashboard cards to fade in
    };
    sequence();
  }, [view]);

  const handleOptimize = async (sqlToOptimize: string) => {
    if (!isSignedIn) {
      toast.error("Please sign in to run optimizations.");
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

      if (!response.ok) throw new Error("Backend connection failed.");

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
                setOptimizedOutput(prev => prev + `\n\n⚠️ **Error:** ${errorMsg}`);
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
      setOptimizedOutput("⚠️ **Backend Connection Failed:**\n\nCould not connect to the Python backend. Ensure that your backend is running locally or deployed, and `VITE_API_URL` is configured.");
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
    toast.success("Connected to database securely!");
  };

  const MOCK_SLOW_QUERIES = [
    { id: 1, query: "SELECT * FROM users u LEFT JOIN orders o ON u.id = o.user_id WHERE u.created_at < '2024-01-01'", duration: "1250ms", calls: 45 },
    { id: 2, query: "SELECT count(*) FROM audit_logs WHERE action = 'LOGIN' GROUP BY user_id", duration: "840ms", calls: 120 },
    { id: 3, query: "SELECT u.name, p.title FROM users u JOIN posts p ON u.id = p.author_id ORDER BY p.created_at DESC", duration: "610ms", calls: 350 },
  ];

  return (
    <div className="h-full w-full bg-[#050505] relative overflow-hidden flex flex-col font-sans text-zinc-50">
      
      {/* Subtle Background Elements */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-indigo-900/10 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-violet-900/10 blur-[120px] rounded-full"></div>
      </div>

      {/* Header (Full Width, Top Corners) */}
      <div className="relative z-20 w-full px-6 py-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
           {view !== "dashboard" && (
              <Button variant="ghost" size="icon" onClick={() => setView("dashboard")} className="text-zinc-400 hover:text-white mr-2">
                <ArrowLeft className="w-5 h-5" />
              </Button>
           )}
           <div>
              <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                 <Database className="w-5 h-5 text-indigo-400" />
                 QuerySage
              </h1>
              <p className="text-xs text-zinc-400 mt-1">Enterprise Database Intelligence Toolkit</p>
           </div>
        </div>
        
        {!isSignedIn && (
           <SignInButton mode="modal" forceRedirectUrl="/">
              <Button className="bg-white hover:bg-zinc-200 text-black font-medium px-6 py-2 h-9 rounded-lg text-sm">
                Authenticate
              </Button>
           </SignInButton>
        )}
      </div>

      <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex-1 flex flex-col min-h-0 pb-6">

        {/* --- VIEW: DASHBOARD --- */}
        {view === "dashboard" && (
          <div className="flex flex-col items-center justify-center flex-1 min-h-0">
            
            {/* Fluid Neural Core Orb (Background Element) */}
            <div className={`relative w-40 h-40 sm:w-56 sm:h-56 mb-12 flex items-center justify-center transition-all duration-1000 transform ${introStep >= 1 ? 'scale-100 opacity-100' : 'scale-75 opacity-0'}`}>
              <div className="absolute inset-0 rounded-full blur-2xl opacity-50 bg-indigo-500"></div>
              <div className="absolute w-[120%] h-[120%] -top-[10%] -left-[10%] rounded-full mix-blend-screen filter blur-[24px] animate-blob bg-violet-500/80"></div>
              <div className="absolute w-[110%] h-[110%] top-[0%] right-[0%] rounded-full mix-blend-screen filter blur-[20px] animate-blob animation-delay-2000 bg-cyan-400/80"></div>
              <div className="absolute w-[100%] h-[100%] -bottom-[10%] left-[10%] rounded-full mix-blend-screen filter blur-[20px] animate-blob animation-delay-4000 bg-fuchsia-500/80"></div>
              <div className="absolute inset-2 rounded-full border border-white/5 backdrop-blur-[2px] shadow-[inset_0_0_30px_rgba(255,255,255,0.05)]"></div>
            </div>

            {/* Cinematic Fading Text */}
            <div className={`min-h-[60px] flex flex-col items-center justify-center text-center px-4 transition-all duration-700 ${introStep === 2 ? 'mb-8' : 'mb-0'}`}>
              <h1 className={`text-2xl md:text-3xl font-light tracking-wide leading-relaxed transition-all duration-700 ease-in-out whitespace-pre-wrap ${fadeState === 'in' ? 'opacity-100 transform translate-y-0' : 'opacity-0 transform translate-y-4'} text-zinc-100`}>
                {introText}
              </h1>
            </div>

            {/* Dashboard Tool Cards (Fade in after sequence) */}
            {introStep >= 2 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl animate-in fade-in slide-in-from-bottom-8 duration-1000 mt-4 card-3d-wrapper">
                
                <Card 
                  className="card-3d bg-[#111113]/80 border-zinc-800/50 backdrop-blur-xl hover:border-indigo-500/50 hover:bg-zinc-900/80 cursor-pointer group" 
                  onClick={() => {
                    if (!isSignedIn) clerk.openSignIn();
                    else setView("sql-optimizer");
                  }}
                >
                  <CardHeader className="p-8">
                    <div className="w-16 h-16 bg-indigo-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:bg-indigo-500/20 group-hover:scale-110 transition-all duration-300 group-hover:shadow-[0_0_30px_rgba(99,102,241,0.3)]">
                      <Code2 className="w-8 h-8 text-indigo-400 group-hover:animate-pulse" />
                    </div>
                    <CardTitle className="text-2xl text-zinc-100 font-bold tracking-wide group-hover:text-indigo-300 transition-colors">SQL Optimizer Studio</CardTitle>
                    <CardDescription className="text-zinc-400 text-base leading-relaxed mt-4 group-hover:text-zinc-300 transition-colors">Paste raw SQL queries to automatically rewrite them for maximum performance and index utilization.</CardDescription>
                  </CardHeader>
                </Card>

                <Card 
                  className="card-3d bg-[#111113]/80 border-zinc-800/50 backdrop-blur-xl hover:border-violet-500/50 hover:bg-zinc-900/80 cursor-pointer group" 
                  onClick={() => {
                    if (!isSignedIn) clerk.openSignIn();
                    else setView("db-analyzer");
                  }}
                >
                  <CardHeader className="p-8">
                    <div className="w-16 h-16 bg-violet-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:bg-violet-500/20 group-hover:scale-110 transition-all duration-300 group-hover:shadow-[0_0_30px_rgba(139,92,246,0.3)]">
                      <SearchCode className="w-8 h-8 text-violet-400 group-hover:animate-pulse" />
                    </div>
                    <CardTitle className="text-2xl text-zinc-100 font-bold tracking-wide group-hover:text-violet-300 transition-colors">Performance Analyzer</CardTitle>
                    <CardDescription className="text-zinc-400 text-base leading-relaxed mt-4 group-hover:text-zinc-300 transition-colors">Connect to your database to automatically fetch slow-running queries and analyze bottlenecks.</CardDescription>
                  </CardHeader>
                </Card>

              </div>
            )}
          </div>
        )}

        {/* --- VIEW: SQL OPTIMIZER --- */}
        {view === "sql-optimizer" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in slide-in-from-right-8 duration-500 flex-1 min-h-0">
            
            {/* Left Pane: Input */}
            <Card className="bg-[#111113]/80 border-zinc-800/50 backdrop-blur-xl flex flex-col shadow-xl overflow-hidden h-full min-h-0">
               <CardHeader className="border-b border-zinc-800/50 pb-4 bg-black/20 shrink-0">
                 <CardTitle className="text-lg text-zinc-100 flex items-center gap-2">
                   <Code2 className="w-5 h-5 text-indigo-400" /> Raw Query
                 </CardTitle>
               </CardHeader>
               <CardContent className="p-0 flex-1 flex flex-col min-h-0">
                  <Textarea 
                     value={rawSql}
                     onChange={(e) => setRawSql(e.target.value)}
                     placeholder="Paste your slow SQL query here..."
                     className="flex-1 w-full h-full resize-none bg-transparent border-0 focus-visible:ring-0 text-zinc-200 font-mono text-sm p-4 rounded-none"
                  />
                  <div className="p-4 border-t border-zinc-800/50 bg-black/20 shrink-0">
                     <Button 
                       onClick={() => handleOptimize(rawSql)} 
                       disabled={isOptimizing || !rawSql.trim()}
                       className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
                     >
                       {isOptimizing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Optimizing...</> : <><Zap className="w-4 h-4 mr-2" /> Run AI Optimization</>}
                     </Button>
                  </div>
               </CardContent>
            </Card>

            {/* Right Pane: Output */}
            <Card className="bg-[#111113]/80 border-zinc-800/50 backdrop-blur-xl flex flex-col shadow-xl overflow-hidden h-full min-h-0">
               <CardHeader className="border-b border-zinc-800/50 pb-4 bg-black/20 shrink-0">
                 <CardTitle className="text-lg text-zinc-100 flex items-center gap-2">
                   <Zap className="w-5 h-5 text-indigo-400" /> AI Optimization Plan
                 </CardTitle>
               </CardHeader>
               <CardContent className="p-6 overflow-y-auto custom-scrollbar flex-1 min-h-0 bg-[#0a0a0c]/50">
                  {!optimizedOutput && !isOptimizing ? (
                     <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
                       Run optimization to see the results here.
                     </div>
                  ) : (
                     <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none prose-p:leading-loose prose-pre:bg-[#050505] prose-pre:border prose-pre:border-zinc-800/80 prose-pre:rounded-xl font-light tracking-wide text-zinc-200">
                        <ReactMarkdown>{optimizedOutput}</ReactMarkdown>
                     </div>
                  )}
               </CardContent>
            </Card>

          </div>
        )}

        {/* --- VIEW: DB ANALYZER --- */}
        {view === "db-analyzer" && (
           <div className="animate-in fade-in slide-in-from-right-8 duration-500 flex-1 flex flex-col min-h-0 overflow-hidden">
              
              {!isConnected ? (
                 <Card className="max-w-md mx-auto mt-12 bg-[#111113]/80 border-zinc-800/50 backdrop-blur-xl shadow-xl">
                    <CardHeader>
                       <CardTitle className="text-xl">Connect Database</CardTitle>
                       <CardDescription>Enter credentials to fetch slow query logs securely.</CardDescription>
                    </CardHeader>
                    <CardContent>
                       <form onSubmit={mockConnectDb} className="space-y-4">
                          <div className="space-y-2">
                             <Label className="text-zinc-400">Database Connection URI</Label>
                             <Input placeholder="postgresql://user:pass@host:5432/db" required className="bg-black/50 border-zinc-800 text-zinc-200 focus-visible:ring-indigo-500" />
                          </div>
                          <Button type="submit" disabled={isConnecting} className="w-full bg-violet-600 hover:bg-violet-500 text-white mt-4">
                             {isConnecting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Connecting...</> : "Connect securely"}
                          </Button>
                       </form>
                    </CardContent>
                 </Card>
              ) : (
                 <Card className="bg-[#111113]/80 border-zinc-800/50 backdrop-blur-xl shadow-xl overflow-hidden flex flex-col h-full min-h-0">
                    <CardHeader className="bg-black/20 border-b border-zinc-800/50 shrink-0">
                       <CardTitle className="text-xl flex items-center gap-2">
                          <Activity className="w-5 h-5 text-red-400" /> Top Slow Queries
                       </CardTitle>
                       <CardDescription>Automatically fetched from `pg_stat_statements`</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                       <div className="w-full min-w-[600px]">
                          <Table>
                             <TableHeader className="bg-black/40">
                                <TableRow className="hover:bg-transparent border-zinc-800/50">
                                   <TableHead className="text-zinc-400">Raw Query</TableHead>
                                   <TableHead className="w-[150px] text-zinc-400">Avg Duration</TableHead>
                                   <TableHead className="w-[100px] text-zinc-400">Calls</TableHead>
                                   <TableHead className="w-[120px] text-right text-zinc-400">Action</TableHead>
                                </TableRow>
                             </TableHeader>
                             <TableBody>
                                {MOCK_SLOW_QUERIES.map((q) => (
                                   <TableRow key={q.id} className="border-zinc-800/50 hover:bg-zinc-800/30">
                                      <TableCell className="font-mono text-xs text-zinc-300 max-w-md truncate py-4">{q.query}</TableCell>
                                      <TableCell className="text-red-400 font-medium py-4">{q.duration}</TableCell>
                                      <TableCell className="text-zinc-300 py-4">{q.calls}</TableCell>
                                      <TableCell className="text-right py-4">
                                         <Button size="sm" variant="outline" className="border-indigo-500/50 hover:bg-indigo-500/20 text-indigo-300 h-8 px-3" onClick={() => {
                                            setRawSql(q.query);
                                            setView("sql-optimizer");
                                            setTimeout(() => handleOptimize(q.query), 300);
                                         }}>
                                            Optimize
                                         </Button>
                                      </TableCell>
                                   </TableRow>
                                ))}
                             </TableBody>
                          </Table>
                       </div>
                    </CardContent>
                 </Card>
              )}
           </div>
        )}

      </div>
    </div>
  );
}
