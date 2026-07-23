import { migration001 } from './001-initial-schema.js';
import { migration002 } from './002-add-exclude-from-budget-pace-to-categories.js';
import { migration003 } from './003-add-metadata-column-to-accounts-for-liability-tr.js';
import { migration004 } from './004-add-on-budget-column-to-accounts-for-budget-vs-t.js';
import { migration005 } from './005-add-saved-reports-table-with-unified-chart-confi.js';
import { migration006 } from './006-add-charts-column-to-saved-reports-for-unified-c.js';
import { migration007 } from './007-cleanup-old-chart-configurations-table-if-exists.js';
import { migration008 } from './008-add-transaction-splits-table-to-support-split-tr.js';
import { migration009 } from './009-add-purpose-column-to-goals-table-for-savings-go.js';
import { migration010 } from './010-add-manual-currency-rates-table-for-offline-manu.js';
import { migration011 } from './011-add-transaction-rules-tables-for-automation-engi.js';
import { migration012 } from './012-add-recurring-transactions-tables-for-scheduled.js';
import { migration013 } from './013-backfill-budget-spaces-and-memberships-for-legac.js';
import { migration014 } from './014-add-payee-column-to-transactions-table.js';
import { migration015 } from './015-create-import-runs-table-for-import-history-trac.js';
import { migration016 } from './016-add-payees-table-for-saved-managed-payees.js';
import { migration017 } from './017-backfill-payees-table-from-existing-transactions.js';
import { migration018 } from './018-add-mutation-history-table-for-tracking-all-muta.js';
import { migration019 } from './019-add-status-errormessage-errorcode-columns-to-mut.js';
import { migration020 } from './020-add-spaceid-column-to-mutation-history-for-space.js';
import { migration021 } from './021-add-llm-settings-table-for-local-ai-configuratio.js';
import { migration022 } from './022-add-chat-tables-for-ai-assistant-conversations.js';
import { migration023 } from './023-add-apikey-column-to-llm-settings-for-cloud-prov.js';
import { migration024 } from './024-add-speechmodel-column-to-chat-settings-for-whis.js';
import { migration025 } from './025-add-contextlength-column-to-llm-settings-for-con.js';
import { migration026 } from './026-add-position-column-to-category-groups-and-categ.js';
import { migration027 } from './027-add-allowoverassignment-flag-to-user-meta-for-fl.js';
import { migration028 } from './028-add-exchange-rate-tracking-to-transactions-and-c.js';
import { migration029 } from './029-add-labels-table-and-transaction-label-support.js';
import { migration030 } from './030-add-custom-dashboards-and-widgets-tables.js';
import { migration031 } from './031-add-warranties-table-for-product-warranty-tracki.js';
import { migration032 } from './032-add-amount-column-to-warranties-table.js';
import { migration033 } from './033-add-archived-column-to-accounts-table.js';
import { migration034 } from './034-add-recurring-column-to-goals-table.js';
import { migration035 } from './035-add-conversionpending-flag-to-transactions.js';
import { migration036 } from './036-add-position-column-to-accounts-for-custom-orde.js';
import { migration037 } from './037-add-enabledtools-column-to-chat-settings-for-too.js';
import { migration038 } from './038-add-transactions-budget-account-date-index.js';
import { migration039 } from './039-convert-money-columns-to-integer-milliunits.js';
import { migration040 } from './040-add-toaccountid-to-recurring-transactions.js';
import { migration041 } from './041-add-scenarios-table.js';

import type { Migration } from '../migrations.js';

/** All migrations, ordered by version. Add new ones as ./NNN-slug.ts files. */
export const migrations: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
  migration010,
  migration011,
  migration012,
  migration013,
  migration014,
  migration015,
  migration016,
  migration017,
  migration018,
  migration019,
  migration020,
  migration021,
  migration022,
  migration023,
  migration024,
  migration025,
  migration026,
  migration027,
  migration028,
  migration029,
  migration030,
  migration031,
  migration032,
  migration033,
  migration034,
  migration035,
  migration036,
  migration037,
  migration038,
  migration039,
  migration040,
  migration041,
];
