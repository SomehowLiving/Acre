# Acre Blue Score and Credit Eligibility Methodology

## Executive Summary

Acre converts consented, privacy-preserving work-history proofs into an explainable credit-readiness signal for gig workers. The output is not a traditional bureau score. It is a real-time underwriting layer that helps lenders evaluate workers who are otherwise thin-file or invisible to conventional credit systems.

The system produces three lender-facing outputs:

1. **Blue Score**: a 300-900 score measuring verified gig-work income stability, consistency, reputation, activity, and reliability.
2. **Blue Tier**: a simple underwriting band derived from the score: Blue Basic, Blue Plus, or Blue Prime.
3. **Credit Limit**: an income-indexed, debt-capacity-aware lending limit with tier-specific caps and APR bands.

The core design principle is simple: Acre rewards durable, verifiable earning capacity rather than raw data possession. A worker does not need to expose bank statements, SMS data, device data, contact lists, or raw PII. The lender receives an explainable credit outcome backed by consent, proof hashes, and on-chain auditability.

## What Acre Measures

Acre scores five dimensions that map directly to repayment capacity and operational stability.

| Dimension | Weight | What it Measures | Why it Matters |
| --- | ---: | --- | --- |
| Income Stability | 30% | Verified monthly platform earnings | Determines repayment capacity and loan affordability |
| Work Consistency | 25% | Months actively earning on platform | Separates durable earners from one-off or unstable workers |
| Platform Rating | 20% | Customer/platform reputation score | Proxy for service quality, account health, and future earning continuity |
| Activity Volume | 15% | Lifetime completed trips/orders/tasks | Shows work intensity and platform engagement |
| Completion Rate | 10% | Share of accepted jobs completed | Measures reliability and operational discipline |

The weights intentionally place the most importance on **earning capacity** and **consistency**, while still incorporating reputation and reliability signals. This makes the score useful for credit decisions rather than merely a platform-performance badge.

## Signal Inputs

Each verified worker profile contains the following scoring inputs:

| Field | Example | Description |
| --- | ---: | --- |
| Monthly earnings | ₹41,500 | Monthly income inferred from verified platform activity |
| Tenure months | 20 | Duration of active platform work |
| Platform rating | 4.74 / 5.00 | Worker reputation on the platform |
| Lifetime trips/orders | 6,080 | Completed work volume |
| Monthly trips/orders | 304 | Current work intensity |
| Completion rate | 95% | Reliability of accepted work |

The model is designed to avoid brittle pass/fail rules. A worker can improve gradually: more monthly income, stronger completion rate, more tenure, or higher rating each moves the score.

## Blue Score Range

The Blue Score runs from **300 to 900**.

| Range | Tier | Meaning |
| ---: | --- | --- |
| 300-529 | Blue Basic | Thin or developing profile; limited or no eligible credit |
| 530-699 | Blue Plus | Established worker with enough signal for competitive micro/personal credit |
| 700-900 | Blue Prime | High-confidence borrower profile with strong earning durability |

## How the Score is Calculated

Each metric is normalized with diminishing returns. This prevents a single extreme value from dominating the score.

For example:

- Moving from ₹10k to ₹30k monthly earnings matters a lot.
- Moving from ₹70k to ₹90k matters less because the worker is already in a high-income band.
- Moving from 1 month to 8 months tenure matters a lot.
- Moving from 30 months to 36 months matters less because the worker is already proven to be durable.

The normalized dimensions are then combined:

```text
Weighted Signal =
  Income Stability   x 30%
+ Work Consistency   x 25%
+ Platform Rating    x 20%
+ Activity Volume    x 15%
+ Completion Rate    x 10%
```

The weighted signal is mapped onto the 300-900 score range:

```text
Base Score = 300 + (Weighted Signal x 600)
```

This means:

- 300 is the starting floor for a verified but weak profile.
- 900 is the upper bound for an exceptional profile.
- Most workers fall between 500 and 750, which is useful for lender segmentation.

## Normalization Reference Points

The normalization curve is calibrated around practical gig-economy underwriting thresholds.

### Income Stability

| Monthly Earnings | Approximate Signal Strength |
| ---: | ---: |
| ₹10k | Very weak |
| ₹25k | Developing |
| ₹30k | Midpoint |
| ₹45k | Strong |
| ₹60k+ | Very strong |

