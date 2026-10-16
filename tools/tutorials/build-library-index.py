#!/usr/bin/env python3
"""Build the offline review library from verified footage metadata, never invented UI."""
import collections,html,json,re
from datetime import datetime,timezone
from pathlib import Path
R=Path(__file__).resolve().parents[2];D=R/'docs/tutorials';q=sorted(json.loads((D/'library-queue.json').read_text()),key=lambda x:x['rank']);now=datetime.now(timezone.utc).isoformat()
original=D/'versions/inventory-before-library.md';original.parent.mkdir(exist_ok=True)
if not original.exists():original.write_text((D/'inventory.md').read_text())
features=[]
for line in original.read_text().splitlines():
 if re.match(r'\| F\d{3} \|',line):
  cols=line.split('|');features.append({'id':cols[1].strip(),'name':cols[2].strip(),'originalDisposition':cols[3].strip(),'sources':re.findall(r'`([^`]+)`',cols[4])})
nav={
'online-booking':'More → Booking Page → Open live site → service → extra → date/time → client details → Confirm appointment',
'booking-style':'More → Booking Page → Style, Colours & Fonts → style → palette → font → Preview draft',
'add-service':'Services → + Service → name, price and duration → Save Service → Edit → Save changes',
'choose-service-addons':'Services → Luster Gel Manicure → Choose add-ons → French Tips, Chrome, Glitter, Removal from Another Salon → Done',
'manual-appointment':'Today → New Appointment → service → date/time and technician → client details → Create Appointment → View calendar',
'calendar':'Calendar → Monthly → appointment date → visit → appointment details',
'walkin':'Today → Walk-in → service → available time → client details → Book Walk-in Now',
'reschedule':'Clients → Sarah Morgan → Appointments → View appointment → Edit / reschedule → new time → Save changes',
'cancel-appointment':'Clients → Nora Evans → Appointments → View appointment → Cancel appointment → confirm',
'checkout':'Clients → Emma Taylor → Appointments → completed-visit checkout → Cash → amount → Review → Complete appointment',
'client-history':'Clients → Emma Taylor → Overview → Client profile section: Appointments → completed appointment',
'no-show':'Today → upcoming appointment → Details: Show → Mark no-show → confirmed nonattendance reason → Confirm no-show',
'shared-alert':'Second authorized demo salon → Clients → Maya Singh → Recorded No-Show History',
'no-show-correction':'More → No-show records → Correct mistaken no-show → explanation → Confirm correction',
'no-show-review':'More → No-show records → customer secure appointment link → Request review of this no-show → explanation → Request review → owner No-show records',
'reminders':'More → Marketing & Messages → Appointment Messages & Reminders → timing/channel → Save communication settings',
'rebooking-reminders':'More → Marketing & Messages → Rebooking Reminders → interval → wording → Save reminders',
'review-requests':'More → Marketing & Messages → Review Requests → Google review link → wording → Save',
'sms-starter':'More → Text Message Balance → verification status → Claim 100 free texts → updated balance',
'sms-credits':'More → Usage & SMS → SMS credits & top-ups → remaining credits → free booking details',
'booking-publish':'More → Booking Page → Preview & Publish → reviewed draft → Publish (local fixture only)',
'blocked-time':'Calendar → Availability → Block time → day/time/reason → Save',
'staff-schedule':'More → Team → Working Hours → Whose schedule? → Monday end time → Save Schedule',
'staff-assignment':'More → Team → Services & Skills → Marie Dupont → treatments → Save Changes',
'booking-request':'Clients → Isabel Reed → Appointments → pending visit → review details → Confirm appointment',
'booking-approval':'Services → Booking approval → Booking rules → Booking confirmation → Review each request first → Save booking rules',
'booking-rules':'More → Booking Rules & Policies → Booking rules → buffer/minimum notice → Save booking rules',
'booking-policy':'More → Booking Rules & Policies → Booking policy → wording/acknowledgement → Save booking policy',
'smart-fit':'More → Marketing & Messages → Smart Fit → enable/discount → Save',
'smart-fit-booking':'More → Booking Page → Open live site → Gel-X Full Set → qualifying Smart Fit time → details → Confirm appointment',
'first-visit':'Services → Advanced Settings → Menu display → First-visit offer → Save menu display',
'add-ons':'Services → Add-ons → Add → name, price, duration → Save add-on',
'service-library':'Services → Advanced Settings → Library → treatment template → add to menu → saved service',
'business-hours':'More → Hours & Availability → Business Hours → weekly hours → Save',
'business-information':'More → Settings → Business Information → salon contact details → saved field',
'address-privacy':'More → Booking Page → What Clients See → Location → Show my full address after they book → saved draft',
'layout-menu':'More → Booking Page → Layout & Menu → Quiet Center → Clean List → Preview draft',
'portfolio':'More → Portfolio → select existing example photos → Manicure batch tag → saved tags',
'add-client':'Clients → Add → synthetic name and phone → Save client',
'client-notes':'Clients → Sarah Morgan → Client profile section: Notes & Photos → Private notes → Save note',
'client-preferences':'Clients → Emma Taylor → Client profile section: Preferences → Preferred artist → Save details',
'client-flags':'Clients → Emma Taylor → Client controls → Important client flag → Private flag note → Save status',
'review-preferences':'Clients → Emma Taylor → Client controls → Do not send review requests → saved suppression',
'client-contact':'Clients → Emma Taylor → Text → Message → review recipient and draft (no send)',
'guest-manage':'Clients → Sarah Morgan → Appointments → View appointment → Send details → Not sent → secure customer link → Choose a new time → Confirm new time → saved visit',
'guest-rebook':'More → Marketing & Messages → Rebooking Prompt → interval/message → Save Rebooking Prompt',
'followups':'More → Marketing & Messages → Client follow-ups → due client → Snooze 7 days → saved outreach snooze',
'winback-settings':'More → Marketing & Messages → Win-back Offers → Rebook clients after → offer stages → Save marketing settings',
'next-visit':'More → Marketing & Messages → Next Visit Offer → validity/discount → Save',
'campaign-results':'More → Marketing & Messages → Results → manual outreach → campaigns → automatic messages',
'payment-records':'Clients → Emma Taylor → Client profile section: Payments → recorded visit payment → appointment',
'etransfer':'More → Payments → payment methods → synthetic e-Transfer instructions → Save tax and e-Transfer',
'deposit-setup':'More → Payments → Deposits → amount → payment prerequisites → Save deposits',
'deposit-protection':'More → Payments → Deposits → warning only → one/two report thresholds → readiness explanation',
'staff-profile':'More → Team → Team Members → Add → name/contact/commission → Add → saved technician',
'staff-earnings':'More → Team → Earnings → Daniela Rossi → Week → revenue and commission summary',
'analytics':'More → Analytics → Monthly → Top services → utilization and team totals',
'message-history':'More → Usage & SMS → SMS credits & top-ups → Message history → Confirmations filter',
'integration-status':'More → Integrations → connection statuses → Open Appointment Messages & Reminders',
'owner-notifications':'More → Settings → Owner & Staff Alerts → recipient/preferences → Save',
'multi-salon':'Header: Switch salon → authorized salon card → Open dashboard → selected salon workspace',
'saved-setup':'More → Booking Page → Review setup in the editors → current business details → Location → Preview',
'owner-account':'More → Settings → Account → Name → Save profile → saved details',
'workspace-tour':'More → Help & Resources → Workspace tour → navigation steps → finish',
'luster-resources':'More → Help & Resources → Luster resources → Shop/Learn index → owner email preference',
'client-archive':'Clients → Emma Taylor → Client controls → More actions → Archive client → review → confirm',
}
active=[];blocked=[]
for x in q:
 if not x.get('video'):
  blocked.append(x);continue
 t=json.loads((D/x['captureTimeline']).read_text());e=json.loads((D/'verification'/f"{x['id']}-evidence.json").read_text());edits=json.loads((D/x['editTimeline']).read_text())
 if not t.get('completed') or not e.get('completed'):raise RuntimeError('Unverified capture in active queue: '+x['id'])
 record={**x,'navigation':nav.get(x['id'],'See recorded actions in the storyboard and capture script.'),'scope':e.get('scope',e.get('paymentNotice','Actual synthetic local UI workflow; no production provider outcome implied.')),'sourceIdentity':t.get('sourceIdentity',{'sourceCommit':t['sourceCommit'],'verificationGap':'Compiled build identity was not recorded for this early capture.'}),'storyboard':f"storyboards/{x['id']}.md"}
 active.append(record)
 audience='Salon owner; customer view is shown at the explicitly labelled handoff.' if x['id'] in ['online-booking','smart-fit-booking','guest-manage','no-show-review'] else 'Salon owner or authorized salon manager.'
 lines=[f"# {x['title']}",'',f"Feature IDs: {', '.join(x['featureIds'])}",f"Audience: {audience}",'Starting screen: the real owner dashboard in an isolated synthetic salon.',f"Navigation: {record['navigation']}",'',f"Verification scope: {record['scope']}",f"Export: {x['durationSeconds']} seconds; 1080 × 1920; 30 FPS; silent MP4.",'','The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.','', '| Time | Instruction | Salon benefit / explanation | Visual emphasis |','|---|---|---|---|']
 for i,s in enumerate(edits):
  lines.append(f"| {s['outputStart']:.2f}–{s['outputEnd']:.2f}s | {s['heading']} | {s.get('benefit','')} | {len(s.get('synchronizedClicks',[]))} real taps; stable phone scale |")
 lines+=['',f"Expected and verified result: {record['scope']}",f"Final benefit statement: {edits[-1].get('benefit','')}",'',f"Video: [MP4](../{x['video']})",f"Cover: [PNG](../{x['thumbnail']})",f"Actual capture evidence: [JSON](../verification/{x['id']}-evidence.json)",f"Editable action script: [flow](../../../tools/tutorials/flows/{x['id']}.mjs)",'','Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.','']
 (D/record['storyboard']).write_text('\n'.join(lines))
