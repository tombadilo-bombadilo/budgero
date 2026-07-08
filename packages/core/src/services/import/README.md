# YNAB Import Service

This service allows importing YNAB (You Need A Budget) data from exported CSV files.

## Usage

```typescript
import { YNABImportService, YNABImportConfig } from '@budgero/core';

// Initialize the service with your database adapter
const importService = new YNABImportService(db);

// Configure the import
const config: YNABImportConfig = {
  budgetName: 'My Imported Budget',
  currency: 'USD',
  numberFormat: '123,456.78', // US format
  badgeIcon: '💰'
};

// Import from a ZIP file containing YNAB CSV exports
const zipFile = await fetch('/path/to/ynab-export.zip');
const zipData = await zipFile.arrayBuffer();

try {
  const budgetId = await importService.importYNABFromZip(zipData, config);
  console.log(`Successfully imported budget with ID: ${budgetId}`);
} catch (error) {
  console.error('Import failed:', error);
}
```

## Supported Number Formats

The service supports various international number formats:
- US/UK: `1,234.56`
- European: `1.234,56`
- French: `1 234.56` or `1 234,56`
- Swiss: `1'234.56`
- Indian: `1,23,456.78`

## Expected CSV Files

The ZIP file should contain:
1. A register CSV file (containing transactions)
2. A budget/plan CSV file (containing budget assignments)

The service will automatically detect and parse both files.