### Work Consistency

| Tenure | Approximate Signal Strength |
| ---: | ---: |
| 1 month | Very weak |
| 5 months | Developing |
| 8 months | Midpoint |
| 12 months | Strong |
| 24 months+ | Very strong |

### Platform Rating

| Rating | Approximate Signal Strength |
| ---: | ---: |
| 4.0 | Weak |
| 4.2 | Developing |
| 4.3 | Midpoint |
| 4.5 | Strong |
| 4.8+ | Very strong |

### Activity Volume

| Lifetime Trips/Orders | Approximate Signal Strength |
| ---: | ---: |
| 100 | Very weak |
| 500 | Developing |
| 800 | Midpoint |
| 1,200 | Strong |
| 2,500+ | Very strong |

### Completion Rate

| Completion Rate | Approximate Signal Strength |
| ---: | ---: |
| 75% | Very weak |
| 80% | Weak |
| 87% | Midpoint |
| 92% | Strong |
| 97%+ | Very strong |

## Risk Penalties

Acre also applies downside penalties when signals indicate elevated repayment or continuity risk.

| Risk Condition | Impact |
| --- | --- |
| Completion rate below 85% | Reduces overall score |
| Rating below 4.0 | Reduces overall score |
| Monthly earnings below ₹12k | Reduces overall score |
| Very short tenure | Caps maximum score |

These penalties are important for lender trust. A borrower with one strong metric should not receive a high score if other operational indicators are weak.

Example:

- High income but poor completion rate is risky.
- High rating but very low income does not support repayment.
- High activity over only one month is not durable enough for a high score.

## Excellence Bonuses

Acre rewards top-decile operators with small score bonuses.

| Signal | Bonus Logic |
| --- | --- |
| Rating 4.6+ | Small bonus |
| Rating 4.8+ | Higher bonus |
| Completion 93%+ | Small bonus |
| Completion 97%+ | Higher bonus |
| Tenure 18+ months | Small bonus |
| Tenure 24+ months | Higher bonus |
| Returning verified user | +20 reputation bonus |

The returning-user bonus is especially important. It rewards longitudinal consistency: a worker who re-verifies over time is more useful to lenders than a one-time snapshot.

## Blue Tiers

### Blue Basic: 300-529

Blue Basic represents a developing or thin profile.

Typical characteristics:

- Low or early income history
- Limited platform tenure
- Moderate or unproven reliability
- Smaller verified work volume

Credit treatment:

- Conservative credit exposure
- Small-ticket eligibility only when repayment capacity supports it
- If calculated limit is below ₹5,000, Acre recommends rejection rather than issuing an uneconomic or risky microloan

### Blue Plus: 530-699

Blue Plus represents an established worker.

Typical characteristics:

- Meaningful monthly earnings
- Several months of platform history
- Reliable completion rate
- Good platform rating
- Enough activity volume to support confidence

Credit treatment:

- Competitive micro/personal credit
- Mid-tier APR band
- Credit limit tied directly to income and debt capacity

### Blue Prime: 700-900

Blue Prime represents a high-confidence operator.

Typical characteristics:

- Strong monthly earnings
- Long platform tenure
- High rating
- High completion rate
- High activity volume
- Often repeated Acre verification history

Credit treatment:

- Higher credit limits
- Best APR band
- Strong lender confidence due to verified, repeatable earning capacity

## Credit Limit Methodology

The credit limit is not a fixed tier amount. It is calculated from income and affordability.

Acre uses three constraints:

1. **Income-indexed limit**
2. **Debt-to-income affordability limit**
3. **Tier cap**

The final limit is:

```text
Credit Limit = minimum(
  Monthly Earnings x Tier Multiplier,
  DTI-Based Capacity,
  Tier Cap
)
```

There are no artificial floor limits. This avoids the common underwriting problem where a low-income borrower receives a loan amount they cannot realistically repay.

## Tier Multipliers and Caps

| Tier | Income Multiplier | Tier Cap | APR Band |
| --- | ---: | ---: | --- |
| Blue Basic | 0.35x | ₹18,000 | 16-18% |
| Blue Plus | 0.70x | ₹50,000 | 13-15% |
| Blue Prime | 1.20x | ₹1,00,000 | 10-12% |

If the calculated limit is below ₹5,000, the outcome is ₹0. Acre treats that as a decline rather than forcing an uneconomic loan.

