# Meta Ads — Pixel and Conversions API
Platform: meta_ads
Knowledge version: 2026-07
Sources:
- https://www.facebook.com/help/messenger-app/952192354843755/
- https://www.facebook.com/business/help/AboutConversionsAPI

The Meta Pixel is a browser-side business tool used to send website events. Meta recommends considering Conversions API alongside Pixel for website events.

Conversions API creates a direct connection between marketing data from sources such as servers, websites, apps, CRM/offline systems or messaging and Meta's systems for measurement and optimization. Meta states CAPI can improve connectivity and measurement and can be less affected by browser loading errors, connectivity issues and ad blockers than Pixel alone.

CAPI is not a mechanism to bypass privacy requirements or platform data-sharing rules.

## Rocky measurement gate
Check:
- Pixel/dataset status
- prioritized/primary business events
- event duplication/deduplication when browser + server events are used
- event match quality where available
- purchase values or qualified-lead signals
- CAPI availability
- consent/privacy requirements

Never claim CAPI or Pixel is healthy without evidence from Events Manager or integration diagnostics.
