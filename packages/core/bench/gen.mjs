/* global process */
// Deterministic large-budget generator.
//
// Schema comes from the real migrations; budget, categories, accounts (incl. the
// CC payment / liability categories they create), labels, recurring templates,
// rules and goals go through the real services. The ledger itself is bulk
// inserted with SQL in the row shapes the services produce (transfer legs share a
// TransferID and use the Transfers category; loan payments use the liability's
// linked category; split parents carry their first line's category), then running
// and account balances are rebuilt with the core's own recalculateBalancesForAccounts.
//
//   node bench/gen.mjs --core <packages/core | bundle.cjs> --tx 50000 --years 10 \
//        --seed 42 --end 2026-10-15 --mode cumulative --out /tmp/b50k.sqlite
//
// Same seed + same --end + same core schema => byte-identical ledger.
import fs from 'node:fs';
import { parseArgs, mulberry32, fixClock, quiet, loadCore, openDb, out } from './lib.mjs';

export async function generate(opts) {
  const o = { tx: 50000, years: 10, seed: 42, end: '2026-10-15', mode: 'cumulative', ...opts };
  const N = Number(o.tx),
    YEARS = Number(o.years),
    SEED = Number(o.seed);
  const { core } = await loadCore(o.core);
  const rnd = mulberry32(SEED);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const logn = (median, spread) =>
    Math.exp(Math.log(median) + spread * (rnd() + rnd() + rnd() - 1.5));
  const money = (units) => Math.max(10, Math.round(units * 100) * 10); // milliunits, whole cents

  const { adapter: db, services: s } = await openDb(core);
  const one = (sql, ...p) => db.prepare(sql).get(...p);

  // ---- calendar (pure string math, no timezone dependence) ----
  const [ey, em, ed] = o.end.split('-').map(Number);
  const months = [];
  for (
    let y = ey - YEARS, m = em;
    y < ey || (y === ey && m <= em);
    m === 12 ? ((m = 1), y++) : m++
  ) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  const START = `${months[0]}-01`;
  const lastDay = (mo) => new Date(Date.UTC(+mo.slice(0, 4), +mo.slice(5, 7), 0)).getUTCDate();
  const dateIn = (mo, day) =>
    `${mo}-${String(Math.min(Math.max(1, day), lastDay(mo))).padStart(2, '0')}`;
  const addDays = (day, n) => {
    const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + n));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  };
  const clearedBefore = addDays(o.end, -7);
  const reconciledBefore = addDays(o.end, -60);

  // ---- budget + 150 spending categories ----
  const budgetId = await s.budgets.createBudget({
    name: 'Perf',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: true,
  });
  const sysCat = (name) =>
    one(
      'SELECT c.ID FROM categories c JOIN category_groups g ON g.ID=c.CategoryGroupID WHERE g.Name=? AND c.BudgetID=?',
      name,
      budgetId
    ).ID;
  const INCOME = sysCat('Income'),
    UNCAT = sysCat('Uncategorized'),
    TRANSFERS = sysCat('Transfers');
  const incomeGroup = one(
    "SELECT ID FROM category_groups WHERE Name='Income' AND BudgetID=?",
    budgetId
  ).ID;
  const bonusCat = s.categories.addCategory(incomeGroup, budgetId, 'Bonus');
  const spendCats = s.categories
    .getAllCategories(budgetId)
    .map((c) => c.ID)
    .filter((id) => ![INCOME, UNCAT, TRANSFERS, bonusCat].includes(id));
  const groupNames = [
    'Housing',
    'Utilities',
    'Food',
    'Transport',
    'Health',
    'Kids',
    'Pets',
    'Personal',
    'Fun',
    'Travel',
    'Giving',
    'Subscriptions',
    'Home',
    'Education',
    'Saving',
  ];
  const groups = groupNames.map((n) => s.categories.addCategoryGroup(n, budgetId));
  for (let gi = 0; spendCats.length < 150; gi++) {
    spendCats.push(
      s.categories.addCategory(
        groups[gi % groups.length],
        budgetId,
        `${groupNames[gi % groups.length]} ${spendCats.length}`
      )
    );
  }
  const catWeight = spendCats.map((_, i) => 1 / (i + 1) ** 0.9);
  const catMedian = spendCats.map(() => logn(35, 1.2));
  const wsum = catWeight.reduce((a, b) => a + b, 0);
  const pickCat = () => {
    let r = rnd() * wsum;
    for (let i = 0; i < catWeight.length; i++) {
      r -= catWeight[i];
      if (r <= 0) return i;
    }
    return 0;
  };

  // ---- 30 accounts: 9 checking (2 FX), 5 savings (2 off-budget), 2 cash, 7 cards (1 FX), 3 loans, 4 investments ----
  const acc = {};
  const mk = async (key, name, type, cur, bal, meta, onBudget) => {
    const a = await s.accounts.createAccount(
      name,
      budgetId,
      type,
      cur,
      bal,
      meta,
      onBudget,
      'Initial Balance',
      START
    );
    acc[key] = { ID: a.ID, cur, type, meta: {} };
  };
  for (let i = 0; i < 7; i++)
    await mk(`chk${i}`, `Checking ${i}`, 'checking', 'USD', money(between(500, 4000)));
  await mk('chkEUR', 'Checking EUR', 'checking', 'EUR', money(2000));
  await mk('chkGBP', 'Checking GBP', 'checking', 'GBP', money(1500));
  for (let i = 0; i < 3; i++)
    await mk(
      `sav${i}`,
      `Savings ${i}`,
      'savings',
      'USD',
      money(between(1000, 8000)),
      undefined,
      true
    );
  for (let i = 0; i < 2; i++)
    await mk(
      `savOff${i}`,
      `Tracking Savings ${i}`,
      'savings',
      'USD',
      money(5000),
      undefined,
      false
    );
  for (let i = 0; i < 2; i++) await mk(`cash${i}`, `Cash ${i}`, 'cash', 'USD', money(200));
  for (let i = 0; i < 6; i++)
    await mk(`cc${i}`, `Card ${i}`, 'credit', 'USD', -money(between(0, 800)));
  await mk('ccEUR', 'Card EUR', 'credit', 'EUR', -money(300));
  await mk('loan0', 'Car Loan', 'loan', 'USD', -money(25000), {
    apr: 6.5,
    min_payment: money(450),
  });
  await mk('loan1', 'Student Loan', 'loan', 'USD', -money(40000), {
    apr: 4.2,
    min_payment: money(380),
  });
  await mk('mort', 'Mortgage', 'mortgage', 'USD', -money(320000), {
    apr: 3.1,
    min_payment: money(1600),
  });
  for (let i = 0; i < 4; i++)
    await mk(
      `inv${i}`,
      `Brokerage ${i}`,
      'investment',
      'USD',
      money(between(5000, 60000)),
      undefined,
      false
    );
  const A = Object.values(acc);
  for (const a of A)
    a.meta = JSON.parse(one('SELECT Metadata FROM accounts WHERE ID=?', a.ID).Metadata || '{}');
  const cards = A.filter((a) => a.type === 'credit');

  // ---- FX: monthly rates; ledger amounts converted at the month's rate ----
  const rate = {};
  let eur = 1.08,
    gbp = 1.27;
  const insRate = db.prepare(
    'INSERT OR IGNORE INTO currency_rates(FromCurrency,ToCurrency,Rate,RateDate,LastUpdated,BudgetID) VALUES(?,?,?,?,?,?)'
  );
  for (const m of months) {
    eur *= 1 + (rnd() - 0.5) * 0.03;
    gbp *= 1 + (rnd() - 0.5) * 0.03;
    rate[m] = { USD: 1, EUR: +eur.toFixed(4), GBP: +gbp.toFixed(4) };
    insRate.run('EUR', 'USD', rate[m].EUR, `${m}-01`, `${m}-01 00:00:00`, budgetId);
    insRate.run('GBP', 'USD', rate[m].GBP, `${m}-01`, `${m}-01 00:00:00`, budgetId);
  }

  // ---- ledger ----
  const labelIds = Array.from({ length: 10 }, (_, i) =>
    s.labels.addLabel(budgetId, `Label ${i}`, '#888888')
  );
  const payees = Array.from({ length: 400 }, (_, i) => `Payee ${i}`);
  const rows = [];
  const push = (cat, a, tid, date, memo, inN, outN, payee = '', label = null) => {
    const r = { cat, a, tid, date, memo, inN, outN, payee, label, splits: null };
    rows.push(r);
    return r;
  };
  let tseq = 0;
  const transfer = (from, to, date, amt, fromCat = TRANSFERS, memo = 'Transfer') => {
    const tid = `bench_${SEED}_${++tseq}`;
    push(fromCat, from, tid, date, memo, 0, amt);
    push(TRANSFERS, to, tid, date, memo, amt, 0);
  };
  const rowsPerMonth = N / months.length;
  // ~15% of rows are transfer legs. Small budgets get fewer cards / fixed transfers
  // so the share stays realistic; recurring transfers are planned first, then random ones.
  const transferEvents = Math.max(1, Math.round((0.15 * rowsPerMonth) / 2));
  const cardsUsed = cards.slice(
    0,
    Math.min(cards.length, Math.max(1, Math.floor(transferEvents / 2)))
  );
  const spendAccts = [
    ...Array(55).fill(acc.chk0),
    ...Array(6).fill(acc.chk1),
    ...Array(4).fill(acc.chk2),
    ...cardsUsed.flatMap((c) => Array(c.cur === 'EUR' ? 2 : 5).fill(c)),
    acc.cash0,
    acc.cash1,
    acc.chkEUR,
    acc.chkGBP,
    acc.chk3,
  ];
  const catMonthSpend = new Map();
  const addSpend = (m, ci, v) =>
    catMonthSpend.set(`${m}|${ci}`, (catMonthSpend.get(`${m}|${ci}`) || 0) + v);
  for (const m of months) {
    const isLast = m === months[months.length - 1];
    const maxDay = isLast ? ed : lastDay(m);
    const day = (d) => dateIn(m, Math.min(d, maxDay));
    const spendRows = Math.max(5, Math.round(rowsPerMonth - 2 * transferEvents - 8));
    const cardSpend = new Map();
    let cashOut = 0;
    for (let i = 0; i < spendRows; i++) {
      const ci = pickCat();
      const a = pick(spendAccts);
      const date = day(between(1, maxDay));
      const fx = rate[m][a.cur];
      const amt = money(logn(catMedian[ci], 0.7) / fx);
      const refund = rnd() < 0.03;
      const label = rnd() < 0.05 ? pick(labelIds) : null;
      const uncategorized = rnd() < 0.004 && months.indexOf(m) > months.length - 4;
      if (!refund && rnd() < 0.03) {
        const n = between(2, 4);
        const parts = [];
        let rest = amt;
        for (let k = 0; k < n; k++) {
          const p = k === n - 1 ? rest : Math.round((rest * (0.3 + rnd() * 0.4)) / 10) * 10;
          rest -= p;
          parts.push([pickCat(), p]);
        }
        const r = push(
          spendCats[parts[0][0]],
          a,
          null,
          date,
          'Split purchase',
          0,
          amt,
          pick(payees),
          label
        );
        r.splits = parts.map(([c, p], k) => ({ cat: spendCats[c], inN: 0, outN: p, order: k }));
        for (const [c, p] of parts) addSpend(m, c, p * fx);
      } else {
        push(
          uncategorized ? UNCAT : spendCats[ci],
          a,
          null,
          date,
          refund ? 'Refund' : '',
          refund ? amt : 0,
          refund ? 0 : amt,
          pick(payees),
          label
        );
        addSpend(m, ci, (refund ? -amt : amt) * fx);
      }
      if (a.type === 'credit') cardSpend.set(a, (cardSpend.get(a) || 0) + (refund ? -amt : amt));
      else if (!refund) cashOut += amt * fx;
    }
    if (isLast) {
      for (let i = 0; i < 25; i++) {
        const ci = pickCat();
        push(
          spendCats[ci],
          acc.chk0,
          null,
          addDays(o.end, between(1, 30)),
          'Scheduled',
          0,
          money(catMedian[ci]),
          pick(payees)
        );
      }
    }
    /* eslint-disable no-loop-func -- planned transfers update this month's cashOut */
    const planned = [];
    for (const c of cardsUsed) {
      const amt = Math.max(0, Math.round((cardSpend.get(c) || 0) / 10) * 10);
      if (amt)
        planned.push(() => {
          const src = c.cur === 'EUR' ? acc.chkEUR : acc.chk0;
          transfer(src, c, day(25), amt);
          if (src === acc.chk0) cashOut += amt;
        });
    }
    for (const k of ['mort', 'loan0', 'loan1']) {
      const l = acc[k];
      planned.push(() => {
        transfer(
          acc.chk0,
          l,
          day(3),
          l.meta.min_payment,
          l.meta.linked_category_id || TRANSFERS,
          'Payment'
        );
        cashOut += l.meta.min_payment;
      });
    }
    planned.push(() => {
      transfer(acc.chk0, acc.sav0, day(2), money(300));
      cashOut += money(300);
    });
    planned.push(() => {
      transfer(acc.chk0, acc.savOff0, day(2), money(200));
      cashOut += money(200);
    });
    planned.push(() => {
      transfer(acc.chk0, acc.inv0, day(5), money(500));
      cashOut += money(500);
    });
    planned.push(() => transfer(acc.inv1, acc.chk1, day(6), money(100)));
    planned.slice(0, transferEvents).forEach((f) => f());
    /* eslint-enable no-loop-func */
    const fromPool = [acc.chk0, acc.chk1, acc.chk2, acc.chk3, acc.sav1, acc.sav2, acc.cash0];
    const toPool = [
      acc.chk1,
      acc.chk2,
      acc.sav1,
      acc.sav2,
      acc.cash0,
      acc.cash1,
      acc.chk4,
      acc.chk5,
      acc.chk6,
      acc.savOff1,
    ];
    for (let i = planned.length; i < transferEvents; i++) {
      const from = pick(fromPool);
      let to = pick(toPool);
      if (to === from) to = acc.chk6;
      transfer(from, to, day(between(1, maxDay)), money(logn(150, 0.8)));
    }
    const pay = Math.round((cashOut * 1.06) / 2 / 10) * 10;
    push(INCOME, acc.chk0, null, day(1), 'Salary', pay, 0, 'Employer');
    push(INCOME, acc.chk0, null, day(15), 'Salary', pay, 0, 'Employer');
    push(INCOME, acc.chkEUR, null, day(10), 'Salary EUR', money(900), 0, 'EU Employer');
    if (rnd() < 0.15) push(bonusCat, acc.chk1, null, day(20), 'Bonus', money(800), 0, 'Employer');
    for (const k of ['inv0', 'inv1', 'inv2', 'inv3']) {
      const up = rnd() < 0.6;
      push(
        TRANSFERS,
        acc[k],
        null,
        day(28),
        'Market',
        up ? money(between(50, 900)) : 0,
        up ? 0 : money(between(50, 600))
      );
    }
  }
  // chronological insert order (stable for equal dates) like a long-lived budget
  rows.forEach((r, i) => (r.seq = i));
  rows.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.seq - y.seq));

  const ins =
    db.prepare(`INSERT INTO transactions (CategoryID, AccountID, TransferID, Date, Memo, Reconciled, InflowConverted, OutflowConverted,
    InflowNative, OutflowNative, BudgetID, Payee, ExchangeRate, LabelID, Cleared, ExcludeFromReadyToAssign) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`);
  const insSplit =
    db.prepare(`INSERT INTO transaction_splits (TransactionID, CategoryID, Memo, InflowConverted, OutflowConverted, InflowNative, OutflowNative, OrderIndex)
    VALUES (?,?,?,?,?,?,?,?)`);
  const fxOf = (r) =>
    rate[r.date.slice(0, 7)]?.[r.a.cur] ?? rate[months[months.length - 1]][r.a.cur];
  db.exec('BEGIN');
  for (const r of rows) {
    const fx = fxOf(r);
    const res = ins.run(
      r.cat,
      r.a.ID,
      r.tid,
      r.date,
      r.memo,
      r.date < reconciledBefore ? 1 : 0,
      Math.round(r.inN * fx),
      Math.round(r.outN * fx),
      r.inN,
      r.outN,
      budgetId,
      r.payee,
      r.a.cur === 'USD' ? null : fx,
      r.label,
      r.date < clearedBefore ? 1 : 0
    );
    if (r.splits)
      for (const sp of r.splits)
        insSplit.run(
          Number(res.lastInsertRowid),
          sp.cat,
          `part ${sp.order}`,
          Math.round(sp.inN * fx),
          Math.round(sp.outN * fx),
          sp.inN,
          sp.outN,
          sp.order
        );
  }
  db.exec('COMMIT');

  // assignments: roughly cover each month's spending (some months under/over)
  db.exec('BEGIN');
  const insA = db.prepare(
    'INSERT INTO assignments (CategoryID, Amount, Month, BudgetID) VALUES (?,?,?,?)'
  );
  for (const m of months) {
    for (let ci = 0; ci < spendCats.length; ci++) {
      const spent = catMonthSpend.get(`${m}|${ci}`) || 0;
      if (spent <= 0 && rnd() < 0.7) continue;
      const amt = Math.round((spent * (0.85 + rnd() * 0.3)) / 1000) * 1000;
      if (amt > 0) insA.run(spendCats[ci], amt, m, budgetId);
    }
    for (const c of cards)
      if (rnd() < 0.1)
        insA.run(c.meta.cc_payment_category_id, money(between(20, 200)), m, budgetId);
    for (const k of ['loan0', 'loan1', 'mort'])
      insA.run(acc[k].meta.linked_category_id, acc[k].meta.min_payment, m, budgetId);
  }
  db.exec('COMMIT');

  // month-start revaluations on the on-budget FX accounts
  db.exec('BEGIN');
  const insR = db.prepare(
    'INSERT OR IGNORE INTO account_revaluations (BudgetID, AccountID, Date, OldRate, NewRate, BalanceNative, DeltaConverted) VALUES (?,?,?,?,?,?,?)'
  );
  for (let i = 1; i < months.length; i++) {
    for (const a of [acc.chkEUR, acc.chkGBP, acc.ccEUR]) {
      const prev = rate[months[i - 1]][a.cur],
        next = rate[months[i]][a.cur];
      insR.run(
        budgetId,
        a.ID,
        `${months[i]}-01`,
        prev,
        next,
        money(1000),
        Math.round(money(1000) * (next - prev))
      );
    }
  }
  db.exec('COMMIT');

  new core.TransactionQueries(db).recalculateBalancesForAccounts(A.map((a) => a.ID));

  // recurring (20), rules (10, 3 continuous), goals (15), local audit log (5000)
  for (let i = 0; i < 20; i++) {
    const tr = i % 5 === 0;
    await s.recurring.createRecurringTransaction({
      budgetId,
      accountId: acc.chk0.ID,
      toAccountId: tr ? acc.sav0.ID : null,
      categoryId: tr ? null : spendCats[i],
      name: `Bill ${i}`,
      amount: money(between(10, 300)),
      direction: 'outflow',
      schedule: {
        startDate: `${months[Math.max(0, months.length - 24)]}-${String(1 + (i % 27)).padStart(2, '0')}`,
        intervalUnit: 'month',
      },
    });
  }
  s.recurring.ensureOccurrencesThrough(budgetId, addDays(o.end, 30));
  const ruleDefs = [
    [
      'continuous',
      [{ field: 'payee', operator: 'contains', value: 'Payee 1' }],
      [{ type: 'category.set', payload: { categoryId: spendCats[3] } }],
    ],
    [
      'continuous',
      [{ field: 'memo', operator: 'contains', value: 'AMZN' }],
      [{ type: 'category.set', payload: { categoryId: spendCats[5] } }],
    ],
    [
      'continuous',
      [{ field: 'payee', operator: 'regex', value: '^Payee 3\\d$' }],
      [{ type: 'memo.set', payload: { value: 'auto' } }],
    ],
  ];
  for (let i = 0; i < 7; i++)
    ruleDefs.push([
      i < 5 ? 'autofill' : 'one_time',
      [{ field: 'payee', operator: 'equals', value: `Payee ${200 + i}` }],
      [{ type: 'category.set', payload: { categoryId: spendCats[10 + i] } }],
    ]);
  ruleDefs.forEach(([mode, conditions, actions], i) =>
    s.rules.createRule({
      budgetId,
      name: `Rule ${i}`,
      conditions,
      actions,
      mode,
      enabled: true,
      runOrder: i,
    })
  );
  for (let i = 0; i < 15; i++) {
    const t = ['yearly', 'target-date', 'monthly'][i % 3];
    try {
      s.goals.createGoal(
        t,
        spendCats[20 + i],
        money(between(200, 3000)),
        START,
        `${ey}-12-31`,
        'spending',
        t === 'yearly',
        null
      );
    } catch {
      /* invalid combo for this core version */
    }
  }
  db.exec('BEGIN');
  const insH = db.prepare(
    "INSERT INTO mutation_history (BudgetID, MutationID, Timestamp, Op, Payload, Origin, UndoOps, SpaceID) VALUES (?,?,?,?,?,'local',?,'space')"
  );
  for (let i = 0; i < 5000; i++) {
    insH.run(
      budgetId,
      `bench_${SEED}_${i}`,
      `${months[months.length - 1 - (i % 12)]}-01 10:00:00`,
      'transactions.updateColumn',
      JSON.stringify({
        id: between(1, rows.length),
        columnName: 'Memo',
        newValue: 'x'.repeat(between(5, 60)),
        budgetId,
      }),
      JSON.stringify([
        { op: 'transactions.updateColumn', args: { id: 1, columnName: 'Memo', newValue: 'old' } },
      ])
    );
  }
  db.exec('COMMIT');
  db.exec(
    `UPDATE budgets SET RtaMode='${o.mode === 'monthly' ? 'monthly' : 'cumulative'}' WHERE ID=${budgetId}`
  );

  const bytes = db.backup();
  const n = (sql) => one(sql).n;
  const info = {
    bytes: bytes.length,
    budgetId,
    months: months.length,
    transactions: n('SELECT COUNT(*) n FROM transactions'),
    transferRows: n(
      "SELECT COUNT(*) n FROM transactions WHERE TransferID IS NOT NULL AND TransferID != ''"
    ),
    splitLines: n('SELECT COUNT(*) n FROM transaction_splits'),
    accounts: n('SELECT COUNT(*) n FROM accounts'),
    categories: n('SELECT COUNT(*) n FROM categories'),
    assignments: n('SELECT COUNT(*) n FROM assignments'),
    revaluations: n('SELECT COUNT(*) n FROM account_revaluations'),
    recurring: n('SELECT COUNT(*) n FROM recurring_transactions'),
    rules: n('SELECT COUNT(*) n FROM transaction_rules'),
    goals: n('SELECT COUNT(*) n FROM goals'),
    accountIds: Object.fromEntries(Object.entries(acc).map(([k, a]) => [k, a.ID])),
    spendCats,
    cards: cards.map((c) => c.ID),
    seed: SEED,
    end: o.end,
    years: YEARS,
    requested: N,
  };
  db.close();
  return { bytes, info };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2), {
    tx: '50000',
    years: '10',
    seed: '42',
    end: '2026-10-15',
    mode: 'cumulative',
  });
  if (!args.core || !args.out)
    throw new Error(
      'usage: gen.mjs --core <packages/core> --out <file> [--tx N --years Y --seed S --end YYYY-MM-DD --mode cumulative|monthly]'
    );
  fixClock(args.end);
  quiet();
  const { bytes, info } = await generate(args);
  fs.writeFileSync(args.out, bytes);
  fs.writeFileSync(`${args.out}.json`, JSON.stringify(info, null, 1));
  const { accountIds: _a, spendCats: _s, cards: _c, ...summary } = info;
  out(JSON.stringify(summary));
}
