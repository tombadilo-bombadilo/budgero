import { DatabaseAdapter } from '../../database/interface.js';
import { getRow, allRows, run } from '../../database/sql.js';

/**
 * ScenarioService — persistence for the analytics Scenario Planner.
 * Stores each scenario as an opaque JSON payload (the app owns the shape,
 * versioned inside the payload) keyed by budget + unique name.
 */

export interface ScenarioRecord {
  ID: string;
  BudgetID: number;
  Name: string;
  /** JSON document; parse/validate on the app side. */
  Payload: string;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface SaveScenarioInput {
  /** Update in place when set; otherwise create. */
  id?: string;
  budgetId: number;
  name: string;
  payload: string;
}

function createId(): string {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return `sc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function hasUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /unique/i.test(error.message);
}

export class ScenarioService {
  constructor(private db: DatabaseAdapter) {}

  listScenarios(budgetId: number): ScenarioRecord[] {
    return allRows<ScenarioRecord>(
      this.db,
      `SELECT ID, BudgetID, Name, Payload, CreatedAt, UpdatedAt
       FROM scenarios WHERE BudgetID = ? ORDER BY UpdatedAt DESC`,
      budgetId
    ).map((row: ScenarioRecord) => ({ ...row, BudgetID: Number(row.BudgetID) }));
  }

  getScenario(id: string): ScenarioRecord | null {
    const row = getRow<ScenarioRecord>(
      this.db,
      `SELECT ID, BudgetID, Name, Payload, CreatedAt, UpdatedAt FROM scenarios WHERE ID = ?`,
      id
    );
    return row ? { ...row, BudgetID: Number(row.BudgetID) } : null;
  }

  saveScenario(input: SaveScenarioInput): ScenarioRecord {
    const name = input.name.trim();
    if (!name) throw new Error('Scenario name cannot be empty');
    JSON.parse(input.payload); // reject malformed payloads early
    const now = new Date().toISOString();

    try {
      if (input.id) {
        run(
          this.db,
          `UPDATE scenarios SET Name = ?, Payload = ?, UpdatedAt = ? WHERE ID = ?`,
          name,
          input.payload,
          now,
          input.id
        );
        const updated = this.getScenario(input.id);
        if (!updated) throw new Error('Scenario not found after update');
        return updated;
      }
      const id = createId();
      run(
        this.db,
        `INSERT INTO scenarios (ID, BudgetID, Name, Payload, CreatedAt, UpdatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        input.budgetId,
        name,
        input.payload,
        now,
        now
      );
      const created = this.getScenario(id);
      if (!created) throw new Error('Scenario not found after create');
      return created;
    } catch (error) {
      if (hasUniqueConstraintError(error)) {
        throw new Error(`A scenario named "${name}" already exists for this budget.`);
      }
      throw error;
    }
  }

  deleteScenario(id: string): void {
    run(this.db, `DELETE FROM scenarios WHERE ID = ?`, id);
  }
}
