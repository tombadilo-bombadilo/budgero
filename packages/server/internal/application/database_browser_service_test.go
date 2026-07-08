package application_test

import (
	"context"
	"errors"
	"testing"

	"budgero-server/internal/application"
	"budgero-server/internal/port/driven/repository"
)

// fakeDatabaseBrowserRepository is a mock implementation for testing.
type fakeDatabaseBrowserRepository struct {
	tables     []repository.TableSummary
	columns    map[string][]repository.TableColumnInfo
	tableData  *repository.TableDataResult
	queryRes   *repository.QueryResult
	updateRow  map[string]interface{}
	err        error
	queryError error
}

func (f *fakeDatabaseBrowserRepository) ListTables(ctx context.Context) ([]repository.TableSummary, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.tables, nil
}

func (f *fakeDatabaseBrowserRepository) GetTableColumns(ctx context.Context, tableName string) ([]repository.TableColumnInfo, error) {
	if f.err != nil {
		return nil, f.err
	}
	if cols, ok := f.columns[tableName]; ok {
		return cols, nil
	}
	return nil, nil
}

func (f *fakeDatabaseBrowserRepository) GetTableData(ctx context.Context, tableName string, limit, offset int, orderBy, orderDir string) (*repository.TableDataResult, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.tableData, nil
}

func (f *fakeDatabaseBrowserRepository) UpdateRow(ctx context.Context, tableName string, primaryKey, updates map[string]interface{}) (map[string]interface{}, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.updateRow, nil
}

func (f *fakeDatabaseBrowserRepository) RunQuery(ctx context.Context, query string) (*repository.QueryResult, error) {
	if f.queryError != nil {
		return nil, f.queryError
	}
	if f.err != nil {
		return nil, f.err
	}
	return f.queryRes, nil
}

func TestDatabaseBrowserService_ListTables(t *testing.T) {
	ctx := context.Background()
	repo := &fakeDatabaseBrowserRepository{
		tables: []repository.TableSummary{
			{Name: "users", RowCount: 10},
			{Name: "spaces", RowCount: 5},
		},
	}
	svc := application.NewDatabaseBrowserService(repo, nil)

	tables, err := svc.ListTables(ctx)
	if err != nil {
		t.Fatalf("ListTables() error = %v", err)
	}

	if len(tables) != 2 {
		t.Errorf("ListTables() returned %d tables, want 2", len(tables))
	}
	if tables[0].Name != "users" {
		t.Errorf("tables[0].Name = %v, want users", tables[0].Name)
	}
}

func TestDatabaseBrowserService_ListTables_Error(t *testing.T) {
	ctx := context.Background()
	expectedErr := errors.New("database error")
	repo := &fakeDatabaseBrowserRepository{err: expectedErr}
	svc := application.NewDatabaseBrowserService(repo, nil)

	_, err := svc.ListTables(ctx)
	if err == nil {
		t.Error("ListTables() expected error")
	}
}

func TestDatabaseBrowserService_GetTableColumns(t *testing.T) {
	ctx := context.Background()
	repo := &fakeDatabaseBrowserRepository{
		columns: map[string][]repository.TableColumnInfo{
			"users": {
				{Name: "id", Type: "TEXT", PrimaryKey: true},
				{Name: "email", Type: "TEXT", NotNull: true},
				{Name: "name", Type: "TEXT"},
			},
		},
	}
	svc := application.NewDatabaseBrowserService(repo, nil)

	columns, err := svc.GetTableColumns(ctx, "users")
	if err != nil {
		t.Fatalf("GetTableColumns() error = %v", err)
	}

	if len(columns) != 3 {
		t.Errorf("GetTableColumns() returned %d columns, want 3", len(columns))
	}
	if columns[0].Name != "id" {
		t.Errorf("columns[0].Name = %v, want id", columns[0].Name)
	}
	if !columns[0].PrimaryKey {
		t.Error("columns[0].PrimaryKey = false, want true")
	}
}

func TestDatabaseBrowserService_GetTableData(t *testing.T) {
	ctx := context.Background()
	repo := &fakeDatabaseBrowserRepository{
		tableData: &repository.TableDataResult{
			Columns: []repository.TableColumnInfo{
				{Name: "id", Type: "TEXT"},
				{Name: "email", Type: "TEXT"},
			},
			Rows: []map[string]interface{}{
				{"id": "1", "email": "user1@example.com"},
				{"id": "2", "email": "user2@example.com"},
			},
			TotalCount: 2,
		},
	}
	svc := application.NewDatabaseBrowserService(repo, nil)

	result, err := svc.GetTableData(ctx, "users", 10, 0, "id", "asc")
	if err != nil {
		t.Fatalf("GetTableData() error = %v", err)
	}

	if result.TotalCount != 2 {
		t.Errorf("TotalCount = %d, want 2", result.TotalCount)
	}
	if len(result.Rows) != 2 {
		t.Errorf("Rows count = %d, want 2", len(result.Rows))
	}
}

func TestDatabaseBrowserService_UpdateRow(t *testing.T) {
	ctx := context.Background()
	expectedRow := map[string]interface{}{
		"id":    "1",
		"email": "updated@example.com",
		"name":  "Updated Name",
	}
	repo := &fakeDatabaseBrowserRepository{updateRow: expectedRow}
	svc := application.NewDatabaseBrowserService(repo, nil)

	primaryKey := map[string]interface{}{"id": "1"}
	updates := map[string]interface{}{"email": "updated@example.com", "name": "Updated Name"}

	result, err := svc.UpdateRow(ctx, "users", primaryKey, updates)
	if err != nil {
		t.Fatalf("UpdateRow() error = %v", err)
	}

	if result["email"] != "updated@example.com" {
		t.Errorf("result[email] = %v, want updated@example.com", result["email"])
	}
}

func TestDatabaseBrowserService_RunQuery(t *testing.T) {
	ctx := context.Background()
	repo := &fakeDatabaseBrowserRepository{
		queryRes: &repository.QueryResult{
			Columns: []string{"count"},
			Rows:    [][]interface{}{{int64(42)}},
		},
	}
	svc := application.NewDatabaseBrowserService(repo, nil)

	result, err := svc.RunQuery(ctx, "SELECT COUNT(*) as count FROM users")
	if err != nil {
		t.Fatalf("RunQuery() error = %v", err)
	}

	if len(result.Columns) != 1 {
		t.Errorf("Columns count = %d, want 1", len(result.Columns))
	}
	if len(result.Rows) != 1 {
		t.Errorf("Rows count = %d, want 1", len(result.Rows))
	}
}

func TestDatabaseBrowserService_RunQuery_Error(t *testing.T) {
	ctx := context.Background()
	expectedErr := errors.New("syntax error")
	repo := &fakeDatabaseBrowserRepository{queryError: expectedErr}
	svc := application.NewDatabaseBrowserService(repo, nil)

	_, err := svc.RunQuery(ctx, "INVALID SQL")
	if err == nil {
		t.Error("RunQuery() expected error for invalid SQL")
	}
}
