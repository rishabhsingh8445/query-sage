import { useState, useMemo, useEffect } from "react";
import { 
  ReactFlow, 
  MiniMap, 
  Controls, 
  Background, 
  Handle, 
  Position,
  Node,
  Edge,
  useNodesState,
  useEdgesState
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Activity, Clock, Database, Hash, List, ShieldAlert, Sparkles, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";

interface ExplainNode {
  node_type: string;
  cost?: string;
  rows?: string;
  execution_time?: string;
  details?: string[];
  children?: ExplainNode[];
}

interface ExplainGraphProps {
  rootNode: ExplainNode | null;
}

// Custom Node component
function CustomExplainNode({ data }: any) {
  const nodeType = data.node_type || "Unknown Node";
  const typeLower = nodeType.toLowerCase();
  
  let severity: "high" | "medium" | "low" | "none" = "none";
  let Icon = Activity;
  let colorClass = "border-border hover:border-primary/50";
  let bgClass = "bg-card/90";
  let glowClass = "group-hover:opacity-40";
  
  if (typeLower.includes("seq scan") || typeLower.includes("sequential scan")) {
    severity = "high";
    Icon = ShieldAlert;
    colorClass = "border-red-500/50 hover:border-red-500";
    bgClass = "bg-red-950/20";
    glowClass = "from-red-500/20 to-orange-500/20 group-hover:opacity-75";
  } else if (typeLower.includes("index") || typeLower.includes("bitmap heap")) {
    severity = "none";
    Icon = Database;
    colorClass = "border-green-500/50 hover:border-green-500";
    bgClass = "bg-green-950/10";
    glowClass = "from-green-500/10 to-teal-500/10 group-hover:opacity-60";
  } else if (typeLower.includes("join") || typeLower.includes("nested loop")) {
    severity = "medium";
    Icon = Hash;
    colorClass = "border-purple-500/50 hover:border-purple-500";
    bgClass = "bg-purple-950/10";
    glowClass = "from-purple-500/15 to-indigo-500/15 group-hover:opacity-60";
  } else if (typeLower.includes("sort")) {
    Icon = List;
    colorClass = "border-blue-500/50 hover:border-blue-500";
    bgClass = "bg-blue-950/10";
    glowClass = "from-blue-500/10 to-cyan-500/10 group-hover:opacity-60";
  }

  return (
    <div className="relative group min-w-[260px] max-w-[320px]">
      <Handle type="target" position={Position.Top} className="w-2.5 h-2.5 bg-background border-2 border-primary/50" />
      
      {/* Background glow */}
      <div className={`absolute -inset-2 bg-gradient-to-r ${glowClass} rounded-xl blur-lg opacity-0 transition duration-500`}></div>
      
      <div className={`relative ${bgClass} backdrop-blur-md border ${colorClass} rounded-lg p-3 shadow-xl transition-all duration-300`}>
        <div className="flex items-center justify-between gap-2 border-b border-white/5 pb-2 mb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Icon className={`h-4 w-4 shrink-0 ${severity === "high" ? "text-red-500" : severity === "medium" ? "text-purple-400" : "text-primary"}`} />
            <span className="font-mono text-xs font-bold text-foreground truncate">{nodeType}</span>
          </div>
          {severity === "high" && (
            <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4 bg-red-500/20 text-red-400 border-red-500/30 animate-pulse uppercase">
              Slow
            </Badge>
          )}
        </div>

        <div className="space-y-1.5">
          {data.cost && (
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className="text-muted-foreground">Total Cost:</span>
              <span className="text-foreground/90 font-medium">{data.cost}</span>
            </div>
          )}
          {data.rows && (
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className="text-muted-foreground">Est Rows:</span>
              <span className="text-foreground/90 font-medium">{data.rows}</span>
            </div>
          )}
          {data.execution_time && (
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className="text-muted-foreground flex items-center gap-1"><Clock size={9} /> Actual Time:</span>
              <span className="text-foreground/90 font-medium">{data.execution_time}</span>
            </div>
          )}
        </div>

        {data.details && data.details.length > 0 && (
          <div className="mt-2 text-[9px] font-mono text-muted-foreground/80 border-t border-white/5 pt-1.5 truncate">
            {data.details[0]}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="w-2.5 h-2.5 bg-background border-2 border-primary/50" />
    </div>
  );
}

const nodeTypes = {
  explainNode: CustomExplainNode,
};

export function ExplainGraph({ rootNode }: ExplainGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedExplainNode, setSelectedExplainNode] = useState<ExplainNode | null>(null);

  const parsedGraph = useMemo(() => {
    if (!rootNode) return { nodes: [], edges: [] };

    let currentId = 0;
    interface ExtendedNode extends ExplainNode {
      id: string;
      x?: number;
      y?: number;
      children?: ExtendedNode[];
    }

    // Pass 1: Assign ID and recursively map children
    function prepare(n: ExplainNode): ExtendedNode {
      const id = `node-${currentId++}`;
      const children = (n.children || []).map(prepare);
      return {
        ...n,
        id,
        children,
      };
    }

    const extendedRoot = prepare(rootNode);

    // Pass 2: Layout coordinates top-down
    let nextX = 0;
    const nodeMap: Record<string, ExtendedNode> = {};
    
    function layout(n: ExtendedNode, depth: number = 0): { x: number; y: number } {
      const y = depth * 180; // vertical spacing
      
      if (!n.children || n.children.length === 0) {
        const x = nextX;
        nextX += 340; // horizontal spacing between sibling leaf nodes
        n.x = x;
        n.y = y;
        nodeMap[n.id] = n;
        return { x, y };
      }

      const childCoords = n.children.map(c => layout(c, depth + 1));
      const avgX = childCoords.reduce((acc, c) => acc + c.x, 0) / childCoords.length;
      n.x = avgX;
      n.y = y;
      nodeMap[n.id] = n;
      return { x: avgX, y };
    }

    layout(extendedRoot, 0);

    // Pass 3: Construct React Flow nodes and edges
    const flowNodes: Node[] = [];
    const flowEdges: Edge[] = [];

    function buildFlow(n: ExtendedNode) {
      flowNodes.push({
        id: n.id,
        type: "explainNode",
        position: { x: n.x || 0, y: n.y || 0 },
        data: {
          node_type: n.node_type,
          cost: n.cost,
          rows: n.rows,
          execution_time: n.execution_time,
          details: n.details,
          rawNode: n // keep ref to open in details panel
        }
      });

      if (n.children) {
        n.children.forEach(c => {
          flowEdges.push({
            id: `edge-${n.id}-${c.id}`,
            source: n.id,
            target: c.id,
            type: "smoothstep",
            animated: true,
            style: { stroke: "rgba(120, 119, 198, 0.4)", strokeWidth: 2 }
          });
          buildFlow(c);
        });
      }
    }

    buildFlow(extendedRoot);
    return { nodes: flowNodes, edges: flowEdges };
  }, [rootNode]);

  useEffect(() => {
    setNodes(parsedGraph.nodes);
    setEdges(parsedGraph.edges);
  }, [parsedGraph, setNodes, setEdges]);

  const onNodeClick = (_: any, node: Node) => {
    setSelectedExplainNode(node.data.rawNode as ExplainNode);
  };

  return (
    <div className="flex h-[450px] w-full border border-border/80 rounded-lg overflow-hidden bg-black/40 backdrop-blur-md relative">
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
            <Background color="#333" gap={16} />
            <Controls className="bg-background/90 border border-border text-foreground fill-current rounded" />
            <MiniMap 
              style={{ height: 100, width: 140 }} 
              className="bg-background/90 border border-border rounded opacity-90 hidden sm:block" 
              nodeColor={() => "var(--primary)"}
              maskColor="rgba(0, 0, 0, 0.6)"
            />
          </ReactFlow>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground font-mono text-xs">
            No explain plan to draw.
          </div>
        )}
      </div>

      {/* Selected Node Details sidebar */}
      {selectedExplainNode && (
        <div className="w-[300px] border-l border-border bg-card/90 backdrop-blur-xl p-4 flex flex-col justify-between animate-in slide-in-from-right duration-300">
          <div>
            <div className="flex items-center justify-between border-b border-border/60 pb-3 mb-4">
              <h4 className="font-bold text-sm text-foreground flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-primary" />
                Plan Step Details
              </h4>
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-6 text-xs px-1.5 text-muted-foreground"
                onClick={() => setSelectedExplainNode(null)}
              >
                ✕ Close
              </Button>
            </div>
            
            <ScrollArea className="h-[320px] pr-2">
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider font-mono">Operation Type</label>
                  <p className="font-mono text-xs font-semibold text-foreground/90 mt-0.5">{selectedExplainNode.node_type}</p>
                </div>

                <div className="grid grid-cols-2 gap-4 border-y border-border/40 py-3">
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider font-mono">Total Cost</label>
                    <p className="font-mono text-xs text-foreground/90 mt-0.5">{selectedExplainNode.cost || "N/A"}</p>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider font-mono">Est. Rows</label>
                    <p className="font-mono text-xs text-foreground/90 mt-0.5">{selectedExplainNode.rows || "N/A"}</p>
                  </div>
                </div>

                {selectedExplainNode.execution_time && (
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider font-mono">Execution Time</label>
                    <p className="font-mono text-xs text-foreground/95 flex items-center gap-1 mt-0.5">
                      <Clock size={11} className="text-primary" /> {selectedExplainNode.execution_time}
                    </p>
                  </div>
                )}

                {selectedExplainNode.details && selectedExplainNode.details.length > 0 ? (
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider font-mono">Details / Conditions</label>
                    <div className="mt-1 space-y-2">
                      {selectedExplainNode.details.map((detail, idx) => (
                        <div key={idx} className="font-mono text-[10px] text-muted-foreground/90 bg-muted/60 border border-border/60 rounded p-1.5 whitespace-pre-wrap break-all leading-normal">
                          {detail}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-[10px] text-muted-foreground/60 italic font-mono flex items-center gap-1.5 bg-muted/20 p-2 border border-dashed border-border/50 rounded">
                    <HelpCircle size={12} /> No conditions attached to this planner node.
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="border-t border-border/60 pt-3">
            <Button className="w-full text-xs h-9 font-semibold" variant="outline">
              <Sparkles className="h-3 w-3 mr-1.5 text-primary" /> Ask AI About Step
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
