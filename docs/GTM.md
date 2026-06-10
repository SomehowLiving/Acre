# **ACRE — GO-TO-MARKET PLAN**

## **Privacy-Preserving Underwriting Framework for India's Gig Economy**

---

### **1. TARGET USERS**

**Primary (Paying):** Micro-ticket NBFCs & fintech lenders originating sub-₹50k loans — salary-advance apps (KreditBee-type), embedded BNPL (ZestMoney-type), and urban MFI-NBFCs in gig clusters (Bangalore, Delhi NCR). They process 301L accounts/qtr at ₹16k avg ticket, spend ₹800–₹1,200 per thin-file applicant on manual KYC, and have zero compliance bandwidth for DPDP/RBI nuances.

**Secondary (Beneficiary):** India's 8M+ gig workers — Swiggy/Uber/Upwork — who are credit-invisible and legally blocked from sharing raw platform data with lenders. They enter Acre **through the lender's existing funnel**, not a standalone app.

**Tertiary (Months 6–12):** Debt marketplaces (Indifi-type) and mid-size NBFCs (Aye Finance-type) needing RBI-auditable alternative data at scale.

---

### **2. GTM STRATEGY**

**Reframe:** We do not sell a "Blue Score" to workers. We sell a **configurable, regulatory-safe data-permissioning framework** to lenders.

**Phase 0 — Lender Discovery (Weeks 0–4):**
Cold outreach to 10 Bangalore/Delhi NBFC founders. Pitch: *"What 3 signals does your risk team need to approve a ₹25k Swiggy driver loan under RBI/DPDP? We'll compose the exact ZK-proof bundle backwards from your policy."* Goal: 2 LOIs before writing new features.

**Phase 1 — Co-Design Pilot (Months 1–3):**
Integrate Acre SDK into the lender's loan funnel. Flow: Applicant → "Verify with Acre" → Reclaim QR → ZK proof → Blue Score + eligibility → Lender disburses. Acre handles proof + compliance logging; lender handles disbursement. Target: 100 applicants, cost drops from ₹950 to ₹55, zero DPDP flags.

**Phase 2 — Framework Productization (Months 3–6):**
Launch **Acre Lender Console** (no-code config panel) + SDK. Pre-built templates: Microloan, BNPL, Two-Wheeler Lease. Pricing: ₹25k–₹50k config fee; ₹30–₹80 per verification; ₹50k/mo enterprise SaaS.

**Phase 3 — B2B2C Empowerment (Months 6–9):**
Workers approved via Lender A unlock **Work Journey Dashboard** — ZK-verified career timeline, explainable Blue Score breakdown, and personalized credit-readiness guidance. Premium tier: ₹99/mo for multi-platform aggregation.

**Phase 4 — Ecosystem (Months 9–12):**
Partner marketplace (Rentomojo, Acko, Upgrad), RBI Sandbox application, and SEA expansion (Philippines, Indonesia).

---

### **3. REVENUE MODEL**

### **Table**

| **Stream** | **Pricing** | **Phase** |
| --- | --- | --- |
| **Scorecard Configuration** | ₹25k–₹50k one-time per lender | 1 |
| **Per-Verification API** | ₹40–₹80 per applicant | 1 |
| **Origination Success Fee** | 1.5–2.5% on disbursed value | 1 |
| **SaaS Subscription** | ₹50k/mo unlimited + support | 2 |
| **Worker Premium** | ₹99/mo advanced score insights | 3 |
| **Regulatory Audit Package** | ₹10k/mo immutable consent logs | 2+ |

**Unit Economics (Month 12):** 3 lenders × 5,000 verifications/mo = ₹6.5L/mo revenue. Algorand tx fees ≈ negligible. Gross margin: ~75%.

---

### **4. MONETIZATION HYPOTHESIS**

> *Indian NBFCs reject 60%+ of gig-worker applications not because workers are risky, but because lenders cannot legally collect raw alternative data under RBI 2025 Directions (banned SMS/contact/location scraping) and DPDP 2023 (penalties up to ₹250 Cr). Acre does not sell a score — we sell a configurable framework where the lender defines their risk appetite, and we assemble only the ZK-derived signals required to satisfy it, cutting compliance cost by ~70% and expanding addressable market by 8M+ credit-invisible workers.*
> 

**Validation:** NBFCs originated 301L sub-₹50k accounts in Q1 FY26, yet only 1 in 4 gig workers has formal credit. Post-DPDP, privacy-native underwriting is a *requirement*, not a feature.

---

### **5. WHY ALGORAND**

### **Table**

| **Property** | **Why It Matters for Acre** |
| --- | --- |
| **Sub-3s Finality** | Workers get loan confirmation in real-time during their shift — critical for micro-loans. |
| **~0.001 ALGO/tx** | ₹5,000 micro-loans remain profitable; Ethereum gas would eat 10% of principal. |
| **Atomic Transfers** | Collateral + disbursement + fee split in one tx — zero settlement risk. |
| **ASA Support** | Native stablecoin rails (USDCa / INR-pegged) for non-volatile disbursement. |
| **ARC-4 ABI + Indexer** | Clean REST-like SDK for fintech devs; immutable, queryable audit trails for RBI/DPDP inspections. |
| **Carbon Negative** | ESG alignment for Indian NBFCs and green-financing credibility. |

**Strategic angle:** Algorand's institutional credibility and sub-penny fees align with regulatory comfort — essential for RBI sandbox approval and conservative lender adoption. Unlike L1s with volatile gas, Algorand makes ₹500 micro-loans viable.

---

### **6. SCALABILITY VISION**

**Technical:** Proof generation is client-side (Reclaim zk-TLS + Noir on device). Acre backend verifies ECDSA signatures, computes the Blue Score and affordability-bounded credit limit, and submits the canonical verification outcome to Algorand. Only proof hashes, score outputs, compact metrics, and eligibility outcomes hit the chain. Costs stay flat regardless of model complexity or user growth.

**Market:** India first (1.2 Cr gig workers today, 2.3 Cr by 2028). Dense clusters → national rollout. SEA next: Philippines, Indonesia, Vietnam — identical gig-density + weak credit infra + emerging data protection laws.

**Regulatory:** Built DPDP-first. Zero-raw-data architecture ports cleanly to GDPR (EU) and PDPA (Singapore) without engineering changes — only jurisdiction-specific proof modules need reconfiguration. Algorand's public Indexer provides cross-border auditability.

**Platform Pivot:** Lending scoring → rental deposits → insurance underwriting → payroll verification. The identity + reputation layer becomes general-purpose **trust infrastructure** for the informal economy.

---

*Acre doesn't ask gig workers to choose between privacy and financial access. It proves they never had to.*

---
