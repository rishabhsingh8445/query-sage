export interface ParsedBottleneck {
  type: string;
  table: string | null;
  description: string;
  severity: string;
}

export interface ParsedExplainResult {
  nodes: ParsedNode[];
  bottlenecks: ParsedBottleneck[];
  summary: string;
}

export interface ParsedNode {
  nodeType: string;
  table: string | null;
  actualTime: number | null;
  rows: number | null;
  loops: number | null;
  startupCost: number | null;
  totalCost: number | null;
}

function parsePostgres(output: string): ParsedExplainResult {
  const nodes: ParsedNode[] = [];
  const bottlenecks: ParsedBottleneck[] = [];

  const lines = output.split("\n");

  for (const line of lines) {
    const nodeMatch = line.match(/->\s*([\w\s]+?)(?:\s+on\s+(\w+))?\s+\(cost=(\d+\.?\d*)\.\.(\d+\.?\d*)/i);
    const timeMatch = line.match(/actual time=(\d+\.?\d*)\.\.(\d+\.?\d*)\s+rows=(\d+)\s+loops=(\d+)/i);

    if (nodeMatch || timeMatch) {
      const node: ParsedNode = {
        nodeType: nodeMatch?.[1]?.trim() ?? "Unknown",
        table: nodeMatch?.[2] ?? null,
        actualTime: timeMatch ? parseFloat(timeMatch[2]) : null,
        rows: timeMatch ? parseInt(timeMatch[3], 10) : null,
        loops: timeMatch ? parseInt(timeMatch[4], 10) : null,
        startupCost: nodeMatch ? parseFloat(nodeMatch[3]) : null,
        totalCost: nodeMatch ? parseFloat(nodeMatch[4]) : null,
      };
      nodes.push(node);
    }

    const seqMatch = line.match(/Seq Scan on (\w+)/i);
    if (seqMatch) {
      const tableName = seqMatch[1];
      const rowsMatch = line.match(/rows=(\d+)/i);
      const rowCount = rowsMatch ? parseInt(rowsMatch[1], 10) : 0;

      const filterMatch = line.match(/Filter:|filter/i);
      if (filterMatch) {
        bottlenecks.push({
          type: "MISSING_INDEX",
          table: tableName,
          description: `Sequential scan with filter on ${tableName} — consider adding an index on the filtered column(s)`,
          severity: rowCount > 10000 ? "HIGH" : rowCount > 1000 ? "MEDIUM" : "LOW",
        });
      } else if (rowCount > 1000) {
        bottlenecks.push({
          type: "SEQ_SCAN",
          table: tableName,
          description: `Sequential scan on large table ${tableName} (${rowCount} rows) — missing index`,
          severity: rowCount > 100000 ? "HIGH" : "MEDIUM",
        });
      }
    }

    const hashJoinMatch = line.match(/Hash Join/i);
    if (hashJoinMatch) {
      const innerRowsMatch = line.match(/rows=(\d+)/i);
      const innerRows = innerRowsMatch ? parseInt(innerRowsMatch[1], 10) : 0;
      if (innerRows > 10000) {
        bottlenecks.push({
          type: "BAD_JOIN_ORDER",
          table: null,
          description: `Hash Join with large inner side (${innerRows} rows) — consider reordering joins or adding indexes`,
          severity: "MEDIUM",
        });
      }
    }

    const nestedLoopMatch = line.match(/Nested Loop/i);
    if (nestedLoopMatch && !line.match(/condition|join/i)) {
      bottlenecks.push({
        type: "CARTESIAN_PRODUCT",
        table: null,
        description: "Nested Loop without join condition detected — possible cartesian product",
        severity: "HIGH",
      });
    }

    const subqueryMatch = line.match(/SubqueryScan|InitPlan|SubPlan/i);
    if (subqueryMatch) {
      bottlenecks.push({
        type: "INEFFICIENT_SUBQUERY",
        table: null,
        description: "Subquery scan detected — consider rewriting as a JOIN for better performance",
        severity: "MEDIUM",
      });
    }
  }

  const uniqueBottlenecks = bottlenecks.filter(
    (b, i, arr) => arr.findIndex((x) => x.type === b.type && x.table === b.table) === i
  );

  const summary = nodes.length > 0
    ? `Execution plan has ${nodes.length} node(s). ${uniqueBottlenecks.length} bottleneck(s) detected: ${uniqueBottlenecks.map(b => b.type).join(", ") || "none"}.`
    : "Could not parse execution plan nodes.";

  return { nodes, bottlenecks: uniqueBottlenecks, summary };
}

function parseMysql(output: string): ParsedExplainResult {
  const nodes: ParsedNode[] = [];
  const bottlenecks: ParsedBottleneck[] = [];

  const lines = output.split("\n");
  for (const line of lines) {
    const tabMatch = line.match(/(\w+)\s*\|\s*(\w+|NULL)\s*\|\s*(\d+)/);
    if (tabMatch) {
      const accessType = tabMatch[2];
      const rows = parseInt(tabMatch[3], 10);
      const tableName = tabMatch[1];

      nodes.push({
        nodeType: accessType,
        table: tableName,
        actualTime: null,
        rows,
        loops: null,
        startupCost: null,
        totalCost: null,
      });

      if (accessType === "ALL") {
        bottlenecks.push({
          type: "SEQ_SCAN",
          table: tableName,
          description: `Full table scan on ${tableName} (${rows} estimated rows) — no index used`,
          severity: rows > 10000 ? "HIGH" : "MEDIUM",
        });
      } else if (accessType === "NULL" || line.includes("NULL")) {
        bottlenecks.push({
          type: "MISSING_INDEX",
          table: tableName,
          description: `No index used on ${tableName} — add an index on the join/filter column`,
          severity: "HIGH",
        });
      }
    }
  }

  const summary = bottlenecks.length > 0
    ? `MySQL EXPLAIN shows ${bottlenecks.length} issue(s): ${bottlenecks.map(b => b.type).join(", ")}`
    : "MySQL EXPLAIN parsed. No major bottlenecks detected in output.";

  return { nodes, bottlenecks, summary };
}

export function parseExplainOutput(
  output: string,
  dbType: string
): ParsedExplainResult {
  if (!output || !output.trim()) {
    return { nodes: [], bottlenecks: [], summary: "No EXPLAIN output provided" };
  }

  if (dbType === "mysql") {
    return parseMysql(output);
  }
  return parsePostgres(output);
}
