# Google Ads — Smart Bidding
Platform: google_ads
Knowledge version: 2026-07
Sources:
- https://support.google.com/google-ads/answer/7065882?hl=en-in
- https://support.google.com/google-ads/answer/6268632?hl=en-IN
- https://support.google.com/google-ads/answer/6268637?hl=en

Smart Bidding uses Google AI to optimize for conversions or conversion value at auction time. Current core strategies include Target CPA, Target ROAS, Maximize conversions and Maximize conversion value.

Starting June 2026, Google is changing labels: "Maximize conversions with a Target CPA" is becoming "Target CPA", and "Maximize conversion value with a Target ROAS" is becoming "Target ROAS". Google states that the underlying bidding behavior does not change because of this naming transition.

Target CPA is appropriate when the advertiser values conversion volume while trying to maintain an average acquisition-cost target. Individual conversions may be above or below the target.

Target ROAS is appropriate when conversion values differ and the advertiser wants conversion value around a return constraint. Accurate conversion values are required.

Maximize conversions prioritizes conversion volume within budget. Maximize conversion value prioritizes total conversion value within budget.

## Rocky rule
Do not fabricate CPA/ROAS targets. Derive targets from actual economics/history when available. If reliable conversion tracking is absent, flag measurement setup before recommending conversion-based automation as though it were fully informed.
