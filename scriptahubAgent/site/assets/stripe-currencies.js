// Stripe payment currency codes verified against the Country Specs API (RO), 2026-11-13.
// https://docs.stripe.com/api/country_specs/object#country_spec_object-supported_payment_currencies
export const stripeCurrencies = Object.freeze(
  "AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BIF BMD BND BOB BRL BSD BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CVE CZK DJF DKK DOP DZD EGP ETB EUR FJD FKP GBP GEL GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR ISK JMD JPY KES KGS KHR KMF KRW KYD KZT LAK LBP LKR LRD LSL MAD MDL MGA MKD MMK MNT MOP MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SEK SGD SHP SLE SOS SRD STD SZL THB TJS TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VND VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW".split(" ")
);

const zeroDecimalCurrencies = new Set('BIF CLP DJF GNF JPY KMF KRW MGA PYG RWF VND VUV XAF XOF XPF'.split(' '));

export function stripeCurrencyUnits(currency) {
  const code = currency.toUpperCase();
  if (code === 'ISK' || code === 'UGX') return { digits: 0, scale: 100 };
  const digits = zeroDecimalCurrencies.has(code) ? 0 : 2;
  return { digits, scale: 10 ** digits };
}
