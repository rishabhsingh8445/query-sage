import { motion, AnimatePresence } from "framer-motion";
import { Terminal, Database, Code, ShieldAlert, Cpu, Sparkles, CheckCircle2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface AgentSwarmProps {
  traces: string[];
  status: string;
}

interface AgentState {
  name: string;
  role: string;
  icon: any;
  status: "idle" | "active" | "success" | "retry" | "fail";
  description: string;
}

export function AgentSwarm({ traces, status }: AgentSwarmProps) {
  // Determine which agent is currently active or finished based on trace logs
  const getAgentStates = (): AgentState[] => {
    const states: AgentState[] = [
      { name: "Query Parser", role: "syntax analyst", icon: Terminal, status: "idle", description: "Parses structure & complexity" },
      { name: "Schema Analyst", role: "ddl explorer", icon: Database, status: "idle", description: "Reads constraints & indices" },
      { name: "SQL Generator", role: "sql rewrite", icon: Code, status: "idle", description: "Generates candidate queries" },
      { name: "Performance Optimizer", role: "cost evaluator", icon: Cpu, status: "idle", description: "Simulates plans & calculates cost" },
      { name: "Reviewer Agent", role: "quality guard", icon: ShieldAlert, status: "idle", description: "Validates speed and accuracy" }
    ];

    if (traces.length === 0) return states;

    // Check trace logs sequentially to compute the state of the swarm
    let currentActiveIdx = -1;
    let hasLoops = false;

    traces.forEach((trace) => {
      const lower = trace.toLowerCase();
      if (lower.includes("parser") || lower.includes("parsing")) {
        currentActiveIdx = 0;
      } else if (lower.includes("analyst") || lower.includes("schema")) {
        currentActiveIdx = 1;
      } else if (lower.includes("generator") || lower.includes("generating")) {
        currentActiveIdx = 2;
      } else if (lower.includes("evaluating cost") || lower.includes("performance optimizer") || lower.includes("explain")) {
        currentActiveIdx = 3;
      } else if (lower.includes("reviewer") || lower.includes("validating")) {
        currentActiveIdx = 4;
      }
      
      if (lower.includes("loop") || lower.includes("high cost detected") || lower.includes("correction")) {
        hasLoops = true;
      }
    });

    // Mark previous agents as success, active agent as active, future agents as idle
    for (let i = 0; i < states.length; i++) {
      if (i < currentActiveIdx) {
        states[i].status = "success";
      } else if (i === currentActiveIdx) {
        states[i].status = "active";
      }
    }

    // Special loop state transitions
    if (hasLoops && currentActiveIdx === 2) {
      states[2].status = "retry"; // SQL generator is in self-correction rewrite state
      states[4].status = "retry"; // Reviewer initiated correction
    }

    if (status.includes("Complete") || status.includes("Successful") || traces.some(t => t.includes("Workflow Complete"))) {
      states.forEach(s => s.status = "success");
    }

    return states;
  };

  const agents = getAgentStates();

  return (
    <div className="border border-border/60 rounded-xl p-5 bg-card/60 backdrop-blur-xl shadow-lg relative overflow-hidden">
      {/* Background visual grid elements */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none opacity-40"></div>
      
      <div className="relative flex items-center justify-between mb-4 border-b border-border/40 pb-3">
        <div>
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary animate-pulse" />
            Agentic Team Workflow
          </h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">LangGraph autonomous query optimization swarm</p>
        </div>
        <Badge variant="outline" className="font-mono text-[9px] bg-background/50 h-5 px-1.5 py-0">
          {status}
        </Badge>
      </div>

      <div className="relative grid grid-cols-1 md:grid-cols-5 gap-4 py-2">
        {agents.map((agent, i) => {
          const Icon = agent.icon;
          const isActive = agent.status === "active";
          const isSuccess = agent.status === "success";
          const isRetry = agent.status === "retry";
          
          let cardBorder = "border-white/5 bg-background/25";
          let textColor = "text-muted-foreground/60";
          let iconColor = "text-muted-foreground/50";
          let shadow = "";

          if (isActive) {
            cardBorder = "border-primary/50 bg-primary/5 shadow-inner scale-[1.02]";
            textColor = "text-foreground font-semibold";
            iconColor = "text-primary animate-pulse";
            shadow = "shadow-[0_0_15px_rgba(124,58,237,0.15)]";
          } else if (isSuccess) {
            cardBorder = "border-green-500/30 bg-green-500/5";
            textColor = "text-foreground/90";
            iconColor = "text-green-500";
          } else if (isRetry) {
            cardBorder = "border-amber-500/40 bg-amber-500/5 animate-pulse";
            textColor = "text-amber-500/90";
            iconColor = "text-amber-500";
          }

          return (
            <div key={agent.name} className="relative flex flex-col items-center">
              {/* Horizontal connecting arrows (only on desktop and between items) */}
              {i < agents.length - 1 && (
                <div className="hidden md:block absolute top-6 -right-6 w-8 h-px bg-border/40 z-0">
                  {isActive && (
                    <motion.div 
                      className="absolute inset-0 bg-primary/70"
                      initial={{ left: 0, right: "100%" }}
                      animate={{ left: "100%", right: 0 }}
                      transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                    />
                  )}
                </div>
              )}

              {/* Special Loop alert edge back to Generator (card 2) */}
              {isRetry && i === 4 && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-amber-500/10 border border-amber-500/25 rounded px-1.5 py-0.5 text-[8px] font-mono text-amber-500 flex items-center gap-1 z-30">
                  <RefreshCw size={8} className="animate-spin" /> Self-Correcting
                </div>
              )}

              <motion.div 
                className={`relative w-full border ${cardBorder} ${shadow} rounded-lg p-3 flex flex-col gap-2 z-10 transition-all duration-300`}
                animate={isActive ? { y: -2 } : { y: 0 }}
              >
                <div className="flex items-center justify-between">
                  <div className={`p-1.5 rounded bg-muted/40 ${isActive ? "bg-primary/20" : ""}`}>
                    <Icon className={`h-4 w-4 ${iconColor}`} />
                  </div>
                  {isSuccess ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : isActive ? (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                    </span>
                  ) : isRetry ? (
                    <RefreshCw className="h-3.5 w-3.5 text-amber-500 animate-spin" />
                  ) : null}
                </div>

                <div className="text-left mt-1">
                  <h4 className={`text-xs ${textColor} truncate`}>{agent.name}</h4>
                  <span className="text-[8px] uppercase tracking-wider font-mono text-muted-foreground/60">{agent.role}</span>
                  <p className="text-[9px] text-muted-foreground/80 leading-snug mt-1 min-h-[24px]">
                    {isActive && traces.length > 0 ? (
                      <span className="text-foreground/90 font-mono italic">
                        {traces[traces.length - 1].replace(/^[✓↻\s]+/, "")}
                      </span>
                    ) : (
                      agent.description
                    )}
                  </p>
                </div>
              </motion.div>
            </div>
          );
        })}
      </div>

      {/* Mini scroll panel showing latest raw logs at the bottom */}
      <AnimatePresence>
        {traces.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 border-t border-border/40 pt-3 flex items-center gap-2"
          >
            <div className="p-1 bg-muted rounded">
              <Terminal size={12} className="text-primary" />
            </div>
            <div className="font-mono text-[9px] text-muted-foreground truncate w-full flex-1">
              <span className="text-primary font-bold mr-1">LATEST:</span>
              {traces[traces.length - 1]}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
