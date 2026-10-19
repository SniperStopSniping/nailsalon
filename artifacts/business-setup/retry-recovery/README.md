# Legacy design revision and retry recovery

Code: `4ac9f066`. Preview deployment: `dpl_58Ep4JLg2GsrFSh9xwFSPJ4J2ANF`, READY, preview target, aliased to https://luster-ai-builder-test.vercel.app. Production unchanged.

Read-only investigation of the reported request found a generated conversation linked to a failed design job, with no billed generation call. The saved website had a legacy `match` brief with no reference IDs. Generation rejected this before calling the provider, although an existing editable source was available. The generated parent remained under its active lease, blocking immediate retry. The UI then replaced the admission reason with a generic retry message.

Existing-source modifications now accept the legacy empty reference selection and retain prior authorized assets. Fresh generation/start-over still requires a reference for match mode. Failed generation marks its conversation failed and retains a safe error message. Admission reconciles terminal design jobs from older deployments rather than treating them as active. UI admission failures preserve the server's reason and avoid the duplicated stop message.

Verification: 60 disposable PGlite integration tests, 16 component tests, 4 timeline tests, and 8 API tests passed (88 unique tests). TypeScript, scoped ESLint and diff checks passed. New tests cover legacy reference settings, immediate retry including older generated-parent state, and the server error message. No production databases or outbound communications used.

Real OpenAI Responses `gpt-6-astra` verification used the existing synthetic Petal test salon, set to the same empty-reference condition. The actual owner composer sent only “Make the Instagram clickable”. No generated source was manually edited. The composer cleared, progress appeared, revision 6 saved, the trusted Instagram anchor resolved to the synthetic handle, and refresh retained it. Source validation passed on the first generation attempt. The test remained an unpublished draft; no booking/publication or customer actions were performed in this regression check. The user's original salon and draft were not edited.

Conversation call: CAD 0.089136; generation: CAD 0.382536; total: CAD 0.471672 conservative allowance. Combined cumulative trial accounting after this check: CAD 34.012072 / 40, not a reconciled provider invoice. Operation/artifact IDs and screenshots are retained alongside this document. The screenshots show synthetic business details only.
