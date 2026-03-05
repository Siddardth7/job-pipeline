# QA Report — M628 Company Database (Final Clean)
Generated: 2026-03-04T17:24:29.235441Z

## 1. Pipeline Summary
| Metric | Count |
|--------|-------|
| Original input (pre-clean) | 628 |
| After other-conversation cleaning | 319 |
| ITAR=YES removed | 4 |
| Blacklisted removed | 0 |
| Exact duplicates removed | 3 |
| Fuzzy duplicates merged | 9 |
| **Final clean total** | **303** |

## 2. Removal Log
### ITAR=YES / Blacklisted
- Aerojet Rocketdyne (L3Harris): ITAR=YES (full citizenship required)
- Lockheed Martin: ITAR=YES (full citizenship required)
- Northrop Grumman: ITAR=YES (full citizenship required)
- Raytheon Technologies (RTX): ITAR=YES (full citizenship required)

### Exact Duplicates
- Lucid Motors: Exact duplicate (kept first occurrence, Tier 1)
- Magna International: Exact duplicate (kept first occurrence, Tier 1)
- Martinrea International: Exact duplicate (kept first occurrence, Tier 1)

### Fuzzy Duplicates (Merged)
- Removed **3M Company**, kept **3M**: None
- Removed **Bosch (USA operations)**, kept **Bosch USA**: Kept Bosch USA (h1b=YES, Tier 3 auto)
- Removed **GKN Aerospace US**, kept **GKN Aerospace**: Merged: Mfg, Composites, Process from US variant
- Removed **Henkel (Adhesive Tech)**, kept **Henkel**: Kept Henkel (Tier 6, h1b=YES)
- Removed **Leonardo**, kept **Leonardo (Group)**: Kept Group variant (h1b=YES)
- Removed **Safran (USA operations)**, kept **Safran USA**: Kept Safran USA (h1b=YES, better roles)
- Removed **Solvay (Cytec)**, kept **Solvay**: Merged: R&D focus from Cytec variant
- Removed **Stellantis**, kept **Stellantis (FCA)**: Kept FCA variant (Tier 3 auto, better roles)
- Removed **3M**, kept **3M Company**: Kept 3M Company (Tier 1, h1b=YES, better data)

## 3. ATS Platform Breakdown
- Unknown: 145 companies
- Workday: 88 companies
- Greenhouse: 19 companies
- Custom: 16 companies
- Lever: 15 companies
- iCIMS: 9 companies
- Taleo: 7 companies
- USAJOBS: 2 companies
- SuccessFactors: 2 companies

## 4. Verification Status
- Verified (known ATS + board URL): 158
- Unverified (inferred domain, needs manual check): 145

## 5. Tier Distribution
- Tier 1: 138
- Tier 2: 132
- Tier 3: 33

## 6. Industry Category Distribution
- Aerospace: 111
- Manufacturing: 50
- Materials & Composites: 42
- Automotive: 41
- Medical Devices: 21
- Energy: 18
- Research: 15
- Semiconductor: 3
- Chemical: 2

## 7. H-1B & ITAR Status
- H1B=YES (confirmed sponsor): 62
- H1B=LIKELY (not confirmed, but no restriction): 241
- ITAR=NO: 180
- ITAR=Partial (commercial divisions accessible): 123

## 8. Scraping Readiness
- ATS-native (verified board URL, structured scraping): 140
- Search-then-verify (needs URL discovery first): 147
- Company-site-crawl (custom ATS, needs manual setup): 16

## 9. Companies Needing Manual Verification (first 30)
- C0001 | 3D Systems Corporati

## 10. Recommendations
1. **Priority scraping**: Start with the 140 ATS-native companies. These have confirmed board URLs and structured data.
2. **JSearch first pass**: Run JSearch API for ALL 303 companies. It will cover the well-indexed ones cheaply. Use Apify only for companies JSearch misses.
3. **Workday companies (88)**: Use headless browser with waitFor selector. Most Workday boards have consistent URL patterns.
4. **Greenhouse/Lever (34)**: Easiest to scrape. Open APIs, no JS rendering needed.
5. **Unverified companies (145)**: Before running Apify, manually verify careers URL for each. Many inferred domains will be wrong.
6. **Token savings**: This pipeline eliminates the ~8K-15K token AI search step entirely. Jobs feed directly into the pipeline tab.
