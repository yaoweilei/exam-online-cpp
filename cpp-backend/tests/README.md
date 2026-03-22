# Test Suite

## C++ smoke test

```bash
ctest --test-dir cpp-backend/build --output-on-failure
```

## Contract test (API envelope/schema)

```bash
powershell -ExecutionPolicy Bypass -File cpp-backend/tests/contract_v2_smoke.ps1
```

## Integration flow test

```bash
powershell -ExecutionPolicy Bypass -File cpp-backend/tests/integration_flow_smoke.ps1
```

## Perf baseline

```bash
powershell -ExecutionPolicy Bypass -File cpp-backend/tests/perf_read_score.ps1
```
