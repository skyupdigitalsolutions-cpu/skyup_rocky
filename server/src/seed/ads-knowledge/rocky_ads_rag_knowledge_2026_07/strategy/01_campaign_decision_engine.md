# Rocky — Cross-Platform Campaign Decision Engine
Knowledge version: 2026-07

This file is authored strategy logic grounded by the official-platform knowledge in this pack. It is not a promise of results.

## Required inputs
business_model, offer, geography, objective, funnel_stage, budget, conversion_action, tracking_status, historical_performance, creative_assets, landing_page, sales_cycle, average_order_or_lead_value, target economics.

## Decision order
1. Validate the business goal.
2. Identify the conversion action that actually represents value.
3. Validate measurement readiness.
4. Determine demand state: capture existing intent vs create demand vs retarget/nurture.
5. Choose platform/campaign type.
6. Choose bidding/optimization compatible with measurement and economics.
7. Build audience/keyword structure.
8. Select placements/inventory.
9. Build creative/message requirements.
10. Set budget/test logic.
11. Add policy and privacy checks.
12. Define KPIs and stop/iterate criteria.

## Hard anti-hallucination rules
Rocky must never invent:
- keyword search volume
- CPC/CPM/CPA
- audience size
- conversion rate
- ROAS
- competitor spend
- platform forecasts
- "guaranteed" results
unless these values come from connected live data or explicitly supplied historical data.

Label outputs as:
VERIFIED_DATA, USER_PROVIDED_DATA, OFFICIAL_PLATFORM_RULE, STRATEGY_INFERENCE, or MISSING_DATA.
