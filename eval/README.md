# Accuracy test set

These cases are used to choose the triage and extraction models in `config/default.json` (spec §11 and §13),
and to catch regressions when a model or prompt changes.

## Adding a case

Aim for 10–20 real documents from tracked projects, a mix of material ones (studies, resource updates, permits)
and routine ones (dividends, meetings). One folder per document:

```
eval/cases/<short-id>/
  doc.txt or doc.pdf    the document (save the PDF, or paste the news-release text)
  project.json          {"slug": "vizcachitas"}
  expected.json         what a careful reader takes from it, checked by hand
```

`expected.json`:

```json
{
  "triage": { "material": true, "category": "study" },
  "figures": [
    { "field": "capex_usd", "valueText": "US$2.7 billion", "valueNum": 2700000000 },
    { "field": "mine_life_years", "valueText": "26 years", "valueNum": 26 }
  ]
}
```

Categories: `study`, `resource`, `drilling`, `permit`, `ownership`, `financing`, `routine`.
Fields: `capex_usd`, `mine_life_years`, `resource_headline`, `reserve_headline`, `annual_production`, `grade`,
`c1_cost`, `throughput_tpd`, `additional_info`, `stage`, `owners`, `minerals`.
A figure matches when the field is the same and the number is within 1%, or the text is the same.

## Running

```
npm run eval
npm run eval -- --triage ollama --extract workersAi
npm run eval -- --triage workersAi --extract claude
```

It prints triage accuracy and figure precision/recall per case and overall. Pick the cheapest pair that scores
well, then set `triageProvider`, `extractProvider` and the `model` names in `config/default.json`.
