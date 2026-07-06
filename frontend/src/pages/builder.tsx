import { useState, useCallback, useMemo, useEffect } from 'react';
import { useLocation } from "wouter";
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  MarkerType
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { TableNode } from '@/components/TableNode';
import { Button } from '@/components/ui/button';
import { Play, Code2, Zap, Database } from 'lucide-react';

const nodeTypes = {
  tableNode: TableNode,
};

const initialNodes = [
  {
    id: 'users',
    type: 'tableNode',
    position: { x: 50, y: 100 },
    data: {
      tableName: 'users',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'email', type: 'varchar(255)' },
        { name: 'created_at', type: 'timestamp' },
      ],
    },
  },
  {
    id: 'orders',
    type: 'tableNode',
    position: { x: 350, y: 50 },
    data: {
      tableName: 'orders',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'user_id', type: 'integer', isForeign: true },
        { name: 'total_amount', type: 'decimal(10,2)' },
        { name: 'status', type: 'varchar(50)' },
      ],
    },
  },
  {
    id: 'order_items',
    type: 'tableNode',
    position: { x: 650, y: 150 },
    data: {
      tableName: 'order_items',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'order_id', type: 'integer', isForeign: true },
        { name: 'product_id', type: 'integer', isForeign: true },
        { name: 'quantity', type: 'integer' },
        { name: 'price', type: 'decimal(10,2)' },
      ],
    },
  }
];

import { useAppStore } from '@/store/useAppStore';

