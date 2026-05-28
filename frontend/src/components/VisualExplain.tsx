import { ChevronRight, ChevronDown, Activity, Clock, Database, Hash, List } from "lucide-react";
import { useState } from "react";
import { ExplainNode } from "@workspace/api-client-react";

interface VisualExplainProps {
  node: ExplainNode;
  defaultExpanded?: boolean;
}

export function VisualExplain({ node, defaultExpanded = true }: VisualExplainProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const hasChildren = node.children && node.children.length > 0;
  
  // Try to determine the generic icon based on the node type
  const typeLower = node.node_type.toLowerCase();
  let Icon = Activity;
  if (typeLower.includes("scan")) Icon = Database;
  else if (typeLower.includes("join")) Icon = Hash;
  else if (typeLower.includes("sort")) Icon = List;

  return (
    <div className="font-mono text-sm">
      <div 
        className={`flex items-start p-2 rounded-md border border-border/50 bg-background hover:bg-muted/50 transition-colors ${hasChildren ? "cursor-pointer" : ""}`}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        <div className="mr-2 mt-1 w-4 h-4 flex items-center justify-center text-muted-foreground">
          {hasChildren ? (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="w-4" />}
        </div>
        
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <Icon size={14} className="text-primary" />
            <span className="font-bold text-foreground">{node.node_type}</span>
          </div>
          
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mt-1">
            {node.cost && (
              <span className="flex items-center gap-1 bg-muted px-1.5 py-0.5 rounded">
                <span className="opacity-70">Cost:</span> {node.cost}
              </span>
            )}
            {node.rows && (
              <span className="flex items-center gap-1 bg-muted px-1.5 py-0.5 rounded">
                <span className="opacity-70">Rows:</span> {node.rows}
              </span>
            )}
            {node.execution_time && (
              <span className="flex items-center gap-1 bg-muted px-1.5 py-0.5 rounded">
                <Clock size={10} className="opacity-70" /> {node.execution_time}
              </span>
            )}
          </div>
          {node.details && node.details.length > 0 && (
            <div className="mt-2 space-y-1">
              {node.details.map((detail, i) => (
                <div key={i} className="text-[11px] text-muted-foreground bg-primary/5 border border-primary/10 rounded px-2 py-1 flex items-start gap-1.5 break-all">
                  <span className="text-primary mt-0.5 opacity-70">↳</span>
                  {detail}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {expanded && hasChildren && (
        <div className="pl-6 mt-2 space-y-2 border-l border-border/50 ml-4 relative">
          {node.children!.map((child: ExplainNode, idx: number) => (
            <div key={idx} className="relative">
              <div className="absolute -left-6 top-4 w-6 h-px bg-border/50" />
              <VisualExplain node={child} defaultExpanded={defaultExpanded} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
