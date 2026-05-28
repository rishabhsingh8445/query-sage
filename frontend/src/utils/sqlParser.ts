import { Node } from '@xyflow/react';

export function parseSqlSchemaToNodes(schemaText: string): Node[] {
  if (!schemaText || typeof schemaText !== 'string') return [];

  const nodes: Node[] = [];
  
  // Clean up comments and multi-line formatting to simplify parsing
  const cleanSchema = schemaText
    .replace(/--.*$/gm, '') // Remove single line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi line comments
    .replace(/\s+/g, ' '); // Compress whitespace

  // Regex to match CREATE TABLE statements
  const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\w`"\[\]]+\.)?([a-zA-Z0-9_`"\[\]]+)\s*\((.*?)\)(?:;|\s*$)/gi;
  
  let match;
  let index = 0;

  while ((match = tableRegex.exec(cleanSchema)) !== null) {
    const rawTableName = match[1];
    const columnsBlock = match[2];
    
    // Clean up table name (remove quotes, brackets, backticks)
    const tableName = rawTableName.replace(/[`"\[\]]/g, '');

    // Split columns by comma. But be careful of commas inside parentheses like decimal(10,2)
    // A simple approach: split by comma but only if it's not inside parentheses
    const columnDefinitions = columnsBlock.split(/,\s*(?![^\(\)]*\))/);

    const columns: any[] = [];

    columnDefinitions.forEach((colDef) => {
      const colStr = colDef.trim();
      if (!colStr) return;

      // Skip table-level constraints for now (like PRIMARY KEY(id), FOREIGN KEY)
      // We will try to catch inline constraints
      if (/^(PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK|CONSTRAINT)\b/i.test(colStr)) {
        return; 
      }

      // First word is column name, second word is type
      const parts = colStr.split(' ').filter(Boolean);
      if (parts.length < 2) return;

      const rawColName = parts[0];
      const colName = rawColName.replace(/[`"\[\]]/g, '');
      
      const type = parts[1].toLowerCase();

      const isPrimary = /PRIMARY\s+KEY/i.test(colStr);
      // Rough check for foreign key inline, or id ending in _id
      const isForeign = /REFERENCES/i.test(colStr) || colName.endsWith('_id');

      columns.push({
        name: colName,
        type: type,
        isPrimary,
        isForeign
      });
    });

    if (columns.length > 0) {
      // Calculate a nice layout position. Let's do a simple grid.
      // 3 columns wide
      const cols = 3;
      const xSpacing = 350;
      const ySpacing = 300;
      
      const x = 50 + (index % cols) * xSpacing;
      const y = 50 + Math.floor(index / cols) * ySpacing;

      nodes.push({
        id: tableName,
        type: 'tableNode',
        position: { x, y },
        data: {
          tableName: tableName,
          columns: columns
        }
      });
      
      index++;
    }
  }

  return nodes;
}
