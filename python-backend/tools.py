import json
from langchain_core.tools import tool
import psycopg2
import psycopg2.extras
import mysql.connector

class DbConfig:
    def __init__(self, db_type, host=None, port=None, database=None, user=None, password=None):
        self.db_type = db_type
        self.host = host
        self.port = port
        self.database = database
        self.user = user
        self.password = password

# We will use a global or context variable for db_config, but for simplicity in LangChain tools, 
# we can wrap the tool creation in a function.
def create_tools(db_config: DbConfig, on_trace):

    def execute_query(query: str):
        if db_config.db_type == "postgresql":
            conn = psycopg2.connect(
                host=db_config.host,
                port=db_config.port,
                dbname=db_config.database,
                user=db_config.user,
                password=db_config.password,
                sslmode='require' # Adjust as necessary
            )
            try:
                with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                    cur.execute(query)
                    if cur.description:
                        return [dict(row) for row in cur.fetchall()]
                    return []
            finally:
                conn.close()
        else:
            conn = mysql.connector.connect(
                host=db_config.host,
                port=db_config.port,
                database=db_config.database,
                user=db_config.user,
                password=db_config.password
            )
            try:
                with conn.cursor(dictionary=True) as cur:
                    cur.execute(query)
                    return cur.fetchall()
            finally:
                conn.close()

    @tool
    def get_schema(tables: list[str]) -> str:
        """Fetch the schema (columns, data types) for a specific table or list of tables."""
        if on_trace: on_trace(f"  -> Using tool: get_schema for {tables}")
        try:
            result = ""
            for table in tables:
                if db_config.db_type == "postgresql":
                    rows = execute_query(f"SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '{table}';")
                    result += f"Table: {table}\n" + json.dumps(rows, indent=2) + "\n\n"
                else:
                    rows = execute_query(f"DESCRIBE {table};")
                    result += f"Table: {table}\n" + json.dumps(rows, indent=2) + "\n\n"
            return result or "No schema found."
        except Exception as e:
            return f"Error fetching schema: {str(e)}"

    @tool
    def get_indexes(table: str) -> str:
        """Fetch all indexes for a specific table."""
        if on_trace: on_trace(f"  -> Using tool: get_indexes for {table}")
        try:
            if db_config.db_type == "postgresql":
                rows = execute_query(f"SELECT indexname, indexdef FROM pg_indexes WHERE tablename = '{table}';")
                return json.dumps(rows, indent=2)
            else:
                rows = execute_query(f"SHOW INDEX FROM {table};")
                return json.dumps(rows, indent=2)
        except Exception as e:
            return f"Error fetching indexes: {str(e)}"

    @tool
    def run_explain(query: str) -> str:
        """Run EXPLAIN ANALYZE on a SQL query to get the execution plan and cost."""
        if on_trace: on_trace(f"  -> Using tool: run_explain")
        try:
            if db_config.db_type == "postgresql":
                rows = execute_query(f"EXPLAIN (ANALYZE, FORMAT JSON) {query}")
                return json.dumps(rows, indent=2)
            else:
                rows = execute_query(f"EXPLAIN FORMAT=JSON {query}")
                return json.dumps(rows, indent=2)
        except Exception as e:
            return f"Error running EXPLAIN: {str(e)}"

    @tool
    def analyze_cost(explain_json: str) -> str:
        """Analyze an EXPLAIN JSON output to extract total cost and execution time."""
        if on_trace: on_trace(f"  -> Using tool: analyze_cost")
        try:
            data = json.loads(explain_json)
            if db_config.db_type == "postgresql":
                plan = data[0].get('Plan')
                if not plan: return "Invalid Postgres EXPLAIN JSON"
                return f"Total Cost: {plan.get('Total Cost')}, Execution Time: {data[0].get('Execution Time', 'Unknown')} ms"
            else:
                cost = data.get('query_block', {}).get('cost_info', {}).get('query_cost')
                return f"Total Cost: {cost or 'Unknown'}"
        except Exception as e:
            return f"Error analyzing cost: {str(e)}"

    @tool
    def optimize_indexes(table: str, columns: list[str], reason: str) -> str:
        """Recommend a specific index based on a sequential scan or slow operation."""
        if on_trace: on_trace(f"  -> Using tool: optimize_indexes")
        idx_name = f"idx_{table}_{'_'.join(columns)}"
        statement = f"CREATE INDEX {idx_name} ON {table}({', '.join(columns)});"
        return json.dumps({"statement": statement, "reason": reason})

    return [get_schema, get_indexes, run_explain, analyze_cost, optimize_indexes]
