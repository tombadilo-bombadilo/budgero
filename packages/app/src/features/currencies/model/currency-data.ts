export type CurrencyOption = {
  value: string;
  label: string;
  countryCode: string;
  region: string;
};

// All currencies supported by CurrencyLayer API
// Organized by region for better user experience
export const currencies: CurrencyOption[] = [
  // Americas - North
  {
    value: 'USD',
    label: 'United States Dollar (USD)',
    countryCode: 'US',
    region: 'Americas - North',
  },
  { value: 'CAD', label: 'Canadian Dollar (CAD)', countryCode: 'CA', region: 'Americas - North' },
  { value: 'MXN', label: 'Mexican Peso (MXN)', countryCode: 'MX', region: 'Americas - North' },

  // Americas - Central & Caribbean
  {
    value: 'GTQ',
    label: 'Guatemalan Quetzal (GTQ)',
    countryCode: 'GT',
    region: 'Americas - Central & Caribbean',
  },
  {
    value: 'HNL',
    label: 'Honduran Lempira (HNL)',
    countryCode: 'HN',
    region: 'Americas - Central & Caribbean',
  },
  {
    value: 'NIO',
    label: 'Nicaraguan Córdoba (NIO)',
    countryCode: 'NI',
    region: 'Americas - Central & Caribbean',
  },
  {
    value: 'CRC',
    label: 'Costa Rican Colón (CRC)',
    countryCode: 'CR',
    region: 'Americas - Central & Caribbean',
  },
  {
    value: 'PAB',
    label: 'Panamanian Balboa (PAB)',
    countryCode: 'PA',
    region: 'Americas - Central & Caribbean',
  },
  {
    value: 'CUP',
    label: 'Cuban Peso (CUP)',
    countryCode: 'CU',
    region: 'Americas - Central & Caribbean',
  },
  {
    value: 'DOP',
    label: 'Dominican Peso (DOP)',
    countryCode: 'DO',
    region: 'Americas - Central & Caribbean',
  },
  {
    value: 'JMD',
    label: 'Jamaican Dollar (JMD)',
    countryCode: 'JM',
    region: 'Americas - Central & Caribbean',
  },
  {
    value: 'TTD',
    label: 'Trinidad & Tobago Dollar (TTD)',
    countryCode: 'TT',
    region: 'Americas - Central & Caribbean',
  },
  {
    value: 'BBD',
    label: 'Barbadian Dollar (BBD)',
    countryCode: 'BB',
    region: 'Americas - Central & Caribbean',
  },
  {
    value: 'BSD',
    label: 'Bahamian Dollar (BSD)',
    countryCode: 'BS',
    region: 'Americas - Central & Caribbean',
  },
  {
    value: 'BZD',
    label: 'Belize Dollar (BZD)',
    countryCode: 'BZ',
    region: 'Americas - Central & Caribbean',
  },

  // Americas - South
  { value: 'BRL', label: 'Brazilian Real (BRL)', countryCode: 'BR', region: 'Americas - South' },
  { value: 'ARS', label: 'Argentine Peso (ARS)', countryCode: 'AR', region: 'Americas - South' },
  { value: 'CLP', label: 'Chilean Peso (CLP)', countryCode: 'CL', region: 'Americas - South' },
  { value: 'COP', label: 'Colombian Peso (COP)', countryCode: 'CO', region: 'Americas - South' },
  { value: 'PEN', label: 'Peruvian Sol (PEN)', countryCode: 'PE', region: 'Americas - South' },
  { value: 'UYU', label: 'Uruguayan Peso (UYU)', countryCode: 'UY', region: 'Americas - South' },
  {
    value: 'VES',
    label: 'Venezuelan Bolívar (VES)',
    countryCode: 'VE',
    region: 'Americas - South',
  },
  {
    value: 'BOB',
    label: 'Bolivian Boliviano (BOB)',
    countryCode: 'BO',
    region: 'Americas - South',
  },
  {
    value: 'PYG',
    label: 'Paraguayan Guarani (PYG)',
    countryCode: 'PY',
    region: 'Americas - South',
  },

  // Europe - EU & Major
  { value: 'EUR', label: 'Euro (EUR)', countryCode: 'EU', region: 'Europe - EU & Major' },
  {
    value: 'GBP',
    label: 'British Pound Sterling (GBP)',
    countryCode: 'GB',
    region: 'Europe - EU & Major',
  },
  { value: 'CHF', label: 'Swiss Franc (CHF)', countryCode: 'CH', region: 'Europe - EU & Major' },

  // Europe - Nordic
  { value: 'SEK', label: 'Swedish Krona (SEK)', countryCode: 'SE', region: 'Europe - Nordic' },
  { value: 'NOK', label: 'Norwegian Krone (NOK)', countryCode: 'NO', region: 'Europe - Nordic' },
  { value: 'DKK', label: 'Danish Krone (DKK)', countryCode: 'DK', region: 'Europe - Nordic' },
  { value: 'ISK', label: 'Icelandic Króna (ISK)', countryCode: 'IS', region: 'Europe - Nordic' },

  // Europe - Eastern
  { value: 'PLN', label: 'Polish Złoty (PLN)', countryCode: 'PL', region: 'Europe - Eastern' },
  { value: 'CZK', label: 'Czech Koruna (CZK)', countryCode: 'CZ', region: 'Europe - Eastern' },
  { value: 'HUF', label: 'Hungarian Forint (HUF)', countryCode: 'HU', region: 'Europe - Eastern' },
  { value: 'RON', label: 'Romanian Leu (RON)', countryCode: 'RO', region: 'Europe - Eastern' },
  { value: 'BGN', label: 'Bulgarian Lev (BGN)', countryCode: 'BG', region: 'Europe - Eastern' },
  { value: 'UAH', label: 'Ukrainian Hryvnia (UAH)', countryCode: 'UA', region: 'Europe - Eastern' },
  { value: 'RUB', label: 'Russian Ruble (RUB)', countryCode: 'RU', region: 'Europe - Eastern' },
  { value: 'MDL', label: 'Moldovan Leu (MDL)', countryCode: 'MD', region: 'Europe - Eastern' },

  // Europe - Balkans & Caucasus
  {
    value: 'HRK',
    label: 'Croatian Kuna (HRK)',
    countryCode: 'HR',
    region: 'Europe - Balkans & Caucasus',
  },
  {
    value: 'RSD',
    label: 'Serbian Dinar (RSD)',
    countryCode: 'RS',
    region: 'Europe - Balkans & Caucasus',
  },
  {
    value: 'MKD',
    label: 'Macedonian Denar (MKD)',
    countryCode: 'MK',
    region: 'Europe - Balkans & Caucasus',
  },
  {
    value: 'ALL',
    label: 'Albanian Lek (ALL)',
    countryCode: 'AL',
    region: 'Europe - Balkans & Caucasus',
  },
  {
    value: 'BAM',
    label: 'Bosnia-Herzegovina Mark (BAM)',
    countryCode: 'BA',
    region: 'Europe - Balkans & Caucasus',
  },
  {
    value: 'GEL',
    label: 'Georgian Lari (GEL)',
    countryCode: 'GE',
    region: 'Europe - Balkans & Caucasus',
  },
  {
    value: 'AMD',
    label: 'Armenian Dram (AMD)',
    countryCode: 'AM',
    region: 'Europe - Balkans & Caucasus',
  },
  {
    value: 'AZN',
    label: 'Azerbaijani Manat (AZN)',
    countryCode: 'AZ',
    region: 'Europe - Balkans & Caucasus',
  },

  // Asia - East
  { value: 'CNY', label: 'Chinese Yuan (CNY)', countryCode: 'CN', region: 'Asia - East' },
  { value: 'JPY', label: 'Japanese Yen (JPY)', countryCode: 'JP', region: 'Asia - East' },
  { value: 'KRW', label: 'South Korean Won (KRW)', countryCode: 'KR', region: 'Asia - East' },
  { value: 'TWD', label: 'Taiwan Dollar (TWD)', countryCode: 'TW', region: 'Asia - East' },
  { value: 'HKD', label: 'Hong Kong Dollar (HKD)', countryCode: 'HK', region: 'Asia - East' },
  { value: 'MOP', label: 'Macanese Pataca (MOP)', countryCode: 'MO', region: 'Asia - East' },
  { value: 'MNT', label: 'Mongolian Tugrik (MNT)', countryCode: 'MN', region: 'Asia - East' },

  // Asia - South & Central
  {
    value: 'INR',
    label: 'Indian Rupee (INR)',
    countryCode: 'IN',
    region: 'Asia - South & Central',
  },
  {
    value: 'PKR',
    label: 'Pakistani Rupee (PKR)',
    countryCode: 'PK',
    region: 'Asia - South & Central',
  },
  {
    value: 'BDT',
    label: 'Bangladeshi Taka (BDT)',
    countryCode: 'BD',
    region: 'Asia - South & Central',
  },
  {
    value: 'LKR',
    label: 'Sri Lankan Rupee (LKR)',
    countryCode: 'LK',
    region: 'Asia - South & Central',
  },
  {
    value: 'NPR',
    label: 'Nepalese Rupee (NPR)',
    countryCode: 'NP',
    region: 'Asia - South & Central',
  },
  {
    value: 'AFN',
    label: 'Afghan Afghani (AFN)',
    countryCode: 'AF',
    region: 'Asia - South & Central',
  },
  {
    value: 'KZT',
    label: 'Kazakhstani Tenge (KZT)',
    countryCode: 'KZ',
    region: 'Asia - South & Central',
  },
  {
    value: 'UZS',
    label: 'Uzbekistan Som (UZS)',
    countryCode: 'UZ',
    region: 'Asia - South & Central',
  },
  {
    value: 'KGS',
    label: 'Kyrgystani Som (KGS)',
    countryCode: 'KG',
    region: 'Asia - South & Central',
  },
  {
    value: 'TJS',
    label: 'Tajikistani Somoni (TJS)',
    countryCode: 'TJ',
    region: 'Asia - South & Central',
  },
  {
    value: 'TMT',
    label: 'Turkmenistani Manat (TMT)',
    countryCode: 'TM',
    region: 'Asia - South & Central',
  },

  // Asia - Southeast
  { value: 'THB', label: 'Thai Baht (THB)', countryCode: 'TH', region: 'Asia - Southeast' },
  { value: 'VND', label: 'Vietnamese Đồng (VND)', countryCode: 'VN', region: 'Asia - Southeast' },
  { value: 'MYR', label: 'Malaysian Ringgit (MYR)', countryCode: 'MY', region: 'Asia - Southeast' },
  { value: 'SGD', label: 'Singapore Dollar (SGD)', countryCode: 'SG', region: 'Asia - Southeast' },
  { value: 'IDR', label: 'Indonesian Rupiah (IDR)', countryCode: 'ID', region: 'Asia - Southeast' },
  { value: 'PHP', label: 'Philippine Peso (PHP)', countryCode: 'PH', region: 'Asia - Southeast' },
  { value: 'MMK', label: 'Myanmar Kyat (MMK)', countryCode: 'MM', region: 'Asia - Southeast' },
  { value: 'KHR', label: 'Cambodian Riel (KHR)', countryCode: 'KH', region: 'Asia - Southeast' },
  { value: 'LAK', label: 'Laotian Kip (LAK)', countryCode: 'LA', region: 'Asia - Southeast' },
  { value: 'BND', label: 'Brunei Dollar (BND)', countryCode: 'BN', region: 'Asia - Southeast' },

  // Middle East
  { value: 'AED', label: 'UAE Dirham (AED)', countryCode: 'AE', region: 'Middle East' },
  { value: 'SAR', label: 'Saudi Riyal (SAR)', countryCode: 'SA', region: 'Middle East' },
  { value: 'QAR', label: 'Qatari Rial (QAR)', countryCode: 'QA', region: 'Middle East' },
  { value: 'KWD', label: 'Kuwaiti Dinar (KWD)', countryCode: 'KW', region: 'Middle East' },
  { value: 'BHD', label: 'Bahraini Dinar (BHD)', countryCode: 'BH', region: 'Middle East' },
  { value: 'OMR', label: 'Omani Rial (OMR)', countryCode: 'OM', region: 'Middle East' },
  { value: 'JOD', label: 'Jordanian Dinar (JOD)', countryCode: 'JO', region: 'Middle East' },
  { value: 'ILS', label: 'Israeli Shekel (ILS)', countryCode: 'IL', region: 'Middle East' },
  { value: 'TRY', label: 'Turkish Lira (TRY)', countryCode: 'TR', region: 'Middle East' },
  { value: 'IQD', label: 'Iraqi Dinar (IQD)', countryCode: 'IQ', region: 'Middle East' },
  { value: 'IRR', label: 'Iranian Rial (IRR)', countryCode: 'IR', region: 'Middle East' },
  { value: 'SYP', label: 'Syrian Pound (SYP)', countryCode: 'SY', region: 'Middle East' },
  { value: 'LBP', label: 'Lebanese Pound (LBP)', countryCode: 'LB', region: 'Middle East' },
  { value: 'YER', label: 'Yemeni Rial (YER)', countryCode: 'YE', region: 'Middle East' },

  // Africa
  { value: 'ZAR', label: 'South African Rand (ZAR)', countryCode: 'ZA', region: 'Africa' },
  { value: 'EGP', label: 'Egyptian Pound (EGP)', countryCode: 'EG', region: 'Africa' },
  { value: 'MAD', label: 'Moroccan Dirham (MAD)', countryCode: 'MA', region: 'Africa' },
  { value: 'DZD', label: 'Algerian Dinar (DZD)', countryCode: 'DZ', region: 'Africa' },
  { value: 'TND', label: 'Tunisian Dinar (TND)', countryCode: 'TN', region: 'Africa' },
  { value: 'LYD', label: 'Libyan Dinar (LYD)', countryCode: 'LY', region: 'Africa' },
  { value: 'NGN', label: 'Nigerian Naira (NGN)', countryCode: 'NG', region: 'Africa' },
  { value: 'GHS', label: 'Ghanaian Cedi (GHS)', countryCode: 'GH', region: 'Africa' },
  { value: 'KES', label: 'Kenyan Shilling (KES)', countryCode: 'KE', region: 'Africa' },
  { value: 'ETB', label: 'Ethiopian Birr (ETB)', countryCode: 'ET', region: 'Africa' },
  { value: 'TZS', label: 'Tanzanian Shilling (TZS)', countryCode: 'TZ', region: 'Africa' },
  { value: 'UGX', label: 'Ugandan Shilling (UGX)', countryCode: 'UG', region: 'Africa' },
  { value: 'RWF', label: 'Rwandan Franc (RWF)', countryCode: 'RW', region: 'Africa' },
  { value: 'MUR', label: 'Mauritian Rupee (MUR)', countryCode: 'MU', region: 'Africa' },
  { value: 'SCR', label: 'Seychellois Rupee (SCR)', countryCode: 'SC', region: 'Africa' },
  { value: 'BWP', label: 'Botswanan Pula (BWP)', countryCode: 'BW', region: 'Africa' },
  { value: 'NAD', label: 'Namibian Dollar (NAD)', countryCode: 'NA', region: 'Africa' },
  { value: 'MZN', label: 'Mozambican Metical (MZN)', countryCode: 'MZ', region: 'Africa' },
  { value: 'ZMW', label: 'Zambian Kwacha (ZMW)', countryCode: 'ZM', region: 'Africa' },
  { value: 'MWK', label: 'Malawian Kwacha (MWK)', countryCode: 'MW', region: 'Africa' },
  { value: 'AOA', label: 'Angolan Kwanza (AOA)', countryCode: 'AO', region: 'Africa' },
  { value: 'XOF', label: 'West African CFA Franc (XOF)', countryCode: 'CI', region: 'Africa' }, // Using Ivory Coast flag
  { value: 'XAF', label: 'Central African CFA Franc (XAF)', countryCode: 'CM', region: 'Africa' }, // Using Cameroon flag

  // Oceania
  { value: 'AUD', label: 'Australian Dollar (AUD)', countryCode: 'AU', region: 'Oceania' },
  { value: 'NZD', label: 'New Zealand Dollar (NZD)', countryCode: 'NZ', region: 'Oceania' },
  { value: 'FJD', label: 'Fijian Dollar (FJD)', countryCode: 'FJ', region: 'Oceania' },
  { value: 'PGK', label: 'Papua New Guinean Kina (PGK)', countryCode: 'PG', region: 'Oceania' },
  { value: 'SBD', label: 'Solomon Islands Dollar (SBD)', countryCode: 'SB', region: 'Oceania' },
  { value: 'TOP', label: 'Tongan Paʻanga (TOP)', countryCode: 'TO', region: 'Oceania' },
  { value: 'VUV', label: 'Vanuatu Vatu (VUV)', countryCode: 'VU', region: 'Oceania' },
  { value: 'WST', label: 'Samoan Tala (WST)', countryCode: 'WS', region: 'Oceania' },
  { value: 'XPF', label: 'CFP Franc (XPF)', countryCode: 'PF', region: 'Oceania' }, // French Polynesia
];