## DTI Guardrail

Acre applies a debt-to-income guardrail to protect repayment capacity.

```text
Maximum Affordable EMI = Monthly Earnings x 40%
```

The model then estimates the maximum loan amount that can be supported by that EMI over a 12-month term using the applicable underwriting APR.

This creates a lender-friendly affordability check:

- The borrower is not given more credit simply because they crossed a score threshold.
- The score determines the quality band.
- Income and DTI determine how much credit the borrower can safely carry.

## Example Outcomes

### Example 1: Developing Worker

| Metric | Value |
| --- | ---: |
| Monthly earnings | ₹15,000 |
| Tenure | 4 months |
| Rating | 4.20 |
| Lifetime trips | 480 |
| Completion rate | 86% |

Likely outcome:

```text
Tier: Blue Basic or low Blue Plus
Credit limit: small, income-constrained
Decision: approve only if limit clears minimum viability
```

Why: the worker has evidence of earning, but limited durability and modest work volume.

### Example 2: Established Worker

| Metric | Value |
| --- | ---: |
| Monthly earnings | ₹32,000 |
| Tenure | 10 months |
| Rating | 4.55 |
| Lifetime trips | 2,100 |
| Completion rate | 92% |

Likely outcome:

```text
Tier: Blue Plus
Credit limit: approximately ₹20k-₹25k, subject to affordability
Decision: suitable for competitive micro/personal credit
```

Why: income, tenure, rating, and activity all support repeatable earning capacity.

### Example 3: Prime Worker

| Metric | Value |
| --- | ---: |
| Monthly earnings | ₹60,000 |
| Tenure | 24 months |
| Rating | 4.80 |
| Lifetime trips | 7,500 |
| Completion rate | 96% |

Likely outcome:

```text
Tier: Blue Prime
Credit limit: higher limit, capped by income, DTI, and tier maximum
Decision: strong borrower profile
```

Why: the worker shows high income, high reliability, and durable work history.

## Why This is Explainable

Every Blue Score can be decomposed into:

- Income contribution
- Tenure contribution
- Rating contribution
- Activity contribution
- Completion contribution
- Penalties
- Bonuses
- Tier assignment
- Credit-limit calculation

This gives lenders a clear audit path:

```text
Verified Signals -> Normalized Factors -> Weighted Score -> Tier -> Credit Limit
```

The lender can see why a worker qualified, why they were capped, and what would improve their future eligibility.

## Why This is Different From a Traditional Credit Score

Traditional credit bureaus primarily evaluate past borrowing behavior. That works poorly for gig workers who may earn consistently but lack formal credit history.

Acre evaluates **verified earning behavior**:

| Traditional Credit Bureau | Acre Blue Score |
| --- | --- |
| Past loans and repayment | Current earning capacity |
| Credit-card and bureau history | Platform work history |
| Often unavailable for thin-file workers | Designed for thin-file workers |
| Static or slow-moving | Refreshable with new proofs |
| Requires broad financial visibility | Uses consented, privacy-preserving proofs |

This makes Acre especially useful for lenders targeting gig workers, delivery partners, drivers, freelancers, and other non-salaried borrowers.

## Privacy and Compliance Positioning

Acre is designed around data minimization.

The lender receives:

- Blue Score
- Blue Tier
- Credit limit
- Proof timestamp
- Proof hash
- Consent/audit record

The lender does not need raw:

- Aadhaar data
- Platform credentials
- SMS data
- Contact lists
- Device fingerprints
- Full transaction history

This structure supports DPDP-style minimization and RBI-aligned digital lending hygiene: the underwriting decision is explainable without requiring invasive data collection.

## Investor Takeaway

Acre is building a credit decisioning layer for the next generation of workers: people with real income, but limited bureau visibility.

The Blue Score is valuable because it is:

- **Explainable**: every score maps to clear operational and income factors.
- **Privacy-preserving**: lenders get outcomes, not raw personal data.
- **Underwriting-oriented**: score connects directly to credit limits and affordability.
- **Refreshable**: workers can improve and re-verify over time.
- **Auditable**: proof hashes and verification metadata can be anchored on-chain.
- **Configurable for lenders**: the same framework can support different lender risk appetites.

In short:

```text
Acre turns verified work into bankable credit eligibility.
```
