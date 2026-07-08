package application

import (
	"context"

	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/port/driven/repository"
	"budgero-server/internal/port/driving"
)

// DatabaseBrowserService implements driving.DatabaseBrowserService.
type DatabaseBrowserService struct {
	browserRepo repository.DatabaseBrowserRepository
	queries     *sqlc.Queries
}

// NewDatabaseBrowserService creates a new DatabaseBrowserService.
func NewDatabaseBrowserService(browserRepo repository.DatabaseBrowserRepository, queries *sqlc.Queries) *DatabaseBrowserService {
	return &DatabaseBrowserService{browserRepo: browserRepo, queries: queries}
}

var _ driving.DatabaseBrowserService = (*DatabaseBrowserService)(nil)

// ListTables returns a list of all tables in the database.
func (s *DatabaseBrowserService) ListTables(ctx context.Context) ([]repository.TableSummary, error) {
	return s.browserRepo.ListTables(ctx)
}

// GetTableColumns returns column information for a table.
func (s *DatabaseBrowserService) GetTableColumns(ctx context.Context, tableName string) ([]repository.TableColumnInfo, error) {
	return s.browserRepo.GetTableColumns(ctx, tableName)
}

// GetTableData returns paginated data from a table with optional ordering.
func (s *DatabaseBrowserService) GetTableData(ctx context.Context, tableName string, limit, offset int, orderBy, orderDir string) (*repository.TableDataResult, error) {
	return s.browserRepo.GetTableData(ctx, tableName, limit, offset, orderBy, orderDir)
}

// UpdateRow updates a row in a table and returns the updated row.
func (s *DatabaseBrowserService) UpdateRow(ctx context.Context, tableName string, primaryKey, updates map[string]interface{}) (map[string]interface{}, error) {
	return s.browserRepo.UpdateRow(ctx, tableName, primaryKey, updates)
}

// RunQuery executes a raw SQL query and returns the results.
func (s *DatabaseBrowserService) RunQuery(ctx context.Context, query string) (*repository.QueryResult, error) {
	return s.browserRepo.RunQuery(ctx, query)
}

// ListSavedQueries returns all saved queries.
func (s *DatabaseBrowserService) ListSavedQueries(ctx context.Context) ([]repository.SavedQuery, error) {
	rows, err := s.queries.ListSavedQueries(ctx)
	if err != nil {
		return nil, err
	}

	result := make([]repository.SavedQuery, len(rows))
	for i, row := range rows {
		result[i] = repository.SavedQuery{
			ID:        row.ID,
			Name:      row.Name,
			Query:     row.Query,
			CreatedAt: row.CreatedAt.String(),
			UpdatedAt: row.UpdatedAt.String(),
		}
	}
	return result, nil
}

// SaveQuery creates or updates a saved query.
func (s *DatabaseBrowserService) SaveQuery(ctx context.Context, name, query string) (*repository.SavedQuery, error) {
	// Check if exists
	existing, _ := s.queries.GetSavedQueryByName(ctx, name)
	if existing.ID > 0 {
		// Update existing
		if err := s.queries.UpdateSavedQuery(ctx, sqlc.UpdateSavedQueryParams{
			Query: query,
			Name:  name,
		}); err != nil {
			return nil, err
		}
		updated, err := s.queries.GetSavedQueryByName(ctx, name)
		if err != nil {
			return nil, err
		}
		return &repository.SavedQuery{
			ID:        updated.ID,
			Name:      updated.Name,
			Query:     updated.Query,
			CreatedAt: updated.CreatedAt.String(),
			UpdatedAt: updated.UpdatedAt.String(),
		}, nil
	}

	// Create new
	saved, err := s.queries.CreateSavedQuery(ctx, sqlc.CreateSavedQueryParams{
		Name:  name,
		Query: query,
	})
	if err != nil {
		return nil, err
	}
	return &repository.SavedQuery{
		ID:        saved.ID,
		Name:      saved.Name,
		Query:     saved.Query,
		CreatedAt: saved.CreatedAt.String(),
		UpdatedAt: saved.UpdatedAt.String(),
	}, nil
}

// DeleteSavedQuery removes a saved query.
func (s *DatabaseBrowserService) DeleteSavedQuery(ctx context.Context, name string) error {
	return s.queries.DeleteSavedQuery(ctx, name)
}
