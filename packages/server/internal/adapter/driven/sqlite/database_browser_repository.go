package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"budgero-server/internal/port/driven/repository"
)

var identifierRegexp = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// DatabaseBrowserRepository implements repository.DatabaseBrowserRepository using SQLite.
type DatabaseBrowserRepository struct {
	db *sql.DB
}

// NewDatabaseBrowserRepository creates a new DatabaseBrowserRepository.
func NewDatabaseBrowserRepository(db *sql.DB) *DatabaseBrowserRepository {
	return &DatabaseBrowserRepository{db: db}
}

var _ repository.DatabaseBrowserRepository = (*DatabaseBrowserRepository)(nil)

// isValidIdentifier checks if a name is a valid SQL identifier.
func isValidIdentifier(name string) bool {
	return identifierRegexp.MatchString(name)
}

// quoteIdentifier safely quotes an identifier for use in SQL.
func quoteIdentifier(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

// ListTables returns a summary of all tables in the database.
func (r *DatabaseBrowserRepository) ListTables(ctx context.Context) ([]repository.TableSummary, error) {
	query := `SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to list tables: %w", err)
	}
	defer func() { _ = rows.Close() }()

	summaries := make([]repository.TableSummary, 0)

	for rows.Next() {
		var name string
		var schema sql.NullString
		if err := rows.Scan(&name, &schema); err != nil {
			continue
		}

		if !isValidIdentifier(name) {
			continue
		}

		count, err := r.countRows(ctx, name)
		if err != nil {
			continue
		}

		cols, err := r.GetTableColumns(ctx, name)
		if err != nil {
			continue
		}

		var schemaPtr *string
		if schema.Valid {
			trimmed := strings.TrimSpace(schema.String)
			schemaPtr = &trimmed
		}

		summaries = append(summaries, repository.TableSummary{
			Name:     name,
			RowCount: count,
			Schema:   schemaPtr,
			Columns:  cols,
		})
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating tables: %w", err)
	}

	return summaries, nil
}

// GetTableColumns returns column information for a table.
func (r *DatabaseBrowserRepository) GetTableColumns(ctx context.Context, tableName string) ([]repository.TableColumnInfo, error) {
	if !isValidIdentifier(tableName) {
		return nil, sql.ErrNoRows
	}

	pragma := fmt.Sprintf("PRAGMA table_info(%s)", quoteIdentifier(tableName))
	rows, err := r.db.QueryContext(ctx, pragma)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	columns := make([]repository.TableColumnInfo, 0)
	for rows.Next() {
		var info repository.TableColumnInfo
		var notNull int
		var pk int
		var cid int
		var defaultValue sql.NullString
		if err := rows.Scan(&cid, &info.Name, &info.Type, &notNull, &defaultValue, &pk); err != nil {
			return nil, err
		}
		info.NotNull = notNull == 1
		info.PrimaryKey = pk > 0
		info.PKPosition = pk
		if defaultValue.Valid {
			info.DefaultValue = &defaultValue.String
		}

		if !isValidIdentifier(info.Name) {
			continue
		}

		columns = append(columns, info)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return columns, nil
}

// GetTableData returns paginated row data for a table.
func (r *DatabaseBrowserRepository) GetTableData(ctx context.Context, tableName string, limit, offset int, orderBy, orderDir string) (*repository.TableDataResult, error) {
	if !isValidIdentifier(tableName) {
		return nil, errors.New("invalid table name")
	}

	columns, err := r.GetTableColumns(ctx, tableName)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errors.New("table not found")
		}
		return nil, fmt.Errorf("failed to load table schema: %w", err)
	}
	if len(columns) == 0 {
		return nil, errors.New("table not found")
	}

	columnMap := make(map[string]repository.TableColumnInfo, len(columns))
	for _, col := range columns {
		columnMap[col.Name] = col
	}

	if orderBy != "" {
		if _, ok := columnMap[orderBy]; !ok {
			return nil, errors.New("invalid order column")
		}
	}

	dataRows, err := r.fetchRows(ctx, tableName, columns, limit, offset, orderBy, orderDir)
	if err != nil {
		return nil, err
	}

	totalCount, err := r.countRows(ctx, tableName)
	if err != nil {
		return nil, fmt.Errorf("failed to get row count: %w", err)
	}

	primaryKeys := make([]string, 0)
	for _, col := range columns {
		if col.PrimaryKey {
			primaryKeys = append(primaryKeys, col.Name)
		}
	}
	sort.SliceStable(primaryKeys, func(i, j int) bool {
		return columnMap[primaryKeys[i]].PKPosition < columnMap[primaryKeys[j]].PKPosition
	})

	return &repository.TableDataResult{
		Columns:     columns,
		Rows:        dataRows,
		TotalCount:  totalCount,
		PrimaryKeys: primaryKeys,
	}, nil
}

// UpdateRow updates a row in a table and returns the updated row.
func (r *DatabaseBrowserRepository) UpdateRow(ctx context.Context, tableName string, primaryKey, updates map[string]interface{}) (map[string]interface{}, error) {
	if !isValidIdentifier(tableName) {
		return nil, errors.New("invalid table name")
	}

	if len(primaryKey) == 0 {
		return nil, errors.New("primaryKey is required")
	}
	if len(updates) == 0 {
		return nil, errors.New("updates cannot be empty")
	}

	columns, err := r.GetTableColumns(ctx, tableName)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errors.New("table not found")
		}
		return nil, fmt.Errorf("failed to load table schema: %w", err)
	}
	if len(columns) == 0 {
		return nil, errors.New("table not found")
	}

	columnMap := make(map[string]repository.TableColumnInfo, len(columns))
	primaryKeyColumns := make([]repository.TableColumnInfo, 0)
	for _, col := range columns {
		columnMap[col.Name] = col
		if col.PrimaryKey {
			primaryKeyColumns = append(primaryKeyColumns, col)
		}
	}

	if len(primaryKeyColumns) == 0 {
		return nil, errors.New("table does not have a primary key")
	}

	updateColumns := make([]repository.TableColumnInfo, 0, len(updates))
	updateValues := make([]interface{}, 0, len(updates))

	for key, rawValue := range updates {
		col, ok := columnMap[key]
		if !ok {
			return nil, fmt.Errorf("unknown column: %s", key)
		}
		if col.PrimaryKey {
			return nil, errors.New("primary key columns cannot be updated")
		}

		var converted interface{}
		converted, err = convertValueForColumn(col, rawValue)
		if err != nil {
			return nil, err
		}

		if converted == nil && col.NotNull {
			return nil, fmt.Errorf("column %s cannot be null", key)
		}

		updateColumns = append(updateColumns, col)
		updateValues = append(updateValues, converted)
	}

	if len(updateColumns) == 0 {
		return nil, errors.New("no valid columns to update")
	}

	whereValues := make([]interface{}, 0, len(primaryKeyColumns))
	whereClauses := make([]string, 0, len(primaryKeyColumns))
	for _, pkCol := range primaryKeyColumns {
		rawValue, ok := primaryKey[pkCol.Name]
		if !ok {
			return nil, fmt.Errorf("missing primary key value for %s", pkCol.Name)
		}
		var converted interface{}
		converted, err = convertValueForColumn(pkCol, rawValue)
		if err != nil {
			return nil, err
		}
		if converted == nil {
			return nil, fmt.Errorf("primary key %s cannot be null", pkCol.Name)
		}
		whereClauses = append(whereClauses, fmt.Sprintf("%s = ?", quoteIdentifier(pkCol.Name)))
		whereValues = append(whereValues, converted)
	}

	setClauses := make([]string, 0, len(updateColumns))
	for _, col := range updateColumns {
		setClauses = append(setClauses, fmt.Sprintf("%s = ?", quoteIdentifier(col.Name)))
	}

	query := fmt.Sprintf("UPDATE %s SET %s WHERE %s", quoteIdentifier(tableName), strings.Join(setClauses, ", "), strings.Join(whereClauses, " AND ")) //nolint:gosec // G201: identifiers are properly quoted
	args := append(updateValues, whereValues...) //nolint:gocritic // appendAssign: result is intentionally assigned to new slice

	result, err := r.db.ExecContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to update row: %w", err)
	}

	affected, err := result.RowsAffected()
	if err == nil && affected == 0 {
		return nil, errors.New("row not found")
	}

	selectQuery := fmt.Sprintf("SELECT * FROM %s WHERE %s LIMIT 1", quoteIdentifier(tableName), strings.Join(whereClauses, " AND "))
	updatedRows, err := r.fetchRowsWithQuery(ctx, columns, selectQuery, whereValues...)
	if err != nil {
		return nil, fmt.Errorf("failed to load updated row: %w", err)
	}

	if len(updatedRows) == 0 {
		return nil, nil
	}

	return updatedRows[0], nil
}

// RunQuery executes an arbitrary SQL query and returns results.
func (r *DatabaseBrowserRepository) RunQuery(ctx context.Context, query string) (*repository.QueryResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, errors.New("query is required")
	}

	if strings.Count(query, ";") > 1 {
		return nil, errors.New("only single statements are allowed")
	}
	query = strings.TrimSuffix(query, ";")

	if strings.Contains(query, ";") {
		return nil, errors.New("only single statements are allowed")
	}

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	start := time.Now()
	lower := strings.ToLower(strings.TrimSpace(query))
	if strings.HasPrefix(lower, "select") || strings.HasPrefix(lower, "pragma") || strings.HasPrefix(lower, "explain") {
		result, err := r.executeSelectQuery(ctx, query)
		if err != nil {
			return nil, err
		}
		result.ExecutionTime = float64(time.Since(start).Microseconds()) / 1000.0
		return result, nil
	}

	execResult, err := r.db.ExecContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}

	rowsAffected, err := execResult.RowsAffected()
	if err != nil {
		rowsAffected = 0
	}

	return &repository.QueryResult{
		Columns:       []string{},
		Rows:          [][]interface{}{},
		RowCount:      rowsAffected,
		ExecutionTime: float64(time.Since(start).Microseconds()) / 1000.0,
		Message:       fmt.Sprintf("Query executed successfully (%d rows affected)", rowsAffected),
	}, nil
}

func (r *DatabaseBrowserRepository) executeSelectQuery(ctx context.Context, query string) (*repository.QueryResult, error) {
	const maxRows = 10000
	clean := strings.TrimSpace(query)
	if clean == "" {
		return nil, errors.New("query is required")
	}

	limitedQuery := fmt.Sprintf("SELECT * FROM (%s) AS subquery LIMIT %d", clean, maxRows) //nolint:gosec // G201: admin-only endpoint, query from authenticated user

	rows, err := r.db.QueryContext(ctx, limitedQuery)
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}
	defer func() { _ = rows.Close() }()

	columns, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("failed to read columns: %w", err)
	}

	ptrs := make([]interface{}, len(columns))
	raw := make([]interface{}, len(columns))
	for i := range ptrs {
		ptrs[i] = &raw[i]
	}

	dataRows := make([][]interface{}, 0, 128)
	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}
		row := make([]interface{}, len(columns))
		for idx, value := range raw {
			row[idx] = normalizeSQLValue(value)
		}
		dataRows = append(dataRows, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate rows: %w", err)
	}

	totalCount := int64(len(dataRows))
	countQuery := fmt.Sprintf("SELECT COUNT(*) AS count FROM (%s) AS subquery", clean) //nolint:gosec // G201: admin-only endpoint, query from authenticated user
	countRow := r.db.QueryRowContext(ctx, countQuery)
	if countRow != nil {
		var count int64
		if err := countRow.Scan(&count); err == nil {
			totalCount = count
		}
	}

	return &repository.QueryResult{
		Columns:   columns,
		Rows:      dataRows,
		RowCount:  totalCount,
		Truncated: totalCount > int64(len(dataRows)),
	}, nil
}

func (r *DatabaseBrowserRepository) countRows(ctx context.Context, tableName string) (int64, error) {
	query := fmt.Sprintf("SELECT COUNT(*) FROM %s", quoteIdentifier(tableName)) //nolint:gosec // G201: tableName is properly quoted
	var count int64
	if err := r.db.QueryRowContext(ctx, query).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func (r *DatabaseBrowserRepository) fetchRows(ctx context.Context, tableName string, columns []repository.TableColumnInfo, limit, offset int, orderBy, orderDir string) ([]map[string]interface{}, error) {
	baseQuery := fmt.Sprintf("SELECT * FROM %s", quoteIdentifier(tableName))
	if orderBy != "" {
		baseQuery += fmt.Sprintf(" ORDER BY %s %s", quoteIdentifier(orderBy), orderDir)
	}
	baseQuery += " LIMIT ? OFFSET ?"

	return r.fetchRowsWithQuery(ctx, columns, baseQuery, limit, offset)
}

func (r *DatabaseBrowserRepository) fetchRowsWithQuery(ctx context.Context, columns []repository.TableColumnInfo, query string, args ...interface{}) ([]map[string]interface{}, error) {
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	columnOrder := make([]repository.TableColumnInfo, len(columns))
	copy(columnOrder, columns)

	colNames, err := rows.Columns()
	if err == nil && len(colNames) == len(columnOrder) {
		nameToInfo := make(map[string]repository.TableColumnInfo, len(columns))
		for _, col := range columns {
			nameToInfo[col.Name] = col
		}
		ordered := make([]repository.TableColumnInfo, 0, len(colNames))
		for _, name := range colNames {
			if info, ok := nameToInfo[name]; ok {
				ordered = append(ordered, info)
			}
		}
		if len(ordered) == len(columns) {
			columnOrder = ordered
		}
	}

	scanTargets := make([]interface{}, len(columnOrder))
	rawValues := make([]interface{}, len(columnOrder))
	for i := range scanTargets {
		scanTargets[i] = &rawValues[i]
	}

	results := make([]map[string]interface{}, 0)
	for rows.Next() {
		if err := rows.Scan(scanTargets...); err != nil {
			return nil, err
		}

		row := make(map[string]interface{}, len(columnOrder))
		for idx, col := range columnOrder {
			value := normalizeValue(col, rawValues[idx])
			row[col.Name] = value
		}

		results = append(results, row)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return results, nil
}

func isBoolean(colType string) bool {
	t := strings.ToUpper(colType)
	return strings.Contains(t, "BOOL")
}

func isInteger(colType string) bool {
	t := strings.ToUpper(colType)
	if t == "" {
		return false
	}
	return strings.Contains(t, "INT") && !strings.Contains(t, "BOOL")
}

func isReal(colType string) bool {
	t := strings.ToUpper(colType)
	return strings.Contains(t, "REAL") || strings.Contains(t, "FLOA") || strings.Contains(t, "DOUB") || strings.Contains(t, "NUM")
}

func normalizeValue(col repository.TableColumnInfo, raw interface{}) interface{} {
	if raw == nil {
		return nil
	}

	switch v := raw.(type) {
	case []byte:
		str := string(v)
		if isBoolean(col.Type) {
			lower := strings.ToLower(strings.TrimSpace(str))
			if lower == "true" || lower == "1" || lower == "t" || lower == "yes" {
				return true
			}
			if lower == "false" || lower == "0" || lower == "f" || lower == "no" {
				return false
			}
		}
		return str
	case int64:
		if isBoolean(col.Type) {
			return v != 0
		}
		return v
	case float64:
		if isBoolean(col.Type) {
			return v != 0
		}
		return v
	case bool:
		return v
	default:
		return v
	}
}

func normalizeSQLValue(raw interface{}) interface{} {
	if raw == nil {
		return nil
	}

	switch v := raw.(type) {
	case []byte:
		return string(v)
	case time.Time:
		return v.UTC().Format(time.RFC3339Nano)
	case int64, float64, bool, string:
		return v
	default:
		return fmt.Sprintf("%v", v)
	}
}

func convertValueForColumn(col repository.TableColumnInfo, value interface{}) (interface{}, error) {
	if value == nil {
		return nil, nil
	}

	switch v := value.(type) {
	case bool:
		if isBoolean(col.Type) || isInteger(col.Type) {
			if v {
				return int64(1), nil
			}
			return int64(0), nil
		}
		return v, nil
	case float64:
		if isBoolean(col.Type) {
			if v != 0 {
				return int64(1), nil
			}
			return int64(0), nil
		}
		if isInteger(col.Type) {
			return int64(v), nil
		}
		if isReal(col.Type) {
			return v, nil
		}
		return v, nil
	case string:
		trimmed := strings.TrimSpace(v)
		if isBoolean(col.Type) {
			lower := strings.ToLower(trimmed)
			if lower == "true" || lower == "1" || lower == "t" || lower == "yes" {
				return int64(1), nil
			}
			if lower == "false" || lower == "0" || lower == "f" || lower == "no" || lower == "" {
				return int64(0), nil
			}
			return nil, fmt.Errorf("invalid boolean value for %s", col.Name)
		}
		if isInteger(col.Type) {
			parsed, err := strconv.ParseInt(trimmed, 10, 64)
			if err != nil {
				return nil, fmt.Errorf("invalid integer value for %s", col.Name)
			}
			return parsed, nil
		}
		if isReal(col.Type) {
			parsed, err := strconv.ParseFloat(trimmed, 64)
			if err != nil {
				return nil, fmt.Errorf("invalid numeric value for %s", col.Name)
			}
			return parsed, nil
		}
		if trimmed == "" && !col.NotNull {
			return nil, nil
		}
		return v, nil
	default:
		return v, nil
	}
}
