# Test Suite

## C++ smoke test

```bash
ctest --test-dir backend/build --output-on-failure
```

## Contract test (API envelope/schema)

```bash
powershell -ExecutionPolicy Bypass -File backend/tests/contract_v1_smoke.ps1
```

## Integration flow test

```bash
powershell -ExecutionPolicy Bypass -File backend/tests/integration_flow_smoke.ps1
```

## Perf baseline

```bash
powershell -ExecutionPolicy Bypass -File backend/tests/perf_read_score.ps1
```
