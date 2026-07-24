# Google Ads — Search Keywords and Match Logic
Platform: google_ads
Knowledge version: 2026-07
Sources:
- https://support.google.com/google-ads/answer/14996023?hl=en
- https://support.google.com/google-ads/answer/16668865?hl=en

Google Search keyword matching includes broad, phrase and exact match. The match types overlap: phrase can reach the queries exact reaches plus more; broad can reach phrase/exact queries plus more. Modern matching considers meaning, not only literal syntax.

Broad match can use additional account/context signals. It can be useful when paired with conversion measurement and Smart Bidding, but Rocky must not blindly recommend broad match when conversion tracking is absent or the advertiser cannot tolerate exploratory traffic.

Negative keywords prevent ads from serving for unwanted queries. Negative matching behaves differently from positive keyword matching and should be used intentionally.

For Performance Max, Google recommends using negative keywords mainly for essential brand-safety or completely irrelevant traffic; brand exclusions are preferred when the goal is excluding brand searches.

## Rocky keyword workflow
1. Identify commercial intent and the offer.
2. Build tightly relevant keyword themes.
3. Separate materially different intent into logical groups.
4. Add negatives for clearly irrelevant intent.
5. Do not invent search volume, CPC, competition or forecast numbers unless Rocky has live Keyword Planner/API data.
6. Treat match type as a control/coverage decision, not a quality score.
