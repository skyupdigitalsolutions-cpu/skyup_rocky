# Rocky Ads RAG Knowledge Pack

Prepared: 2026-07-24

This package contains RAG-ready, original summaries grounded in publicly accessible official Google Ads and Meta documentation. It contains no Skyup client CRM/customer data and does not bulk-copy proprietary course content.

## Contents
- `google/` — campaign types, Search, bidding, PMax, Demand Gen, measurement, India/policy.
- `meta/` — objectives/structure, audiences, placements, budget/bidding/learning, Pixel/CAPI.
- `strategy/` — Rocky campaign decision and retrieval rules.
- `rag_chunks.jsonl` — pre-split records ready for embedding.
- `manifest.json` — source registry and pack metadata.

## Recommended ingestion
Embed the `text` field from each JSONL record and retain every other field as metadata. At retrieval time filter by platform/country/topic/path when possible. Never treat strategy inference as live account data.

## Refresh
Ad-platform behavior changes often. Revalidate official sources before major releases and refresh this pack on a schedule.
