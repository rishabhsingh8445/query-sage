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
import { Database, HelpCircle, Sparkles, MessageSquare, Zap } from "lucide-react";
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
          animated: false,
          style: { stroke: "rgba(59, 130, 246, 0.6)", strokeWidth: 2 }
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
        style: { stroke: "rgba(99, 102, 241, 0.6)", strokeWidth: 2 }
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
              style: { stroke: "rgba(148, 163, 184, 0.4)", strokeWidth: 1.5, strokeDasharray: "4 4" }
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
        <div className="w-[280px] border-l border-border bg-card/90 backdrop-blur-xl p-4 flex flex-col justify-between animate-in slide-in-from-right duration-300">
          <div>
            <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
              <h4 className="font-bold text-sm text-foreground flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-primary animate-pulse" />
                Table Analyst
              </h4>
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-6 text-xs px-1.5 text-muted-foreground"
                onClick={() => setSelectedTable(null)}
              >
                ✕ Close
              </Button>
            </div>

            <div className="space-y-4">
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
            </div>
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <Button 
              className="w-full text-xs h-9 font-semibold justify-start gap-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20"
              onClick={() => handleAction("index")}
            >
              <Zap size={13} /> Suggest Indexes
            </Button>
            <Button 
              className="w-full text-xs h-9 font-semibold justify-start gap-2" 
              variant="outline"
              onClick={() => handleAction("general")}
            >
              <MessageSquare size={13} className="text-muted-foreground" /> Describe Columns
            </Button>
            <Button 
              className="w-full text-xs h-9 font-semibold justify-start gap-2" 
              variant="outline"
              onClick={() => handleAction("explain")}
            >
              <Database size={13} className="text-muted-foreground" /> Explain Relationships
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
