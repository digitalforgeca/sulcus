# Aider Memory Conventions

1. **Before Planning or Editing**:
   - Query Sulcus memory from Aider using `/run sulcus hook --harness aider recall "<topic>" </dev/null`.
2. **Capturing Solutions & Decisions**:
   - After resolving a bug or finalizing an architectural design, ingest the decision into Sulcus using `/run sulcus hook --harness aider ingest "<clean plain-text summary>" </dev/null`.
