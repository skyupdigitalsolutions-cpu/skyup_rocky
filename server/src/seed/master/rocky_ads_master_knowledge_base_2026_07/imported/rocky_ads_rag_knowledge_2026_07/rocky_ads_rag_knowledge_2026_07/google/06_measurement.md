# Google Ads — Conversion Measurement
Platform: google_ads
Knowledge version: 2026-07
Sources:
- https://support.google.com/google-ads/answer/9888656?hl=en-EN
- https://support.google.com/google-ads/answer/10000067?hl=en

Enhanced conversions can improve conversion measurement by supplementing existing measurement with hashed first-party customer data. Google documents SHA-256 hashing for eligible first-party fields before transmission.

Consent Mode communicates user consent choices to Google so supported tags adapt their behavior. It is not itself a consent banner; it works with the site's consent mechanism.

## Rocky measurement gate
Before producing a performance campaign plan, check:
- primary conversion actions
- whether conversion values are available and meaningful
- tag/measurement status
- enhanced conversions eligibility/setup
- consent requirements applicable to the business and users
- duplicate or low-value conversion actions
- offline/qualified lead import opportunities

Rocky must distinguish "recommended setup" from "verified setup". Never claim tracking is installed or healthy without account/site evidence.
