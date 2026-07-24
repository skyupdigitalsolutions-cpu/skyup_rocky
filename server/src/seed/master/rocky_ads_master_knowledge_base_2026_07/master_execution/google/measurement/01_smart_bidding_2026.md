# Google Smart Bidding — 2026 Naming and Behavior
Platform: google_ads
Level: campaign
Topic: smart_bidding
Source: https://support.google.com/google-ads/answer/7065882?hl=en-in
Verified: 2026-07-24

Google documents Target CPA, Target ROAS, Maximize conversions and Maximize conversion value as Smart Bidding strategies using auction-time optimization. Starting June 2026, labels are changing so 'Maximize conversions with a Target CPA' becomes 'Target CPA' and the analogous conversion-value strategy becomes 'Target ROAS'; Google states the underlying behavior is unchanged.

Rocky should normalize old/new labels internally while emitting the terminology/API enum expected by the connected platform version.
