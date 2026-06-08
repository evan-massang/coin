You are acting as a Senior QA Engineer, Quant Researcher, and Product Auditor.



Your task is NOT to improve code.



Your task is to discover what is wrong.



\## Instructions



Use Playwright.



Start the application.



Inspect the running product.



Do not trust source code.



Do not assume features work.



Verify everything.



\---



\## Dashboard Audit



Check:



\- Layout

\- Visibility

\- Readability

\- Missing information

\- Broken controls



Capture screenshots.



\---



\## Paper Trading Audit



Verify:



\- Starting balance

\- Open positions

\- Closed positions

\- Trade history

\- PnL

\- Wallet value



If missing:



Create issue.



\---



\## Council Audit



Verify:



\- Auto triggering

\- Status updates

\- Result visibility

\- Processing queue



Determine whether council actually runs automatically.



\---



\## Scanner Audit



Verify:



\- New coins appear

\- Ranking updates

\- Observation queue works



Check if observation lifecycle behaves correctly.



\---



\## Confidence Audit



Determine:



\- Whether scores are clustered

\- Whether fallback values dominate

\- Whether confidence appears calibrated



Collect examples.



\---



\## Research Questions



For every issue answer:



What happened?



Why happened?



Evidence?



Severity?



Proposed fix?



Expected impact?



\---



\## Deliverable



Generate:



\- Executive Summary

\- Critical Issues

\- Medium Issues

\- Low Issues

\- Screenshots

\- Recommendations



Do not modify code.



Only audit.

