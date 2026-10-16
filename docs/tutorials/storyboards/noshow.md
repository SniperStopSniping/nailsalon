# Record confirmed nonattendance

**Feature IDs:** F033 / F034
**Audience:** Salon owners and nail technicians.
**Purpose:** Choose the confirmed-nonattendance reason, expose the optional blank private-note field, confirm, then inspect limited history at a second authorized synthetic salon.
**Starting screen:** Actual owner Today dashboard in the isolated local application.
**Navigation:** Owner dashboard → appointment → Details → Mark no-show
**Verification:** Feature Preview; current main plus PR #449; actual isolated persistence and propagation.

| Step | Instruction | Source timing |
|---|---|---|
| 01  Open the appointment | The client has confirmed they cannot attend. | 58.890–62.117s |
| 02  Find the no-show action | Open Details to see other actions. | 62.204–65.378s |
| 03  Mark No-Show | Reporting opens 24 hours before the visit. | 65.448–68.635s |
| 04  Choose the confirmed reason | Select the reason that matches the conversation. | 68.715–72.297s |
| 05  A private note is optional | Keep any private details out of shared history. | 72.384–75.885s |
| 06  Confirm the report | Wait for the saved and shared acknowledgement. | 75.971–80.599s |
| 07  Check the limited shared history | Open the client at a second participating salon. | 80.715–90.171s |
| Recorded history, handled fairly | Mistakes can be corrected. Clients can request review. | 90.253–93.256s |

## Revision 2 recording notes

Fixed 390 × 844 viewport and timestamped real browser capture. Moving hand matches actual clicks. Any omitted wait intervals are recorded explicitly in the edit timeline. Complete actions and real saved results are preserved. Synthetic data only; no production changes or provider delivery.

Feature Preview: source main plus PR #449. Maya Singh is synthetic. The same test owner is authorized for both salons. Optional note remains blank. Real contribution and second-salon warning verified.
