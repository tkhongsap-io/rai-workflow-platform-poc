# Runtime contract

Consume the shared readiness, operator and safe-error schemas from d931cea without widening them. Existing W0-10 and the prerequisite reconciliation govern behavior. Readiness must reflect actual dependency probes; liveness remains independent of them. Operator data requires operator.view and contains bounded projections, never provider errors or document contents. Correlation is minted server-side and retained through persisted work; replay does not create duplicate diagnostic events.

Ordinary notification provenance remains mandatory audit provenance. Digest provenance belongs to the coordinated W3-03b contract and persisted linkage. W3-07a observes those implementations without replacing them. No real QC, new finding authority, external mail or production configuration is introduced.
