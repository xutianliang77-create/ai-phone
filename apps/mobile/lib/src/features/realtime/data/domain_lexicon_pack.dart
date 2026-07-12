const defaultDomainLexiconPack = 'product';

const selectableDomainLexiconPacks = <String>[
  'product',
  'business',
  'technology',
  'medical',
  'travel',
  'dining',
  'entertainment',
];

String normalizeDomainLexiconPack(String value) {
  final normalized = value.trim().toLowerCase();
  return selectableDomainLexiconPacks.contains(normalized)
      ? normalized
      : defaultDomainLexiconPack;
}
