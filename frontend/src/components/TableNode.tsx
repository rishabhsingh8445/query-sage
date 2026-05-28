import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Database, Key, Type, Hash } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export const TableNode = memo(({ data, isConnectable }: any) => {
  return (
    <div className="relative group">
      {/* Subtle ambient glow behind the node */}
      <div className="absolute -inset-3 bg-gradient-to-r from-primary/30 to-blue-500/30 rounded-2xl blur-xl opacity-0 group-hover:opacity-70 transition duration-700"></div>
      
      <div className="relative bg-card/80 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl min-w-[220px] transition-all duration-300 group-hover:border-primary/40">
        <div className="bg-gradient-to-r from-primary/20 to-transparent px-4 py-3 flex items-center justify-between border-b border-white/5 rounded-t-xl">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-primary/20 rounded-md">
              <Database className="h-4 w-4 text-primary" />
            </div>
            <strong className="text-sm font-bold text-foreground tracking-wide">{data.tableName}</strong>
          </div>
        </div>
        
        <div className="flex flex-col bg-black/20 rounded-b-xl">
        {data.columns.map((col: any, i: number) => (
          <div key={col.name} className="relative flex items-center justify-between px-3 py-1.5 border-b border-border/50 last:border-0 hover:bg-muted/50 text-xs last:rounded-b-xl">
            {/* Left handle for incoming joins */}
            <Handle
              type="target"
              position={Position.Left}
              id={`${col.name}-in`}
              className="w-3 h-3 bg-background border-2 border-primary/70 transition-colors hover:border-primary hover:bg-primary"
              style={{ left: '-6px' }}
              isConnectable={isConnectable}
            />

            <div className="flex items-center gap-2 w-full pr-4">
              {col.isPrimary ? (
                <Key className="h-3 w-3 text-amber-500 shrink-0" />
              ) : col.isForeign ? (
                <Key className="h-3 w-3 text-blue-500 shrink-0" />
              ) : col.type.includes('int') ? (
                <Hash className="h-3 w-3 text-muted-foreground shrink-0" />
              ) : (
                <Type className="h-3 w-3 text-muted-foreground shrink-0" />
              )}
              <span className="font-mono text-foreground/90 font-medium truncate">{col.name}</span>
            </div>
            
            <Badge variant="outline" className="text-[10px] font-mono shrink-0 bg-transparent text-muted-foreground/70 border-white/5 px-1.5 py-0 h-5 flex items-center">
              {col.type}
            </Badge>

            {/* Right handle for outgoing joins */}
            <Handle
              type="source"
              position={Position.Right}
              id={`${col.name}-out`}
              className="w-3 h-3 bg-background border-2 border-primary/70 transition-colors hover:border-primary hover:bg-primary"
              style={{ right: '-6px' }}
              isConnectable={isConnectable}
            />
          </div>
        ))}
      </div>
    </div>
  </div>
  );
});