manifest={'schemaVersion':2,'generatedAt':now,'sourceBranch':'codex/luster-tutorial-library','pullRequest':'https://github.com/SniperStopSniping/nailsalon/pull/456','baselineMain':'ad28e325b646b19dea481aec83d3d6d5ff5dbac5','environment':'isolated loopback development; synthetic owner/client fixtures; external messaging/payments/calendar disabled','reviewStatus':'User review required; nothing published, merged or deployed','tutorials':active,'blocked':blocked,'pilotArchive':'versions/ and earlier pilot media retained; excluded from the current posting package'}
(D/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
excluded={'F025':'Discover marketplace is hidden; portfolio organization remains covered.','F036':'Platform moderation is not an ordinary salon-owner tutorial; owner corrections and customer review suspension are recorded.','F047':'New customer ratings/technician-review submission was not safely verified with supported guest access. No new-rating tutorial is advertised.','F048':'Google review rewards retired. Honest review requests remain.','F049':'Unfinished loyalty points/redemption hidden. Historical data preserved.','F050':'Unavailable referral actions hidden.','F051':'Legacy membership tiers retired.','F061':'Retired staff authentication/self-service requests excluded; owner scheduling remains covered.','F068':'AI owner pilot disabled here; no active provider-backed pilot tutorial.','F069':'AI customer pilot disabled here; no active provider-backed pilot tutorial.','F070':'AI feedback pilot is conditional and not demonstrated.','F071':'Inactive automatic social posting excluded.','F072':'Nonfunctional AI caption claims retired.','F073':'Platform-only anomaly moderation; not an ordinary owner feature.','F076':'Responsive/accessibility foundations are exercised across the library; physical iPhone and separate-language QA remain open.','F078':'Retired customer authentication excluded. Guest booking and secure links remain.'}
covered=collections.defaultdict(list)
for x in active:
 for fid in x['featureIds']:covered[fid].append(x)
coverage=['# Complete feature coverage','',f"Current library: {len(active)} real-screen tutorials and guides. {len(blocked)} queued workflows are blocked or excluded from active exports. Coverage is a verification statement, not a claim of production deployment.",'','| Feature | Current coverage | Limitations | Source |','|---|---|---|---|']
for f in features:
 links=', '.join(f"[{x['title']}]({x['storyboard']})" for x in covered[f['id']]) or 'No active export';scope=excluded.get(f['id'],'Real isolated UI and saved/read-only result; see the linked storyboard for scope.')
 if f['id']=='F039':scope='Saved consent defaults and STOP copy are shown. Live inbound STOP handling/provider delivery is not filmed.'
 if f['id']=='F064':scope='Measured manual/campaign result UI verified; Smart Fit attribution totals not demonstrated with nonzero completed discounted revenue.'
 if f['id']=='F077':scope='Protected owner name/profile update verified. Authentication was pre-established with the development fixture; a full fresh signup/email-code journey is not filmed.'
 if f['id']=='F010':scope='Inactive catalog rules are hidden. Earlier saved-only rule footage is archived and excluded; working menu display and first-visit controls are covered separately.'
 if f['id']=='F029':scope='Notes and preferred-artist details verified. Client photo uploads/provider storage not demonstrated.'
 if f['id'] in ['F056','F057','F058']:scope='Saved setup/readiness only where linked. Connected Stripe collection, charges, refunds and reconciliation require a sandbox; none fabricated.'
 if f['id']=='F066':scope='Actual one-time 100-credit grant and duplicate no-op verified. Live text delivery and Stripe top-up purchase not demonstrated.'
 if f['id']=='F067':scope='Readiness view verified. Actual Google authorization, sync and disconnect blocked by disabled/unconfigured sandbox.'
 refs='<br>'.join(f'`{p}`' for p in f['sources']);coverage.append(f"| {f['id']} · {f['name']} | {links} | {scope} | {refs} |")
(D/'inventory.md').write_text('\n'.join(coverage)+'\n')
counts=collections.Counter(x.get('guideType','complete_workflow') for x in active)
readme=['# Luster Mobile Tutorial Library','',f"{len(active)} branded MP4s with matching 1080 × 1920 covers. Actual Luster screens, synthetic salon data, fixed phone framing, synchronized hand taps and short instructions explaining the salon benefit.",'','[Open the review gallery](index.html) · [Download the review package](Luster-Mobile-Tutorial-Library-Review.zip) · [Complete feature coverage](inventory.md) · [UX improvements](UX_IMPROVEMENTS.md) · [Testing and limitations](VERIFICATION.md) · [Manifest](manifest.json)','','## Review the important workflows first','', 'These are review candidates. Feature Preview clips require confirmation that the matching release is available before being marketed as generally available. Setup guides demonstrate saved preferences, not provider delivery.','']
for x in active[:20]:readme.append(f"{x['rank']}. [{x['title']}]({x['video']}) — {x['durationSeconds']}s; [cover]({x['thumbnail']}); {'Feature Preview' if x.get('featurePreview') else x.get('guideType','complete_workflow').replace('_',' ')}.")
readme+=['','## Full index','','| Order | Tutorial | Duration | Scope | Storyboard |','|---|---|---|---|---|']
for x in active:readme.append(f"| {x['rank']} | [{x['title']}]({x['video']}) | {x['durationSeconds']}s | {'Feature Preview · ' if x.get('featurePreview') else ''}{x.get('guideType','complete_workflow').replace('_',' ')} | [Script]({x['storyboard']}) |")
readme+=['','## Blocked workflows','','No successful provider outcome or inactive feature is fabricated.','']
for x in blocked:readme+= [f"- **{x['title']}** — {x.get('blockedReason','Recording not complete.')}",f"  Required action: {x.get('requiredAction','Complete and verify the actual safe workflow.')} "]
readme+=['','## Repeatable production','','1. Work from a clean branch and dedicated nonproduction fixture. `runtime.py` refuses mismatched local database/Redis identities, production Clerk keys and outbound provider credentials.','2. Review `storyboards/<id>.md` and `tools/tutorials/flows/<id>.mjs`; synthetic fixture prerequisites are explicit. Never reset a terminal appointment or a one-time credit grant for a retake.','3. Build and start the guarded local runtime. Existing dependencies must already be available; no paid services are required.','4. Capture one flow at a time: `node tools/tutorials/library-capture.mjs <id>`. Capture errors prevent a success render.','5. Render: `python3 tools/tutorials/render-library.py <id>`. The template rejects oversized headlines, overlapping explanations, missing taps and incomplete takes.','6. Verify: `python3 tools/tutorials/verify-library.py <id>` and `python3 tools/tutorials/verify-source-layout.py`. Inspect beginning/middle/end, the saved result and important transition/tap frames.','7. Rebuild the gallery and scripts: `python3 tools/tutorials/build-library-index.py`. Package only the current verified exports.','', 'The repeatable template uses licensed Newsreader and Inter fonts (OFL files in `assets/fonts/`), cream/beige surfaces, blush accents and a fixed 582 × 1259 screen at (249, 479). Real pointer events, not guessed control positions, drive the hand. Source wait cuts and final instruction timings are retained in `assets/library/<id>/edit-timeline.json`.','', 'Media links refer to the local gallery or extracted review ZIP. Rendered videos, raw footage and the review ZIP are intentionally outside Git; source recipes and text reports are versioned.', '', 'Original pilot exports, raw recordings and earlier revisions remain on disk. Inactive catalog footage is in `versions/inactive-service-modes/`; it is excluded from the current review package. Private environment and Clerk state stay outside this directory and outside the package.','', 'Clerk fixture preparation used Development-only testing credentials and the existing synthetic owner. The 100-credit claim was actually saved to the isolated credit ledger; the duplicate claim returned already_claimed with no second grant. No verification text was delivered. Official API reference: https://clerk.com/docs/reference/backend/phone-numbers/create-phone-number .','']
(D/'README.md').write_text('\n'.join(line.rstrip() for line in readme).rstrip()+'\n')
# Embed the card data so the review gallery also works from an extracted offline ZIP.
cards=[]
for x in active:
 badge='Feature Preview' if x.get('featurePreview') else x.get('guideType','complete_workflow').replace('_',' ').title()
 cards.append(f'''<article class="card" data-search="{html.escape((x['title']+' '+x['id']+' '+' '.join(x['featureIds'])).lower())}" data-type="{x.get('guideType','complete_workflow')}" data-rank="{x['rank']}"><div class="card-head"><span class="number">{x['rank']:02}</span><span class="badge">{badge}</span></div><h2>{html.escape(x['title'])}</h2><p class="meta">{x['durationSeconds']} seconds · {' · '.join(x['featureIds'])}</p><video controls playsinline preload="none" poster="{x['thumbnail']}" aria-label="{html.escape(x['title'])}"><source src="{x['video']}" type="video/mp4"></video><p class="scope">{html.escape(x['scope'])}</p><div class="actions"><a href="{x['video']}" download>Download MP4</a><a href="{x['thumbnail']}" download>Download cover</a><a href="{x['storyboard']}">Storyboard</a></div></article>''')
blocks=''.join(f"<li><strong>{html.escape(x['title'])}</strong><p>{html.escape(x.get('blockedReason','Pending verification.'))}</p></li>" for x in blocked)
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Luster · Tutorial Library</title><style>
@font-face{font-family:Newsreader;src:url('assets/fonts/Newsreader.ttf');font-weight:200 800;font-display:swap}@font-face{font-family:Inter;src:url('assets/fonts/Inter.ttf');font-weight:100 900;font-display:swap}*{box-sizing:border-box}body{margin:0;background:#f7f1e9;color:#30262a;font-family:Inter,system-ui,sans-serif}.wrap{max-width:1420px;margin:auto;padding:42px 24px}header{max-width:860px;margin-bottom:34px}.brand{letter-spacing:.25em;font-size:26px}.eyebrow{color:#a5526d;font-size:12px;letter-spacing:.15em;text-transform:uppercase}h1,h2{font-family:Newsreader,Georgia,serif;font-weight:500}h1{font-size:clamp(42px,6vw,78px);line-height:1.02;margin:22px 0}header p{font-size:16px;line-height:1.7;color:#756863}a{color:#8f345a;text-underline-offset:4px}.notice{padding:18px 20px;background:#eddfdc;border-radius:16px;line-height:1.65;font-size:13px}.toolbar{display:flex;flex-wrap:wrap;gap:10px;margin:28px 0;align-items:center}input,select{padding:13px;border:1px solid #dacdc6;border-radius:12px;background:#fffaf5;font:inherit;min-height:46px}input{min-width:240px;flex:1}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #af5978;outline-offset:4px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}.card{padding:22px;background:#fffbf6;border:1px solid #e7dad4;border-radius:22px;box-shadow:0 8px 28px #30262a08}.card-head{display:flex;justify-content:space-between;align-items:center}.number{font-size:13px;color:#85726e}.badge{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#94425e;background:#f2e3e2;border-radius:99px;padding:7px 10px}h2{font-size:29px;line-height:1.1;margin:18px 0 8px}.meta{font-size:11px;color:#81716b;margin-bottom:18px}video{display:block;width:100%;aspect-ratio:9/16;background:#eee5dc;border-radius:12px}.scope{font-size:12px;line-height:1.65;color:#756863}.actions{display:flex;flex-wrap:wrap;gap:14px;font-size:12px}details{margin:40px 0;padding:22px;background:#eee2da;border-radius:18px}summary{cursor:pointer;font-size:18px}li{line-height:1.6;margin:18px 0}li p{font-size:13px;color:#756863}footer{margin:45px 0;color:#81716b;font-size:12px}.hidden{display:none}@media(max-width:1040px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:650px){.grid{grid-template-columns:1fr}.wrap{padding:28px 16px}.card{padding:18px}video{max-height:78svh}h2{font-size:31px}}
</style><body><main class="wrap"><header><div class="brand">LUSTER</div><p class="eyebrow">BOOK · MANAGE · GROW</p><h1>Your salon,<br>one clear step at a time.</h1><p>Real mobile tutorials with practical instructions and a clear salon benefit. Start with the essential booking workflows, then explore the full library.</p><div class="notice">__COUNT__ finished guides for review. <strong>Feature Preview</strong> clips await release verification. Setup guides show saved preferences; messages, payment purchases and provider delivery are not implied. All salons and clients are synthetic. Nothing has been published.</div></header><nav class="toolbar" aria-label="Filter tutorials"><input id="search" type="search" aria-label="Search tutorials" placeholder="Find a feature or feature ID"><select id="filter" aria-label="Choose tutorial group"><option value="all">All tutorials</option><option value="essential">Start here · first 20</option><option value="complete_workflow">Complete workflows</option><option value="setup_only">Setup guides</option><option value="read_only">Read-only guides</option></select><a id="package-download" href="Luster-Mobile-Tutorial-Library-Review.zip" download>Download review package</a></nav><section class="grid" aria-label="Tutorial videos">__CARDS__</section><details><summary>Blocked workflows and verification gaps</summary><ul>__BLOCKS__</ul><p><a href="VERIFICATION.md">Full testing and limitations</a> · <a href="inventory.md">Feature coverage</a> · <a href="UX_IMPROVEMENTS.md">UI improvements</a></p></details><footer>1080 × 1920 · 30 FPS · actual Luster UI · isolated synthetic fixtures · user review required</footer></main><script>if(location.protocol==='file:')document.querySelector('#package-download').hidden=true;const search=document.querySelector('#search'),filter=document.querySelector('#filter');function apply(){const term=search.value.toLowerCase().trim();for(const card of document.querySelectorAll('.card')){const match=card.dataset.search.includes(term)&&(filter.value==='all'||filter.value==='essential'&&Number(card.dataset.rank)<=20||card.dataset.type===filter.value);card.classList.toggle('hidden',!match);if(!match)card.querySelector('video').pause();}}search.addEventListener('input',apply);filter.addEventListener('change',apply);document.addEventListener('play',e=>{if(e.target.tagName==='VIDEO')for(const v of document.querySelectorAll('video'))if(v!==e.target)v.pause();},true);</script></body></html>'''
page=page.replace('__COUNT__',str(len(active))).replace('__CARDS__',''.join(cards)).replace('__BLOCKS__',blocks);(D/'index.html').write_text(page)
print(f'{len(active)} tutorial storyboards, manifest, feature inventory, README and offline gallery updated; {len(blocked)} blocked entries.')
