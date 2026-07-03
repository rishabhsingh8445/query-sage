import { useState } from "react";
import { useAuth, SignInButton } from "@clerk/react";
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
  const [view, setView] = useState<ViewState>("dashboard");
  
  // SQL Optimizer State
  const [rawSql, setRawSql] = useState("");
  const [optimizedOutput, setOptimizedOutput] = useState("");
  const [isOptimizing, setIsOptimizing] = useState(false);

  // DB Analyzer State
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  
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
    <div className="h-full w-full bg-[#050505] relative overflow-y-auto font-sans text-zinc-50 pt-20 pb-10">
      
      {/* Subtle Background Elements */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-indigo-900/10 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-violet-900/10 blur-[120px] rounded-full"></div>
      </div>

      <div className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
             {view !== "dashboard" && (
                <Button variant="ghost" size="icon" onClick={() => setView("dashboard")} className="text-zinc-400 hover:text-white mr-2">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
             )}
             <div>
                <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
                   <Database className="w-6 h-6 text-indigo-400" />
                   QuerySage
                </h1>
                <p className="text-sm text-zinc-400 mt-1">Enterprise Database Intelligence Toolkit</p>
             </div>
          </div>
          
          {!isSignedIn && (
             <SignInButton mode="modal" forceRedirectUrl="/">
                <Button className="bg-white hover:bg-zinc-200 text-black font-medium px-6 py-2 h-10 rounded-lg">
                  Authenticate
                </Button>
             </SignInButton>
          )}
        </div>

        {/* --- VIEW: DASHBOARD --- */}
        {view === "dashboard" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
            
            {/* Tool 1 */}
            <Card className="bg-[#111113]/80 border-zinc-800/50 backdrop-blur-xl hover:border-indigo-500/50 transition-all cursor-pointer group shadow-xl" onClick={() => setView("sql-optimizer")}>
              <CardHeader>
                <div className="w-12 h-12 bg-indigo-500/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-indigo-500/20 transition-colors">
                  <Code2 className="w-6 h-6 text-indigo-400" />
                </div>
                <CardTitle className="text-xl text-zinc-100">SQL Optimizer Studio</CardTitle>
                <CardDescription className="text-zinc-400 text-base">Paste raw SQL queries to automatically rewrite them for maximum performance and index utilization.</CardDescription>
              </CardHeader>
            </Card>

            {/* Tool 2 */}
            <Card className="bg-[#111113]/80 border-zinc-800/50 backdrop-blur-xl hover:border-violet-500/50 transition-all cursor-pointer group shadow-xl" onClick={() => setView("db-analyzer")}>
              <CardHeader>
                <div className="w-12 h-12 bg-violet-500/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-violet-500/20 transition-colors">
                  <SearchCode className="w-6 h-6 text-violet-400" />
                </div>
                <CardTitle className="text-xl text-zinc-100">Performance Analyzer</CardTitle>
                <CardDescription className="text-zinc-400 text-base">Connect to your database to automatically fetch slow-running queries and analyze bottlenecks.</CardDescription>
              </CardHeader>
            </Card>

          </div>
        )}

        {/* --- VIEW: SQL OPTIMIZER --- */}
        {view === "sql-optimizer" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in slide-in-from-right-8 duration-500 min-h-[60vh] h-[70vh]">
            
            {/* Left Pane: Input */}
            <Card className="bg-[#111113]/80 border-zinc-800/50 backdrop-blur-xl flex flex-col shadow-xl overflow-hidden">
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
            <Card className="bg-[#111113]/80 border-zinc-800/50 backdrop-blur-xl flex flex-col shadow-xl overflow-hidden">
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
           <div className="animate-in fade-in slide-in-from-right-8 duration-500">
              
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
                 <Card className="bg-[#111113]/80 border-zinc-800/50 backdrop-blur-xl shadow-xl overflow-hidden">
                    <CardHeader className="bg-black/20 border-b border-zinc-800/50">
                       <CardTitle className="text-xl flex items-center gap-2">
                          <Activity className="w-5 h-5 text-red-400" /> Top Slow Queries
                       </CardTitle>
                       <CardDescription>Automatically fetched from `pg_stat_statements`</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                       <div className="w-full overflow-x-auto">
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
