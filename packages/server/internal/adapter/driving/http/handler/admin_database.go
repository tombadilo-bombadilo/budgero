package handler

import (
	"net/http"
	"strconv"
	"strings"

	"budgero-server/internal/pkg/crypto"
	"budgero-server/internal/port/driven/repository"

	"github.com/labstack/echo/v4"
)

type tableColumnResponse struct {
	Name         string      `json:"name"`
	Type         string      `json:"type"`
	Nullable     bool        `json:"nullable"`
	PrimaryKey   bool        `json:"primaryKey"`
	DefaultValue interface{} `json:"defaultValue,omitempty"`
}

type tableSummaryResponse struct {
	Name        string                `json:"name"`
	RowCount    int64                 `json:"rowCount"`
	Description *string               `json:"description,omitempty"`
	Schema      *string               `json:"schema,omitempty"`
	Columns     []tableColumnResponse `json:"columns,omitempty"`
}

type updateRowRequest struct {
	PrimaryKey map[string]interface{} `json:"primaryKey"`
	Updates    map[string]interface{} `json:"updates"`
}

type runQueryRequest struct {
	Query string `json:"query"`
}

type runQueryResponse struct {
	Columns       []string        `json:"columns"`
	Rows          [][]interface{} `json:"rows"`
	RowCount      int64           `json:"rowCount"`
	ExecutionTime float64         `json:"executionTime"`
	Message       string          `json:"message,omitempty"`
	Truncated     bool            `json:"truncated,omitempty"`
}

func columnInfoToResponse(col repository.TableColumnInfo) tableColumnResponse {
	var defaultVal interface{}
	if col.DefaultValue != nil {
		defaultVal = *col.DefaultValue
	}
	return tableColumnResponse{
		Name:         col.Name,
		Type:         col.Type,
		Nullable:     !col.NotNull,
		PrimaryKey:   col.PrimaryKey,
		DefaultValue: defaultVal,
	}
}

// GetDatabaseTables returns all database tables with metadata.
func (h *Handlers) GetDatabaseTables(c echo.Context) error {
	ctx := c.Request().Context()

	tables, err := h.services.DatabaseBrowser.ListTables(ctx)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to list tables")
	}

	summaries := make([]tableSummaryResponse, 0, len(tables))
	for _, t := range tables {
		columnResponses := make([]tableColumnResponse, 0, len(t.Columns))
		for _, col := range t.Columns {
			columnResponses = append(columnResponses, columnInfoToResponse(col))
		}

		summaries = append(summaries, tableSummaryResponse{
			Name:     t.Name,
			RowCount: t.RowCount,
			Schema:   t.Schema,
			Columns:  columnResponses,
		})
	}

	return c.JSON(http.StatusOK, summaries)
}

// GetDatabaseTableData returns paginated data for a table.
func (h *Handlers) GetDatabaseTableData(c echo.Context) error {
	tableName := strings.TrimSpace(c.Param("name"))
	if !crypto.IsValidIdentifier(tableName) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid table name")
	}

	limit := 50
	if v := c.QueryParam("limit"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			if parsed < 1 {
				parsed = 1
			}
			if parsed > 500 {
				parsed = 500
			}
			limit = parsed
		}
	}

	offset := 0
	if v := c.QueryParam("offset"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 {
			offset = parsed
		}
	}

	orderBy := strings.TrimSpace(c.QueryParam("orderBy"))
	orderDir := strings.ToUpper(strings.TrimSpace(c.QueryParam("orderDirection")))
	if orderDir != "ASC" {
		orderDir = "DESC"
	}

	ctx := c.Request().Context()
	result, err := h.services.DatabaseBrowser.GetTableData(ctx, tableName, limit, offset, orderBy, orderDir)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			return echo.NewHTTPError(http.StatusNotFound, err.Error())
		}
		if strings.Contains(err.Error(), "invalid") {
			return echo.NewHTTPError(http.StatusBadRequest, err.Error())
		}
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	columnResponse := make([]tableColumnResponse, 0, len(result.Columns))
	for _, col := range result.Columns {
		columnResponse = append(columnResponse, columnInfoToResponse(col))
	}

	response := map[string]interface{}{
		"columns":    columnResponse,
		"rows":       result.Rows,
		"totalCount": result.TotalCount,
		"primaryKey": result.PrimaryKeys,
	}

	return c.JSON(http.StatusOK, response)
}

// UpdateDatabaseRow updates a row in the specified table.
func (h *Handlers) UpdateDatabaseRow(c echo.Context) error {
	tableName := strings.TrimSpace(c.Param("name"))
	if !crypto.IsValidIdentifier(tableName) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid table name")
	}

	var payload updateRowRequest
	if err := c.Bind(&payload); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	ctx := c.Request().Context()
	updatedRow, err := h.services.DatabaseBrowser.UpdateRow(ctx, tableName, payload.PrimaryKey, payload.Updates)
	if err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "not found") {
			return echo.NewHTTPError(http.StatusNotFound, errMsg)
		}
		if strings.Contains(errMsg, "required") || strings.Contains(errMsg, "cannot be") || strings.Contains(errMsg, "unknown column") || strings.Contains(errMsg, "invalid") {
			return echo.NewHTTPError(http.StatusBadRequest, errMsg)
		}
		return echo.NewHTTPError(http.StatusInternalServerError, errMsg)
	}

	if updatedRow == nil {
		return c.JSON(http.StatusOK, map[string]interface{}{"success": true})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"row":     updatedRow,
	})
}

// RunDatabaseQuery executes a custom SQL query and returns results.
func (h *Handlers) RunDatabaseQuery(c echo.Context) error {
	var payload runQueryRequest
	if err := c.Bind(&payload); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	ctx := c.Request().Context()
	result, err := h.services.DatabaseBrowser.RunQuery(ctx, payload.Query)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	return c.JSON(http.StatusOK, runQueryResponse{
		Columns:       result.Columns,
		Rows:          result.Rows,
		RowCount:      result.RowCount,
		ExecutionTime: result.ExecutionTime,
		Message:       result.Message,
		Truncated:     result.Truncated,
	})
}

// ListSavedQueries returns all saved queries.
func (h *Handlers) ListSavedQueries(c echo.Context) error {
	ctx := c.Request().Context()
	queries, err := h.services.DatabaseBrowser.ListSavedQueries(ctx)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to list saved queries")
	}

	return c.JSON(http.StatusOK, queries)
}

// SaveQuery creates or updates a saved query.
func (h *Handlers) SaveQuery(c echo.Context) error {
	var payload struct {
		Name  string `json:"name"`
		Query string `json:"query"`
	}
	if err := c.Bind(&payload); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	payload.Name = strings.TrimSpace(payload.Name)
	payload.Query = strings.TrimSpace(payload.Query)

	if payload.Name == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "name is required")
	}
	if payload.Query == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "query is required")
	}

	ctx := c.Request().Context()
	saved, err := h.services.DatabaseBrowser.SaveQuery(ctx, payload.Name, payload.Query)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to save query")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"id":      saved.ID,
		"name":    saved.Name,
	})
}

// DeleteSavedQuery removes a saved query by name.
func (h *Handlers) DeleteSavedQuery(c echo.Context) error {
	name := strings.TrimSpace(c.Param("name"))
	if name == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "name is required")
	}

	ctx := c.Request().Context()
	if err := h.services.DatabaseBrowser.DeleteSavedQuery(ctx, name); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to delete query")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
	})
}
