export class CurrencyParser {
  removeCurrencySymbols(input: string): string {
    const currencyPatterns = [
      'Дин\\.', // Serbian Dinar (Cyrillic)
      'Din\\.', // Serbian Dinar (Latin)
      'RSD', // Serbian Dinar code
      'USD', // US Dollar
      'EUR', // Euro
      'GBP', // British Pound
      '₹', // Indian Rupee
      '¥', // Japanese Yen / Chinese Yuan
      '₩', // Korean Won
      '₽', // Russian Ruble
      '\\$', // Dollar symbol
      '€', // Euro symbol
      '£', // Pound symbol
      '¢', // Cent symbol
      '₪', // Israeli Shekel
      '₴', // Ukrainian Hryvnia
      '₦', // Nigerian Naira
      '₨', // Rupee symbol
      '﷼', // Rial symbol
      '₡', // Costa Rican Colon
      '₵', // Ghanaian Cedi
      '₸', // Kazakhstani Tenge
      '₼', // Azerbaijani Manat
      '₻', // Nordic Mark
      '₺', // Turkish Lira
    ];

    let result = input;
    for (const pattern of currencyPatterns) {
      const re = new RegExp(pattern, 'g');
      result = result.replace(re, '');
    }

    return result.trim();
  }

  parseYNABAmountAdvanced(amountStr: string, numberFormat: string): number {
    if (!amountStr) {
      return 0.0;
    }

    let cleanAmount = this.removeCurrencySymbols(amountStr);
    cleanAmount = cleanAmount.trim();

    if (!cleanAmount) {
      return 0.0;
    }

    const isNegative = cleanAmount.startsWith('-');
    if (isNegative) {
      cleanAmount = cleanAmount.substring(1);
    }

    let value = -1;
    if (numberFormat) {
      value = this.parseWithFormat(cleanAmount, numberFormat);
    }

    // If format-specific parsing failed, auto-detect
    if (value === -1) {
      value = this.autoDetectAndParse(cleanAmount);
    }

    if (isNegative) {
      value = -value;
    }

    return value;
  }

  private parseWithFormat(cleanAmount: string, format: string): number {
    switch (format) {
      case '123,456.78':
      case '1,234.56':
        return this.parseUSFormat(cleanAmount);
      case '123.456,78':
      case '1.234,56':
        return this.parseEuropeanFormat(cleanAmount);
      case '123 456.78':
      case '1 234.56':
        return this.parseFrenchFormat(cleanAmount, '.');
      case '123 456,78':
      case '1 234,56':
        return this.parseFrenchFormat(cleanAmount, ',');
      case "123'456.78":
        return this.parseSwissFormat(cleanAmount);
      case '123,456/78':
        return this.parseFractionalFormat(cleanAmount);
      case '123 456-78':
        return this.parseDashDecimalFormat(cleanAmount);
      case '1,23,456.78':
        return this.parseIndianFormat(cleanAmount);
      default:
        return this.autoDetectAndParse(cleanAmount);
    }
  }

  private parseUSFormat(input: string): number {
    // Format: 1,234.56 (comma thousands, dot decimal)
    input = input.replace(/,/g, '');
    const value = parseFloat(input);
    return isNaN(value) ? -1 : value;
  }

  private parseEuropeanFormat(input: string): number {
    // Format: 1.234,56 (dot thousands, comma decimal)
    const parts = input.split(',');
    if (parts.length === 2) {
      // Has decimal part
      const wholePart = parts[0].replace(/\./g, '');
      const decimalPart = parts[1];
      if (decimalPart.length > 2) {
        return -1; // Invalid decimal part
      }
      const combined = `${wholePart}.${decimalPart}`;
      const value = parseFloat(combined);
      return isNaN(value) ? -1 : value;
    }
    // No decimal part, dots are thousands separators
    const cleaned = input.replace(/\./g, '');
    const value = parseFloat(cleaned);
    return isNaN(value) ? -1 : value;
  }

  private parseFrenchFormat(input: string, decimalSep: string): number {
    // Format: 1 234.56 or 1 234,56 (space thousands, dot/comma decimal)
    input = input.replace(/ /g, '');
    if (decimalSep === ',') {
      input = input.replace(/,/g, '.');
    }
    const value = parseFloat(input);
    return isNaN(value) ? -1 : value;
  }

  private parseSwissFormat(input: string): number {
    // Format: 1'234.56 (apostrophe thousands, dot decimal)
    input = input.replace(/'/g, '');
    const value = parseFloat(input);
    return isNaN(value) ? -1 : value;
  }

  private parseFractionalFormat(input: string): number {
    // Format: 1,234/56 (comma thousands, slash decimal)
    input = input.replace(/,/g, '');
    input = input.replace(/\//g, '.');
    const value = parseFloat(input);
    return isNaN(value) ? -1 : value;
  }

  private parseDashDecimalFormat(input: string): number {
    // Format: 1 234-56 (space thousands, dash decimal)
    input = input.replace(/ /g, '');
    input = input.replace(/-/g, '.');
    const value = parseFloat(input);
    return isNaN(value) ? -1 : value;
  }

  private parseIndianFormat(input: string): number {
    // Format: 1,23,456.78 (Indian number system)
    input = input.replace(/,/g, '');
    const value = parseFloat(input);
    return isNaN(value) ? -1 : value;
  }

  private autoDetectAndParse(input: string): number {
    const commaCount = (input.match(/,/g) || []).length;
    const dotCount = (input.match(/\./g) || []).length;
    const spaceCount = (input.match(/ /g) || []).length;

    // Strategy 1: Both comma and dot present
    if (commaCount > 0 && dotCount > 0) {
      const lastComma = input.lastIndexOf(',');
      const lastDot = input.lastIndexOf('.');

      if (lastDot > lastComma) {
        // Dot is decimal separator (e.g., 1,234.56)
        return this.parseUSFormat(input);
      }
      // Comma is decimal separator (e.g., 1.234,56)
      return this.parseEuropeanFormat(input);
    }

    // Strategy 2: Only comma present
    if (commaCount > 0 && dotCount === 0) {
      const parts = input.split(',');
      if (parts.length === 2 && parts[1].length <= 2 && parts[1].length > 0) {
        // Likely decimal separator (e.g., 123,45)
        return this.parseFrenchFormat(input, ',');
      }
      // Likely thousand separator (e.g., 1,234,567)
      return this.parseUSFormat(input);
    }

    // Strategy 3: Only dot present
    if (dotCount > 0 && commaCount === 0) {
      const parts = input.split('.');
      if (parts.length === 2 && parts[1].length <= 2 && parts[1].length > 0) {
        // Likely decimal separator (e.g., 123.45)
        return this.parseUSFormat(input);
      }
      // Likely thousand separator (e.g., 1.234.567)
      return this.parseEuropeanFormat(input);
    }

    // Strategy 4: Only spaces present
    if (spaceCount > 0) {
      return this.parseFrenchFormat(input, '.');
    }

    // Strategy 5: No separators, just parse as is
    const value = parseFloat(input);
    return isNaN(value) ? 0.0 : value;
  }
}
