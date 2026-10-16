/**
 * Unified Reports Service - Production Ready Implementation
 * Manages SQL reports with embedded chart configurations
 */

import { DatabaseAdapter } from '../../database/interface.js';
import { getRow, allRows, run } from '../../database/sql.js';
import { clock } from '../../utils/clock.js';

/** Database row structure for saved_reports table */
interface SavedReportRow {
  ID: string;
  Name: string;
  Description: string | null;
  Query: string;
  Charts: string | null;
  CreatedAt: string;
  UpdatedAt: string;
  Tags: string | null;
  IsFavorite: number;
}

export interface ChartConfiguration {
  id: string;
  chartType: 'bar' | 'line' | 'area' | 'pie' | 'scatter' | 'table' | 'stat';
  title?: string;
  xAxisColumn: string;
  yAxisColumn: string;
  groupByColumn?: string;
  aggregateFunction: 'SUM' | 'COUNT' | 'AVG' | 'MAX' | 'MIN';
}

export interface UnifiedReport {
  id: string;
  name: string;
  description?: string;
  query: string;
  charts: ChartConfiguration[];
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  isFavorite?: boolean;
}

export type NewChartConfiguration = Omit<ChartConfiguration, 'id'> & { id?: string };

export type SaveReportInput = Omit<UnifiedReport, 'id' | 'createdAt' | 'updatedAt' | 'charts'> & {
  id?: string;
  charts?: NewChartConfiguration[];
};

export interface UnifiedReportService {
  // Core CRUD operations
  saveReport(data: SaveReportInput): UnifiedReport;
  getReports(): UnifiedReport[];
  getReport(id: string): UnifiedReport | null;
  updateReport(
    id: string,
    updates: Partial<Omit<UnifiedReport, 'id' | 'createdAt'>>
  ): UnifiedReport;
  /** Repair legacy replay ID drift before applying a remote update. */
  reconcileAndUpdateReport(
    id: string,
    updates: Partial<Omit<UnifiedReport, 'id' | 'createdAt'>>
  ): UnifiedReport;
  deleteReport(id: string): void;

  // Chart management within reports
  addChartToReport(reportId: string, chart: NewChartConfiguration): UnifiedReport;
  updateChartInReport(
    reportId: string,
    chartId: string,
    updates: Partial<ChartConfiguration>
  ): UnifiedReport;
  removeChartFromReport(reportId: string, chartId: string): UnifiedReport;

  // Utility methods
  toggleFavorite(id: string): UnifiedReport;
  duplicateReport(id: string, newName: string): UnifiedReport;
}

export class DatabaseUnifiedReportService implements UnifiedReportService {
  private db: DatabaseAdapter;

  constructor(db: DatabaseAdapter) {
    this.db = db;
  }

