import { describe, it, expect } from 'vitest';
import { NodeSqlJsAdapter, DatabaseAdapter } from '../src';
import { DatabaseUnifiedReportService, ChartConfiguration } from '../src/services/reports/index.js';

describe('UnifiedReportService', () => {
  it('CRUD + charts + duplication + favorites', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const svc = new DatabaseUnifiedReportService(adapter as DatabaseAdapter);

    // Create
    const created = await svc.saveReport({
      name: 'Spending By Category',
      description: 'Test report',
      query: 'SELECT 1 as x',
      charts: [
        {
          chartType: 'bar',
          xAxisColumn: 'x',
          yAxisColumn: 'y',
          aggregateFunction: 'SUM',
          title: 'Chart 1',
        },
      ],
      tags: ['tag1'],
      isFavorite: false,
    });

    expect(created.id).toBeTruthy();
    expect(created.charts.length).toBe(1);

    // Duplicate name should fail
    expect(() =>
      svc.saveReport({
        name: 'Spending By Category',
        description: 'dup',
        query: 'SELECT 2',
        charts: [],
        tags: [],
        isFavorite: false,
      })
    ).toThrow(/already exists/);

    // Get and list
    const fetched = await svc.getReport(created.id);
    expect(fetched?.name).toBe('Spending By Category');
    const list = await svc.getReports();
    expect(list.length).toBe(1);

    // Update fields
    const updated = await svc.updateReport(created.id, {
      name: 'Spending By Category v2',
      description: 'Updated',
      query: 'SELECT 3',
      tags: ['tag2'],
      isFavorite: true,
    });
    expect(updated.name).toBe('Spending By Category v2');
    expect(updated.isFavorite).toBe(true);

    // Add a chart
    const withChart = await svc.addChartToReport(updated.id, {
      chartType: 'line',
      xAxisColumn: 'd',
      yAxisColumn: 'v',
      aggregateFunction: 'SUM',
      title: 'Time',
    });
    expect(withChart.charts.length).toBe(2);
    const addedChartId = withChart.charts[1].id;

    // Update chart
    const afterChartUpdate = await svc.updateChartInReport(updated.id, addedChartId, {
      title: 'Time Updated',
    } as Partial<ChartConfiguration>);
    expect(afterChartUpdate.charts.find((c) => c.id === addedChartId)?.title).toBe('Time Updated');

    // Remove chart
    const afterRemove = await svc.removeChartFromReport(updated.id, addedChartId);
    expect(afterRemove.charts.length).toBe(1);

    // Toggle favorite
    const toggled = await svc.toggleFavorite(updated.id);
    expect(toggled.isFavorite).toBe(false);

    // Duplicate report
    const dup = await svc.duplicateReport(updated.id, 'Spending Copy');
    expect(dup.id).not.toBe(updated.id);
    expect(dup.name).toBe('Spending Copy');
    // Chart IDs should be regenerated
    expect(dup.charts[0].id).not.toBe(afterRemove.charts[0].id);

    // Update with duplicate name should fail
    expect(() => svc.updateReport(dup.id, { name: 'Spending By Category v2' })).toThrow(
      /already exists/
    );

    // Delete
    await svc.deleteReport(updated.id);
    const postDelete = await svc.getReport(updated.id);
    expect(postDelete).toBeNull();
  });
});
