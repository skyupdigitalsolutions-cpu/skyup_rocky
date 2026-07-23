# Rocky RAG Retrieval Instructions

Retrieve official platform knowledge before drafting a campaign plan.

Suggested metadata filters:
platform: google_ads | meta_ads | cross_platform
country: global | IN
topic: campaign_type | keywords | bidding | audience | placements | measurement | policy | budget | strategy
knowledge_version: 2026-07

For every campaign-plan generation:
1. Retrieve campaign/objective knowledge.
2. Retrieve bidding/optimization knowledge.
3. Retrieve targeting knowledge.
4. Retrieve measurement knowledge.
5. Retrieve policy/country knowledge if applicable.
6. Retrieve strategy decision rules.
7. Generate plan only after checking missing required inputs.

Prefer current official-platform chunks over older chunks when rules conflict. Preserve source_url and retrieved_at metadata for traceability.