export default function BuilderPage() {
  const { parsedNodes } = useAppStore();
  const [nodes, setNodes, onNodesChange] = useNodesState(parsedNodes && parsedNodes.length > 0 ? parsedNodes : initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [generatedSql, setGeneratedSql] = useState("");
  const [activeTab, setActiveTab] = useState<"export" | "import">("export");
  const [importSqlText, setImportSqlText] = useState("");
  const [, setLocation] = useLocation();

  useEffect(() => {
    setNodes(parsedNodes && parsedNodes.length > 0 ? parsedNodes : initialNodes);
  }, [parsedNodes, setNodes]);

  const onConnect = useCallback((params: Connection | Edge) => {
    setEdges((eds) => {
      const newEdges = addEdge({
        ...params,
        type: 'smoothstep',
        animated: true,
        style: { stroke: 'hsl(var(--primary))', strokeWidth: 3, filter: 'drop-shadow(0 0 5px hsl(var(--primary)/0.5))' }
      } as unknown as Edge, eds) as Edge[];
      generateSql(nodes, newEdges);
      return newEdges;
    });
  }, [nodes]);

  const onEdgesDelete = useCallback((eds: Edge[]) => {
    const newEdges = edges.filter(e => !eds.find(deleted => deleted.id === e.id));
    generateSql(nodes, newEdges);
  }, [nodes, edges]);

  const generateSql = (currentNodes: any[], currentEdges: any[]) => {
    if (currentNodes.length === 0) return setGeneratedSql("");
    
    // Simple AST to string compiler
    let baseNode = currentNodes[0];
    
    const incomingEdges = currentEdges.reduce((acc, edge) => {
      if (!acc[edge.target]) acc[edge.target] = [];
      acc[edge.target].push(edge);
      return acc;
    }, {});

    for (const node of currentNodes) {
      if (!incomingEdges[node.id]) {
        baseNode = node;
        break;
      }
    }

    if (!baseNode) return setGeneratedSql("");

    let sql = `SELECT * \nFROM ${baseNode.data.tableName}`;

    const visited = new Set([baseNode.id]);
    const queue = [baseNode.id];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const outgoing = currentEdges.filter(e => e.source === currentId);
      
      for (const edge of outgoing) {
        if (!visited.has(edge.target)) {
          visited.add(edge.target);
          queue.push(edge.target);
          
          const targetNode = currentNodes.find(n => n.id === edge.target);
          const sourceCol = edge.sourceHandle?.replace('-out', '') || 'id';
          const targetCol = edge.targetHandle?.replace('-in', '') || 'id';
          
          sql += `\nLEFT JOIN ${targetNode?.data.tableName} ON ${baseNode.data.tableName}.${sourceCol} = ${targetNode?.data.tableName}.${targetCol}`;
        }
      }
    }

    setGeneratedSql(sql);
  };

  const handleImportSql = () => {
    if (!importSqlText.trim()) return;
    
    const availableTables = parsedNodes && parsedNodes.length > 0 ? parsedNodes : initialNodes;
    const cleanSql = importSqlText.replace(/\s+/g, ' ').trim();
    
    const fromMatch = cleanSql.match(/FROM\s+([a-zA-Z0-9_`"\[\]]+)/i);
    if (!fromMatch) {
      alert("Invalid SELECT statement. Make sure it contains FROM <table>.");
      return;
    }
    const baseTableName = fromMatch[1].replace(/[`"\[\]]/g, '');
    
    const joinRegex = /(?:LEFT|RIGHT|INNER|FULL)?\s*JOIN\s+([a-zA-Z0-9_`"\[\]]+)\s+ON\s+([a-zA-Z0-9_`"\[\].\s+=]+)/gi;
    const activeTableNames = new Set<string>([baseTableName.toLowerCase()]);
    const joins: { targetTable: string; condition: string }[] = [];
    
    let match;
    while ((match = joinRegex.exec(cleanSql)) !== null) {
      const targetTable = match[1].replace(/[`"\[\]]/g, '');
      const condition = match[2];
      joins.push({ targetTable, condition });
      activeTableNames.add(targetTable.toLowerCase());
    }
    
    const flowNodes: any[] = [];
    let index = 0;
    
    activeTableNames.forEach(tName => {
      const existing = availableTables.find((n: any) => n.id.toLowerCase() === tName);
      const columns = existing?.data?.columns || [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: `${tName.replace(/s$/, '')}_id`, type: 'integer', isForeign: true }
      ];
      
      const xSpacing = 320;
      const ySpacing = 150;
      
      flowNodes.push({
        id: tName,
        type: 'tableNode',
        position: { x: 50 + index * xSpacing, y: 100 + (index % 2) * ySpacing },
        data: {
          tableName: tName,
          columns: columns
        }
      });
      index++;
    });
    
    const flowEdges: Edge[] = [];
    joins.forEach((join, jIdx) => {
      const condParts = join.condition.split('=');
      if (condParts.length === 2) {
        const left = condParts[0].trim().split('.');
        const right = condParts[1].trim().split('.');
        
        if (left.length === 2 && right.length === 2) {
          const sourceTable = left[0].replace(/[`"\[\]]/g, '').trim().toLowerCase();
          const sourceCol = left[1].replace(/[`"\[\]]/g, '').trim();
          const targetTable = right[0].replace(/[`"\[\]]/g, '').trim().toLowerCase();
          const targetCol = right[1].replace(/[`"\[\]]/g, '').trim();
          
          flowEdges.push({
            id: `edge-parsed-${jIdx}`,
            source: sourceTable,
            target: targetTable,
            sourceHandle: `${sourceCol}-out`,
            targetHandle: `${targetCol}-in`,
            type: 'smoothstep',
            animated: true,
            style: { stroke: 'hsl(var(--primary))', strokeWidth: 3, filter: 'drop-shadow(0 0 5px hsl(var(--primary)/0.5))' }
          });
        }
      }
    });

    setNodes(flowNodes);
    setEdges(flowEdges);
    setGeneratedSql(importSqlText);
    setActiveTab("export");
    setShowInstructions(false);
  };

  useEffect(() => {
    generateSql(nodes, edges);
  }, []);

  const handleOptimize = () => {
    if (generatedSql) {
      sessionStorage.setItem('prefillQuery', generatedSql);
      setLocation('/dashboard');
    }
  };

  return (
    <div className="flex h-full w-full bg-background flex-col md:flex-row relative">
      <div className="flex-1 relative h-full bg-background overflow-hidden z-10">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] bg-gradient-to-r from-primary/10 via-blue-500/10 to-transparent rounded-full blur-[120px] pointer-events-none z-0"></div>
        
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onEdgesDelete={onEdgesDelete}
          onConnect={onConnect}
          onPaneClick={() => setShowInstructions(false)}
          onNodeClick={() => setShowInstructions(false)}
          nodeTypes={nodeTypes}
          fitView
          colorMode="dark"
          className="bg-muted/10"
        >
          <Controls className="bg-card border-border fill-foreground" />
          <MiniMap className="bg-card border-border" maskColor="hsl(var(--background)/0.5)" />
          <Background gap={12} size={1} color="hsl(var(--muted-foreground)/0.2)" />
        </ReactFlow>
        
        {showInstructions && (
          <div className="absolute top-4 left-4 bg-card border border-border p-4 rounded-lg shadow-lg z-10 max-w-sm pointer-events-none transition-opacity duration-300">
            <h3 className="font-bold mb-1 flex items-center gap-2 text-foreground">
              <Zap className="h-4 w-4 text-primary" />
              Visual Query Builder
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Drag connections from a column's right handle to another column's left handle to create SQL JOINs visually.
            </p>
          </div>
        )}
      </div>

      {/* Code Sidebar */}
      <div className="w-full md:w-96 border-t md:border-t-0 md:border-l border-border bg-card flex flex-col z-20 shadow-[-10px_0_30px_-15px_rgba(0,0,0,0.3)] shrink-0">
        <div className="p-2 border-b border-border bg-muted/20 flex gap-2 shrink-0">
          <Button 
            variant={activeTab === "export" ? "secondary" : "ghost"} 
            size="sm" 
            className="flex-1 text-xs"
            onClick={() => setActiveTab("export")}
          >
            Generated SQL
          </Button>
          <Button 
            variant={activeTab === "import" ? "secondary" : "ghost"} 
            size="sm" 
            className="flex-1 text-xs"
            onClick={() => setActiveTab("import")}
          >
            Import SQL
          </Button>
        </div>
        
        <div className="flex-1 p-4 bg-muted/10 overflow-y-auto">
          {activeTab === "export" ? (
            <pre className="font-mono text-sm text-primary/90 whitespace-pre-wrap break-words">
              {generatedSql || "-- Connect tables to generate SQL"}
            </pre>
          ) : (
            <div className="flex flex-col gap-3 h-full">
              <textarea
                placeholder="Paste SELECT ... FROM ... JOIN ... query here"
                className="flex-1 w-full bg-[#0a0a0c] border border-border text-foreground font-mono text-xs p-3 rounded focus:outline-none focus:ring-1 focus:ring-primary min-h-[200px]"
                value={importSqlText}
                onChange={(e) => setImportSqlText(e.target.value)}
              />
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleImportSql}
                disabled={!importSqlText.trim()}
              >
                Compile to Visual Canvas
              </Button>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border bg-card shrink-0 space-y-4">
          <p className="text-xs text-muted-foreground">
            This SQL query is auto-generated from your visual canvas in real-time. Click optimize to run it through the AI.
          </p>
          <Button 
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-lg shadow-primary/20 h-12"
            onClick={handleOptimize}
            disabled={!generatedSql}
          >
            <Play className="h-4 w-4 mr-2 fill-current" />
            Optimize Query in Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
