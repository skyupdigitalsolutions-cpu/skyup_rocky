# Google Ads API — Criteria Compatibility Matrix
Platform: google_ads
Level: campaign_ad_group
Topic: criteria
Source: https://developers.google.com/google-ads/api/docs/targeting/criteria?hl=en
Verified: 2026-07-24

Current Google Ads API documentation distinguishes allowed levels and positive/negative support by criterion. Examples include ad schedule at campaign level; age and gender at campaign/ad-group levels; audiences at ad-group level in applicable contexts; campaign-level negative keywords; language at campaign/ad-group levels; proximity at campaign level; and user lists at campaign/ad-group levels where supported.

Rocky must query/validate the exact criterion compatibility for the selected campaign type before mutation. Never generate an API payload merely because a targeting concept exists in marketing strategy.