  saveReport(data: SaveReportInput): UnifiedReport {
    const existing = getRow(
      this.db,
      `SELECT ID FROM saved_reports WHERE Name = ?`,
      data.name.trim()
    );

    if (existing) {
      throw new Error(
        `A report with the name "${data.name.trim()}" already exists. Please choose a different name.`
      );
    }

    const id = data.id ?? globalThis.crypto.randomUUID();
    const now = clock.date().toISOString();

    const report: UnifiedReport = {
      id,
      name: data.name.trim(),
      description: data.description?.trim(),
      query: data.query,
      charts: (data.charts || []).map((chart) => ({
        ...chart,
        id: chart.id ?? globalThis.crypto.randomUUID(),
      })),
      createdAt: now,
      updatedAt: now,
      tags: data.tags || [],
      isFavorite: data.isFavorite || false,
    };

    try {
      run(
        this.db,
        `
        INSERT INTO saved_reports (ID, Name, Description, Query, Charts, CreatedAt, UpdatedAt, Tags, IsFavorite)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        report.id,
        report.name,
        report.description || null,
        report.query,
        JSON.stringify(report.charts),
        report.createdAt,
        report.updatedAt,
        JSON.stringify(report.tags),
        report.isFavorite ? 1 : 0
      );

      return report;
    } catch (error: unknown) {
      if (error instanceof Error && error.message?.includes('UNIQUE constraint failed')) {
        throw new Error(
          `A report with the name "${data.name.trim()}" already exists. Please choose a different name.`
        );
      }
      throw error;
    }
  }

  getReports(): UnifiedReport[] {
    const rows = allRows<SavedReportRow>(
      this.db,
      `
      SELECT * FROM saved_reports
      ORDER BY IsFavorite DESC, UpdatedAt DESC
    `
    );

    return rows.map((row) => this.mapRowToReport(row));
  }

  getReport(id: string): UnifiedReport | null {
    const row = getRow<SavedReportRow>(
      this.db,
      `
      SELECT * FROM saved_reports WHERE ID = ?
    `,
      id
    );

    return row ? this.mapRowToReport(row) : null;
  }

  updateReport(
    id: string,
    updates: Partial<Omit<UnifiedReport, 'id' | 'createdAt'>>
  ): UnifiedReport {
    // Check if new name conflicts with existing reports (excluding current report)
    if (updates.name !== undefined) {
      const trimmedName = updates.name.trim();
      const existing = getRow(
        this.db,
        `SELECT ID FROM saved_reports WHERE Name = ? AND ID != ?`,
        trimmedName,
        id
      );

      if (existing) {
        throw new Error(
          `A report with the name "${trimmedName}" already exists. Please choose a different name.`
        );
      }
    }

    const now = clock.date().toISOString();
    const updateFields: string[] = [];
    const updateValues: (string | number | null)[] = [];

    if (updates.name !== undefined) {
      updateFields.push('Name = ?');
      updateValues.push(updates.name.trim());
    }

    if (updates.description !== undefined) {
      updateFields.push('Description = ?');
      updateValues.push(updates.description);
    }

    if (updates.query !== undefined) {
      updateFields.push('Query = ?');
      updateValues.push(updates.query);
    }

    if (updates.charts !== undefined) {
      updateFields.push('Charts = ?');
      updateValues.push(JSON.stringify(updates.charts));
    }

    if (updates.tags !== undefined) {
      updateFields.push('Tags = ?');
      updateValues.push(JSON.stringify(updates.tags));
    }

    if (updates.isFavorite !== undefined) {
      updateFields.push('IsFavorite = ?');
      updateValues.push(updates.isFavorite ? 1 : 0);
    }

    updateFields.push('UpdatedAt = ?');
    updateValues.push(now);
    updateValues.push(id);

    run(
      this.db,
      `
      UPDATE saved_reports 
      SET ${updateFields.join(', ')} 
      WHERE ID = ?
    `,
      ...updateValues
    );

    const updatedReport = this.getReport(id);
    if (!updatedReport) {
      throw new Error('Report not found after update');
    }

    return updatedReport;
  }

  reconcileAndUpdateReport(
    id: string,
    updates: Partial<Omit<UnifiedReport, 'id' | 'createdAt'>>
  ): UnifiedReport {
    if (this.getReport(id)) {
      return this.updateReport(id, updates);
    }

    const match = this.findLegacyUpdateCandidate(updates);
    if (match.ambiguous) {
      throw new Error('Multiple legacy reports match the remote update');
    }
    const { candidate } = match;
    if (candidate) {
      return this.db.transaction(() => {
        this.rekeyLegacyReport(candidate, id, updates.charts);
        return this.updateReport(id, updates);
      });
    }

    if (
      typeof updates.name === 'string' &&
      typeof updates.query === 'string' &&
      Array.isArray(updates.charts)
    ) {
      return this.saveReport({
        id,
        name: updates.name,
        description: updates.description,
        query: updates.query,
        charts: updates.charts,
        tags: updates.tags,
        isFavorite: updates.isFavorite,
      });
    }

    throw new Error('Report not found and remote update is incomplete');
  }

  deleteReport(id: string): void {
    run(this.db, `DELETE FROM saved_reports WHERE ID = ?`, id);
  }

  addChartToReport(reportId: string, chart: NewChartConfiguration): UnifiedReport {
    const report = this.getReport(reportId);
    if (!report) {
      throw new Error('Report not found');
    }

    const newChart: ChartConfiguration = {
      ...chart,
      id: chart.id ?? globalThis.crypto.randomUUID(),
    };

    const updatedCharts = [...report.charts, newChart];

    return this.updateReport(reportId, { charts: updatedCharts });
  }

  updateChartInReport(
    reportId: string,
    chartId: string,
    updates: Partial<ChartConfiguration>
  ): UnifiedReport {
    const report = this.getReport(reportId);
    if (!report) {
      throw new Error('Report not found');
    }

    const chartIndex = report.charts.findIndex((c) => c.id === chartId);
    if (chartIndex === -1) {
      throw new Error('Chart not found in report');
    }

    const updatedCharts = [...report.charts];
    updatedCharts[chartIndex] = { ...updatedCharts[chartIndex], ...updates };

    return this.updateReport(reportId, { charts: updatedCharts });
  }

  removeChartFromReport(reportId: string, chartId: string): UnifiedReport {
    const report = this.getReport(reportId);
    if (!report) {
      throw new Error('Report not found');
    }

    const updatedCharts = report.charts.filter((c) => c.id !== chartId);

    return this.updateReport(reportId, { charts: updatedCharts });
  }

  toggleFavorite(id: string): UnifiedReport {
    const report = this.getReport(id);
    if (!report) {
      throw new Error('Report not found');
    }

    return this.updateReport(id, { isFavorite: !report.isFavorite });
  }

  duplicateReport(id: string, newName: string): UnifiedReport {
    const report = this.getReport(id);
    if (!report) {
      throw new Error('Report not found');
    }

    const duplicatedCharts = report.charts.map((chart) => ({
      ...chart,
      id: globalThis.crypto.randomUUID(),
    }));

    return this.saveReport({
      name: newName,
      description: report.description,
      query: report.query,
      charts: duplicatedCharts,
      tags: report.tags,
      isFavorite: false,
    });
  }

  private findLegacyUpdateCandidate(updates: Partial<Omit<UnifiedReport, 'id' | 'createdAt'>>): {
    candidate: UnifiedReport | null;
    ambiguous: boolean;
  } {
    const reports = this.getReports();
    const normalizedName = updates.name?.trim().toLocaleLowerCase();
    if (normalizedName) {
      const byName = reports.filter(
        (report) => report.name.trim().toLocaleLowerCase() === normalizedName
      );
      if (byName.length === 1) return { candidate: byName[0], ambiguous: false };
      if (byName.length > 1) return { candidate: null, ambiguous: true };
    }

    if (typeof updates.query !== 'string' || !Array.isArray(updates.charts)) {
      return { candidate: null, ambiguous: false };
    }

    const incomingCharts = this.chartStructure(updates.charts);
    const byStructure = reports.filter(
      (report) =>
        report.query === updates.query && this.chartStructure(report.charts) === incomingCharts
    );
    if (byStructure.length === 1) {
      return { candidate: byStructure[0], ambiguous: false };
    }
    return { candidate: null, ambiguous: byStructure.length > 1 };
  }

  private rekeyLegacyReport(
    legacy: UnifiedReport,
    incomingId: string,
    incomingCharts: ChartConfiguration[] | undefined
  ): void {
    if (incomingCharts) {
      legacy.charts.forEach((chart, index) => {
        const incomingChart = incomingCharts[index];
        if (!incomingChart || incomingChart.id === chart.id) return;
        run(
          this.db,
          `UPDATE custom_dashboard_widgets SET ChartID = ? WHERE ReportID = ? AND ChartID = ?`,
          incomingChart.id,
          legacy.id,
          chart.id
        );
      });
    }

    run(
      this.db,
      `UPDATE custom_dashboard_widgets SET ReportID = ? WHERE ReportID = ?`,
      incomingId,
      legacy.id
    );
    run(this.db, `UPDATE saved_reports SET ID = ? WHERE ID = ?`, incomingId, legacy.id);
  }

  private chartStructure(charts: ChartConfiguration[]): string {
    return JSON.stringify(
      charts.map(({ id: _id, ...chart }) => ({
        chartType: chart.chartType,
        title: chart.title ?? null,
        xAxisColumn: chart.xAxisColumn,
        yAxisColumn: chart.yAxisColumn,
        groupByColumn: chart.groupByColumn ?? null,
        aggregateFunction: chart.aggregateFunction,
      }))
    );
  }

  private mapRowToReport(row: SavedReportRow): UnifiedReport {
    return {
      id: row.ID,
      name: row.Name,
      description: row.Description ?? undefined,
      query: row.Query,
      charts: row.Charts ? JSON.parse(row.Charts) : [],
      createdAt: row.CreatedAt,
      updatedAt: row.UpdatedAt,
      tags: row.Tags ? JSON.parse(row.Tags) : [],
      isFavorite: !!row.IsFavorite,
    };
  }
}
