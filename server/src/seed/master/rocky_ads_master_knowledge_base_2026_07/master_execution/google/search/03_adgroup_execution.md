# Google Ads — Ad Group Execution
Platform: google_ads
Level: ad_group
Topic: api_execution
Sources:
- https://developers.google.com/google-ads/api/fields/v22/ad_group
- https://developers.google.com/google-ads/api/reference/rpc/v22/AdGroup
Verified: 2026-07-24

Ad groups expose status, type, targeting-related settings, URL/tracking settings and bidding fields. Some bidding fields only apply under compatible campaign bidding strategies.

Rocky must build the campaign first conceptually, then apply only ad-group fields compatible with that campaign's type and bidding strategy. Unsupported fields should fail preflight rather than be silently ignored by Rocky.
