import { useState, useMemo, useEffect } from "react";
import { 
  ReactFlow, 
  Controls, 
  Background, 
  MiniMap,
  Node,
  Edge,
  useNodesState,
  useEdgesState
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { parseSqlSchemaToNodes } from "@/utils/sqlParser";
import { TableNode } from "@/components/TableNode";
import { Database, HelpCircle, Sparkles, MessageSquare, Zap, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SchemaErdProps {
  schemaText: string;
  onTableAction?: (tableName: string, actionPrompt: string) => void;
}

const nodeTypes = {
  tableNode: TableNode,
};

// Custom edge building logic
function buildErdEdges(nodes: Node[], schemaText: string): Edge[] {
  if (!schemaText) return [];
  const edges: Edge[] = [];
  const tableNames = nodes.map(n => n.id);

  // Clean schema of comments
  const cleanSchema = schemaText
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ');

  // Parse explicit constraints: ALTER TABLE or inline FOREIGN KEY (col) REFERENCES target(col)
  // Pattern 1: FOREIGN KEY (user_id) REFERENCES users(id)
  const fkRegex = /FOREIGN\s+KEY\s*\(\s*([\w_]+)\s*\)\s*REFERENCES\s*([\w_]+)\s*\(\s*([\w_]+)\s*\)/gi;
  let match;
  
  // Scrape column blocks from CREATE TABLE
  const tableBlocksRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\w`"\[\]]+\.)?([a-zA-Z0-9_`"\[\]]+)\s*\((.*?)\)(?:;|\s*$)/gi;
  
  while ((match = tableBlocksRegex.exec(cleanSchema)) !== null) {
    const tableName = match[1].replace(/[`"\[\]]/g, '');
    const columnsBlock = match[2];
    
    let fkMatch;
    while ((fkMatch = fkRegex.exec(columnsBlock)) !== null) {
      const sourceCol = fkMatch[1];
      const targetTable = fkMatch[2];
      const targetCol = fkMatch[3];
      
      if (tableNames.includes(targetTable)) {
        edges.push({
          id: `edge-fk-${tableName}-${sourceCol}-${targetTable}-${targetCol}`,
          source: tableName,
          target: targetTable,
          sourceHandle: `${sourceCol}-out`,
          targetHandle: `${targetCol}-in`,
          type: "smoothstep",
          animated: true,
          style: { stroke: "rgba(99, 102, 241, 0.85)", strokeWidth: 2.5 }
        });
      }
    }
  }

  // Pattern 2: ALTER TABLE x ADD CONSTRAINT fk FOREIGN KEY (y) REFERENCES z(w)
  const alterRegex = /ALTER\s+TABLE\s+(?:ONLY\s+)?([\w_]+)\s+ADD\s+(?:CONSTRAINT\s+[\w_]+\s+)?FOREIGN\s+KEY\s*\(\s*([\w_]+)\s*\)\s*REFERENCES\s*([\w_]+)\s*\(\s*([\w_]+)\s*\)/gi;
  let alterMatch;
  while ((alterMatch = alterRegex.exec(cleanSchema)) !== null) {
    const sourceTable = alterMatch[1].replace(/[`"\[\]]/g, '');
    const sourceCol = alterMatch[2];
    const targetTable = alterMatch[3].replace(/[`"\[\]]/g, '');
    const targetCol = alterMatch[4];

    if (tableNames.includes(sourceTable) && tableNames.includes(targetTable)) {
      edges.push({
        id: `edge-alter-${sourceTable}-${sourceCol}-${targetTable}-${targetCol}`,
        source: sourceTable,
        target: targetTable,
        sourceHandle: `${sourceCol}-out`,
        targetHandle: `${targetCol}-in`,
        type: "smoothstep",
        animated: true,
        style: { stroke: "rgba(139, 92, 246, 0.85)", strokeWidth: 2.5 }
      });
    }
  }

  // Pattern 3: Heuristic mapping for standard conventions (e.g. user_id -> users table)
  nodes.forEach(node => {
    const tableName = node.id;
    const columns = (node.data as any).columns || [];
    columns.forEach((col: any) => {
      // Connect user_id to users or items
      if (col.name.endsWith("_id")) {
        const baseName = col.name.substring(0, col.name.length - 3);
        // Find matching tables
        const matchedTable = tableNames.find(t => 
          t.toLowerCase() === baseName.toLowerCase() ||
          t.toLowerCase() === `${baseName}s`.toLowerCase() ||
          t.toLowerCase() === `${baseName}es`.toLowerCase()
        );

        if (matchedTable && matchedTable !== tableName) {
          // Verify we don't already have an explicit foreign key edge between these tables
          const alreadyLinked = edges.some(e => 
            (e.source === tableName && e.target === matchedTable) ||
            (e.source === matchedTable && e.target === tableName)
          );
          
          if (!alreadyLinked) {
            edges.push({
              id: `edge-heur-${tableName}-${col.name}-${matchedTable}`,
              source: tableName,
              target: matchedTable,
              sourceHandle: `${col.name}-out`,
              targetHandle: `id-in`,
              type: "smoothstep",
              animated: true,
              style: { stroke: "rgba(148, 163, 184, 0.65)", strokeWidth: 1.5, strokeDasharray: "4 4" }
            });
          }
        }
      }
    });
  });

  return edges;
}

export function SchemaErd({ schemaText, onTableAction }: SchemaErdProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);

  const [chatMode, setChatMode] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    setChatMessages([]);
    setChatMode(false);
  }, [selectedTable]);

  const sendChatMessage = async (msg: string) => {
    if (!msg.trim()) return;
    
    const newMessages = [...chatMessages, { role: "user" as const, content: msg }];
    setChatMessages(newMessages);
    setChatInput("");
    setIsTyping(true);
    
    // Add temporary empty assistant message to stream into
    setChatMessages(prev => [...prev, { role: "assistant" as const, content: "" }]);
    
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || ""}/api/schema/discuss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table_name: selectedTable,
          schema_ddl: schemaText,
          message: msg,
          chat_history: chatMessages
        })
      });
      
      if (!response.ok) throw new Error("Connection failed");
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          assistantText += chunk;
          
          setChatMessages(prev => {
            const updated = [...prev];
            if (updated.length > 0) {
              updated[updated.length - 1] = { role: "assistant", content: assistantText };
            }
            return updated;
          });
        }
      }
    } catch (e: any) {
      setChatMessages(prev => {
        const updated = [...prev];
        if (updated.length > 0) {
          updated[updated.length - 1] = { role: "assistant", content: `Error communicating with DBA Assistant: ${e.message}` };
        }
        return updated;
      });
    } finally {
      setIsTyping(false);
    }
  };

  const graphData = useMemo(() => {
    if (!schemaText) return { nodes: [], edges: [] };
    try {
      const flowNodes = parseSqlSchemaToNodes(schemaText);
      const flowEdges = buildErdEdges(flowNodes, schemaText);
      return { nodes: flowNodes, edges: flowEdges };
    } catch (e) {
      console.error("ERD Parsing Error:", e);
      return { nodes: [], edges: [] };
    }
  }, [schemaText]);

  useEffect(() => {
    setNodes(graphData.nodes);
    setEdges(graphData.edges);
  }, [graphData, setNodes, setEdges]);

  const onNodeClick = (_: any, node: Node) => {
    setSelectedTable(node.id);
  };

  const handleAction = (actionType: "index" | "general" | "explain") => {
    if (!selectedTable || !onTableAction) return;

    let prompt = "";
    if (actionType === "index") {
      prompt = `Review the table structure of \`${selectedTable}\` and recommend optimal indexes. Identify which query patterns would benefit the most.`;
    } else if (actionType === "general") {
      prompt = `Tell me about the columns, relationships, and best practices for configuring table \`${selectedTable}\`.`;
    } else if (actionType === "explain") {
      prompt = `How is the table \`${selectedTable}\` connected to other entities in the database? Please explain its schema topology.`;
    }

    onTableAction(selectedTable, prompt);
  };

  return (
    <div className="flex h-full w-full bg-black/40 border border-border/60 rounded-xl overflow-hidden relative">
      <div className="flex-1 h-full relative">
        {nodes.length > 0 ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onNodeClick={onNodeClick}
            fitView
            className="bg-black/10"
          >
            <Background color="#333" gap={20} />
            <Controls className="bg-background/90 border border-border text-foreground rounded shadow" />
            <MiniMap 
              style={{ height: 100, width: 140 }} 
              className="bg-background/90 border border-border rounded opacity-90 hidden sm:block" 
              nodeColor={() => "var(--primary)"}
              maskColor="rgba(0, 0, 0, 0.6)"
            />
          </ReactFlow>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
            <Database size={40} className="text-muted-foreground/35 mb-3" />
            <p className="font-mono text-xs max-w-xs leading-relaxed">
              No tables parsed. Please write DDL `CREATE TABLE` definitions in the database panel.
            </p>
          </div>
        )}
      </div>

      {/* Selected Table details & actions panel */}
      {selectedTable && (
        <div className="w-[320px] border-l border-zinc-800/80 bg-zinc-950/70 backdrop-blur-xl p-4 flex flex-col justify-between animate-in slide-in-from-right duration-300 h-full min-h-0">
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between border-b border-zinc-800/60 pb-3 mb-3 shrink-0">
              <h4 className="font-bold text-sm text-foreground flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-pink-400 animate-pulse" />
                Table Analyst
              </h4>
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-6 text-xs px-1.5 text-muted-foreground hover:text-white"
                onClick={() => setSelectedTable(null)}
              >
                ✕ Close
              </Button>
            </div>

            {/* Mode Switch Tabs */}
            <div className="flex gap-1.5 bg-black/40 border border-zinc-800/80 p-1 rounded-lg mb-3.5 shrink-0">
              <button 
                className={`flex-1 text-center py-1 text-[11px] font-medium rounded-md transition-colors ${!chatMode ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
                onClick={() => setChatMode(false)}
              >
                DBA Actions
              </button>
              <button 
                className={`flex-1 text-center py-1 text-[11px] font-medium rounded-md transition-colors ${chatMode ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
                onClick={() => setChatMode(true)}
              >
                💬 Live AI Chat
              </button>
            </div>

            {!chatMode ? (
              /* DBA Actions Mode */
              <div className="space-y-4 flex-1 overflow-y-auto custom-scrollbar pr-0.5">
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider font-mono">Active Focus</label>
                  <h3 className="font-mono text-md font-bold text-foreground mt-0.5">{selectedTable}</h3>
                </div>

                <div className="text-xs text-muted-foreground/80 font-mono flex items-start gap-2 bg-muted/20 p-2.5 border border-dashed border-border/50 rounded leading-relaxed">
                  <HelpCircle size={14} className="shrink-0 text-primary/80 mt-0.5" />
                  <span>
                    Query the AI Agent about indices, column configurations, or relationship schemas for table **{selectedTable}**.
                  </span>
                </div>

                <div className="space-y-2 pt-2">
                  <Button 
                    className="w-full text-xs h-9 font-semibold justify-start gap-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20"
                    onClick={() => handleAction("index")}
                  >
                    <Zap size={13} /> Suggest Indexes
                  </Button>
                  <Button 
                    className="w-full text-xs h-9 font-semibold justify-start gap-2 border-zinc-800 hover:bg-zinc-900" 
                    variant="outline"
                    onClick={() => handleAction("general")}
                  >
                    <MessageSquare size={13} className="text-muted-foreground" /> Describe Columns
                  </Button>
                  <Button 
                    className="w-full text-xs h-9 font-semibold justify-start gap-2 border-zinc-800 hover:bg-zinc-900" 
                    variant="outline"
                    onClick={() => handleAction("explain")}
                  >
                    <Database size={13} className="text-muted-foreground" /> Explain Relationships
                  </Button>
                </div>
              </div>
            ) : (
              /* Live AI Chat Mode */
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-0.5 min-h-0 mb-3 bg-black/20 p-2 rounded-lg border border-zinc-800/40">
                  {chatMessages.length === 0 ? (
                    <div className="text-[11px] text-zinc-500 font-mono text-center py-8">
                      Ask anything about table `{selectedTable}` (e.g. indexes, queries, columns).
                    </div>
                  ) : (
                    chatMessages.map((m, i) => (
                      <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                        <div className={`max-w-[90%] rounded-lg px-2.5 py-1.5 text-xs leading-relaxed font-light ${m.role === 'user' ? 'bg-indigo-600/25 text-indigo-100 border border-indigo-500/20' : 'bg-zinc-800/60 text-zinc-200 border border-zinc-700/30'}`}>
                          {m.content || (
                            <span className="flex items-center gap-1">
                              <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce"></span>
                              <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                              <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Suggestion Chips */}
                <div className="flex flex-wrap gap-1 mb-2.5 shrink-0">
                  <button 
                    disabled={isTyping}
                    onClick={() => sendChatMessage("Draft a basic SELECT query for this table")}
                    className="text-[9px] bg-zinc-900 border border-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50"
                  >
                    + SELECT Template
                  </button>
                  <button 
                    disabled={isTyping}
                    onClick={() => sendChatMessage("Recommend a partition key strategy")}
                    className="text-[9px] bg-zinc-900 border border-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50"
                  >
                    + Partitioning
                  </button>
                  <button 
                    disabled={isTyping}
                    onClick={() => sendChatMessage("What indexes should I create for common lookups?")}
                    className="text-[9px] bg-zinc-900 border border-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50"
                  >
                    + Indexing
                  </button>
                </div>

                {/* Input block */}
                <div className="flex items-center gap-1 shrink-0 border border-zinc-800 bg-black/40 rounded-lg p-1">
                  <input 
                    type="text" 
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') sendChatMessage(chatInput);
                    }}
                    placeholder="Ask AI Copilot..."
                    disabled={isTyping}
                    className="flex-1 bg-transparent text-xs text-zinc-200 px-2 py-1 focus:outline-none placeholder-zinc-600 disabled:opacity-50"
                  />
                  <Button 
                    onClick={() => sendChatMessage(chatInput)}
                    disabled={isTyping || !chatInput.trim()}
                    className="h-7 w-7 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center p-0 shrink-0"
                  >
                    {isTyping ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3 fill-white" />}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
