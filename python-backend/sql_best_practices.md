# SQL Optimization Playbook

## [Global] Indexing Strategies
Maximize index efficiency. Ensure columns used in WHERE clauses, JOIN conditions, and ORDER BY clauses have appropriate indexes (B-Tree). Avoid indexing columns with low selectivity (e.g., booleans). Prefer composite indexes for multi-column query filters.

## [Global] Join Optimization
Avoid nested loops on large datasets. Ensure JOIN columns have matching data types and are indexed. Avoid Cartesian products (cross joins) unless explicitly needed. Use INNER JOIN instead of OUTER JOIN where possible to reduce intermediate dataset sizes.

## [Global] Subqueries vs CTEs
Prefer Common Table Expressions (CTEs) or window functions over correlated subqueries for readability and optimizer planning. Avoid nesting subqueries deeply as it makes optimizer plan generation inefficient and forces temporary tables.

## [Global] SELECT Wildcards
Avoid using SELECT * in production queries. Explicitly define column names to minimize data transfer size, prevent memory saturation, and leverage covering indexes.

## [Global] OR to UNION
Avoid using OR in join filters or large WHERE clauses as it forces full table scans. Use UNION or UNION ALL to merge distinct indexed lookups instead.

## [Global] LIKE Wildcards
Avoid leading wildcards in LIKE statements (e.g., '%term') as they disable index range scans and force full table scans. Use trailing wildcards (e.g., 'term%') or full-text indexes instead.

## [Global] Aggregate Simplification
Ensure GROUP BY columns are indexed and minimize the number of columns grouped. Avoid using heavy functions on WHERE clause columns (e.g., YEAR(date_column) = 2026), as it disables index scanning. Use range checks instead (e.g., date_column >= '2026-01-01' AND date_column < '2027-01-01').

## [PostgreSQL] Partial Indexing
For large tables with heavily skewed data, use PostgreSQL partial indexes (e.g., `CREATE INDEX ... WHERE active = true`) to minimize index size and accelerate scans on selective rows.

## [MySQL] Index Hints & Types
Avoid using FORCE INDEX unless necessary. If the MySQL optimizer chooses a sub-optimal scan plan, verify matching key data types before using optimizer hints. Utilize EXPLAIN to trace index lookup key lengths.

## [SQLite] WAL Mode & Indexes
To optimize performance in SQLite, ensure database runs in WAL (Write-Ahead Logging) mode and columns with constraints have matching data types since SQLite uses manifest typing.
