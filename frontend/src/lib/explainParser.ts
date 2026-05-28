import type { ExplainNode } from "@workspace/api-client-react";

export function parseRawExplainToTree(text: string): ExplainNode | null {
  if (!text) return null;
  const clean = text.trim();

  // Try JSON parsing first (Postgres EXPLAIN FORMAT JSON or MySQL JSON EXPLAIN)
  if (clean.startsWith("{") || clean.startsWith("[")) {
    try {
      const parsed = JSON.parse(clean);
      return parseJsonExplain(parsed);
    } catch(e) {
      // Fallback to text parsing if invalid JSON
    }
  }

  // Text parsing (PostgreSQL default)
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return null;

  const stack: { node: ExplainNode, indent: number }[] = [];
  let root: ExplainNode | null = null;
  let currentNode: ExplainNode | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indentMatch = line.match(/^(\s*(?:->\s*)?)/);
    const indent = indentMatch ? indentMatch[1].length : 0;
    const content = line.substring(indentMatch ? indentMatch[1].length : 0);
    
    // If it's an attribute of the current node
    if (content.match(/^(?:Filter|Hash Cond|Recheck Cond|Rows Removed by Filter|Sort Key|Sort Method|Join Filter):/)) {
      if (currentNode) {
        currentNode.details = currentNode.details || [];
        currentNode.details.push(content.trim());
      }
      continue;
    }
    if (content.match(/^(?:Planning Time|Execution Time|Buckets|Memory Usage|Planning|Execution|JIT):/)) {
      continue; // Skip global metrics for nodes
    }

    // Try to parse basic node info
    let node_type = content.split('  (')[0];
    let cost = "";
    let rows = "";
    let execution_time = "";

    const costMatch = content.match(/cost=([\d.]+..[\d.]+)/);
    if (costMatch) cost = costMatch[1];
    
    const rowsMatch = content.match(/rows=(\d+)/);
    if (rowsMatch) rows = rowsMatch[1];

    const timeMatch = content.match(/actual time=([\d.]+..[\d.]+)/);
    if (timeMatch) execution_time = timeMatch[1] + "ms";

    const node: ExplainNode = {
      node_type: node_type || "Unknown Node",
      cost,
      rows,
      execution_time,
      details: [],
      children: []
    };

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (stack.length === 0) {
      if (!root) root = node;
    } else {
      stack[stack.length - 1].node.children = stack[stack.length - 1].node.children || [];
      stack[stack.length - 1].node.children!.push(node);
    }

    stack.push({ node, indent });
    currentNode = node;
  }

  return root;
}

function parseJsonExplain(json: any): ExplainNode | null {
  if (Array.isArray(json)) {
    if (json.length > 0 && json[0].Plan) {
      return parsePostgresJsonNode(json[0].Plan);
    }
  } else if (json.query_block) {
    return parseMysqlJsonNode(json.query_block);
  }
  return null;
}

function parsePostgresJsonNode(node: any): ExplainNode {
  const details: string[] = [];
  if (node["Filter"]) details.push(`Filter: ${node["Filter"]}`);
  if (node["Sort Key"]) details.push(`Sort Key: ${Array.isArray(node["Sort Key"]) ? node["Sort Key"].join(", ") : node["Sort Key"]}`);
  if (node["Hash Cond"]) details.push(`Hash Cond: ${node["Hash Cond"]}`);
  
  return {
    node_type: node["Node Type"] || "Unknown",
    cost: node["Total Cost"] ? String(node["Total Cost"]) : undefined,
    rows: node["Plan Rows"] ? String(node["Plan Rows"]) : undefined,
    execution_time: node["Actual Total Time"] ? String(node["Actual Total Time"]) + "ms" : undefined,
    details: details.length > 0 ? details : undefined,
    children: (node.Plans || []).map(parsePostgresJsonNode)
  };
}

function parseMysqlJsonNode(node: any): ExplainNode {
  if (node.nested_loop) {
    return {
      node_type: "Nested Loop",
      children: node.nested_loop.map((n: any) => parseMysqlJsonNode(n.table || n))
    };
  }
  
  const details: string[] = [];
  if (node.attached_condition) details.push(`Condition: ${node.attached_condition}`);
  if (node.used_key_parts) details.push(`Keys: ${node.used_key_parts.join(", ")}`);
  
  return {
    node_type: node.access_type ? `Access: ${node.access_type}` : (node.table_name || "Unknown"),
    cost: node.cost_info?.read_cost ? String(node.cost_info.read_cost) : undefined,
    rows: node.rows_examined_per_scan ? String(node.rows_examined_per_scan) : undefined,
    details: details.length > 0 ? details : undefined,
    children: []
  };
}
